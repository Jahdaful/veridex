import express from "express";
import cors from "cors";
import multer from "multer";
import crypto from "crypto";
import { promisify } from "util";
import rateLimit from "express-rate-limit";
import exifr from "exifr";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("FATAL: ANTHROPIC_API_KEY not set in .env"); process.exit(1);
}

const PORT = process.env.PORT || 3001;
const app = express();

const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173", "http://localhost:5174",
  "capacitor://localhost", "https://localhost", "ionic://localhost",
]);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.has(origin)) cb(null, true);
    else cb(new Error("CORS: origin not allowed"));
  },
}));

// ── Session store (file-persisted, 8 hr TTL) ──────────────────────────────────
const SESSIONS_FILE = path.join(process.cwd(), "sessions.json");
const SESSION_TTL   = 8 * 60 * 60 * 1000;

function loadSessions() {
  try {
    const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"));
    const now = Date.now();
    return new Map(Object.entries(raw).filter(([, s]) => s.expires > now));
  } catch { return new Map(); }
}
function saveSessions() {
  try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions))); }
  catch (e) { console.error("[sessions] save failed:", e.message); }
}

const sessions = loadSessions();

function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { expires: Date.now() + SESSION_TTL, userId });
  saveSessions();
  return token;
}
function validateSession(token) {
  if (!token || !sessions.has(token)) return false;
  const s = sessions.get(token);
  if (Date.now() > s.expires) { sessions.delete(token); saveSessions(); return false; }
  return true;
}

// Prune expired sessions hourly
setInterval(() => {
  let pruned = false;
  for (const [t, s] of sessions) {
    if (Date.now() > s.expires) { sessions.delete(t); pruned = true; }
  }
  if (pruned) saveSessions();
}, 3_600_000);

// ── User store (scrypt-hashed passwords) ──────────────────────────────────────
const USERS_FILE  = path.join(process.cwd(), "users.json");
const scryptAsync = promisify(crypto.scrypt);

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, "utf8")); }
  catch { return {}; }
}
function saveUsers(users) {
  try { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }
  catch (e) { console.error("[users] save failed:", e.message); }
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scryptAsync(password, salt, 64);
  return `${salt}:${hash.toString("hex")}`;
}
async function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const hashBuf = Buffer.from(hash, "hex");
  const derived  = await scryptAsync(password, salt, 64);
  return crypto.timingSafeEqual(hashBuf, derived);
}

// ── Auth middleware ───────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers["x-auth-token"] || "";
  if (!validateSession(token)) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// ── File upload ───────────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    cb(null, /^(image|video|audio)\//.test(file.mimetype)),
});

// ── Rate limiters ─────────────────────────────────────────────────────────────
const scanLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true,
  message: { error: "Rate limit exceeded. Wait before scanning again." },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true,
  message: { error: "Too many attempts. Try again in 15 minutes." },
});

// ── Magic byte validator ──────────────────────────────────────────────────────
function validateMagicBytes(buffer, mimetype) {
  if (buffer.length < 12) return false;
  const hex = buffer.slice(0, 12).toString("hex").toUpperCase();
  switch (mimetype) {
    case "image/jpeg": return hex.startsWith("FFD8FF");
    case "image/png":  return hex.startsWith("89504E47");
    case "image/gif":  return hex.startsWith("47494638");
    case "image/webp":
      return hex.startsWith("52494646") &&
        buffer.slice(8, 12).toString("ascii") === "WEBP";
    default: return true;
  }
}

let activeUploads = 0;
const MAX_CONCURRENT = 3;

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a world-class forensic media analysis AI used by societal enforcement agencies globally.

SCORING SCALE — strictly enforce:
- 0–30   → AUTHENTIC  (real, unmanipulated) → overallRisk: "CLEAN" or "LOW"
- 31–69  → UNCERTAIN  (inconclusive)        → overallRisk: "MEDIUM"
- 70–100 → DEEPFAKE   (AI/synthetic)        → overallRisk: "HIGH"

Return ONLY a valid JSON object. No prose, no markdown, no explanation:
{
  "overallRisk": "HIGH|MEDIUM|LOW|CLEAN",
  "overallScore": <integer 0-100>,
  "verdict": "AUTHENTIC|UNCERTAIN|DEEPFAKE",
  "summary": "<2 sentence forensic summary>",
  "findings": [
    {
      "category": "Deepfake Detection|AI Image Detection|Voice Cloning Analysis|Identity Modification",
      "risk": "HIGH|MEDIUM|LOW|CLEAN",
      "score": <integer 0-100>,
      "detail": "<specific technical finding>",
      "indicators": ["<indicator 1>", "<indicator 2>", "<indicator 3>"]
    }
  ],
  "recommendations": ["<rec 1>", "<rec 2>", "<rec 3>", "<rec 4>"],
  "evidenceGrade": "A|B|C|D",
  "caseNotes": "<forensic case file note>",
  "exifAnalysis": "<EXIF integrity assessment>",
  "integrityFlags": ["<flag 1>", "<flag 2>"]
}`;

// ── Routes ────────────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({ status: "ok", service: "VERIDEX API" }));

// Register
app.post("/api/register", authLimiter, express.json(), async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password required." });

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email))    return res.status(400).json({ error: "Invalid email address." });
  if (password.length < 8)    return res.status(400).json({ error: "Password must be at least 8 characters." });

  const users = loadUsers();
  const key   = email.toLowerCase().trim();
  if (users[key]) return res.status(409).json({ error: "An account with this email already exists." });

  try {
    users[key] = { passwordHash: await hashPassword(password), createdAt: new Date().toISOString() };
    saveUsers(users);
    res.json({ success: true, token: createSession(key) });
  } catch {
    res.status(500).json({ error: "Registration failed. Try again." });
  }
});

// Login (email + password only — no admin bypass)
app.post("/api/auth", authLimiter, express.json(), async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password required." });

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) return res.status(400).json({ error: "Invalid email address." });

  const users = loadUsers();
  const key   = email.toLowerCase().trim();
  const user  = users[key];
  if (!user) return res.status(401).json({ error: "Invalid email or password." });

  try {
    if (!await verifyPassword(password, user.passwordHash))
      return res.status(401).json({ error: "Invalid email or password." });
    res.json({ success: true, token: createSession(key) });
  } catch {
    res.status(500).json({ error: "Authentication error. Try again." });
  }
});

// Logout
app.post("/api/logout", auth, (req, res) => {
  sessions.delete(req.headers["x-auth-token"]);
  saveSessions();
  res.json({ success: true });
});

// ── Analysis ──────────────────────────────────────────────────────────────────
app.post("/api/analyze", scanLimiter, auth, upload.single("file"), async (req, res) => {
  if (activeUploads >= MAX_CONCURRENT)
    return res.status(429).json({ error: "Server busy. Try again in a moment." });
  activeUploads++;

  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file provided." });

    if (!validateMagicBytes(file.buffer, file.mimetype))
      return res.status(400).json({ error: "File content does not match declared type. Upload rejected." });

    const fileName = file.originalname;
    const fileType = file.mimetype.startsWith("video") ? "video"
      : file.mimetype.startsWith("audio") ? "audio" : "image";
    const sha256 = crypto.createHash("sha256").update(file.buffer).digest("hex");

    let exifData = null;
    try { exifData = await exifr.parse(file.buffer, { tiff: true, exif: true, gps: true, iptc: true }); }
    catch { /* no EXIF */ }

    const exifBlock = exifData ? [
      `Camera: ${exifData.Make || "—"} ${exifData.Model || ""}`.trim(),
      `Software: ${exifData.Software || "none"}`,
      `DateTime: ${exifData.DateTimeOriginal || exifData.DateTime || "none"}`,
      `GPS present: ${exifData.latitude ? "YES" : "no"}`,
      `Dimensions: ${exifData.ExifImageWidth || exifData.ImageWidth || "?"}x${exifData.ExifImageHeight || exifData.ImageHeight || "?"}`,
      `ISO: ${exifData.ISO || "?"}  Exposure: ${exifData.ExposureTime || "?"}s`,
      `Lens: ${exifData.LensModel || "not found"}`,
    ].join("\n") : "No EXIF metadata extracted";

    const metaBlock = `FILENAME: ${fileName}\nMIME: ${file.mimetype}\nSIZE: ${(file.size / 1024).toFixed(1)} KB\nSHA-256: ${sha256}\nEXIF:\n${exifBlock}`;

    const useVision = fileType === "image"
      && ["image/jpeg","image/png","image/gif","image/webp"].includes(file.mimetype)
      && file.size <= 5 * 1024 * 1024;

    const messages = useVision
      ? [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: file.mimetype, data: file.buffer.toString("base64") } },
          { type: "text", text: `Forensic image analysis. Examine the actual image content AND the metadata below.\n\n${metaBlock}\n\nInspect for:\n1. GAN/diffusion artifacts — spectral anomalies, unnatural noise floor, tile/grid patterns\n2. Face/body manipulation — blending seams, lighting inconsistency, texture synthesis\n3. AI generation markers — missing sensor noise, synthetic skin, anatomical errors, AI software in EXIF\n4. Metadata integrity — missing fields, AI software tags (Midjourney/DALL-E/Stable Diffusion/Kling), timestamp anomalies\n5. Compression artifacts inconsistent with claimed camera origin\n\nScore strictly: 0-30 authentic, 31-69 uncertain, 70-100 deepfake/AI-generated.\nReturn ONLY the JSON.` },
        ]}]
      : [{ role: "user", content: `Forensic ${fileType} analysis.\n\n${metaBlock}\n${file.size > 5 * 1024 * 1024 ? "\nNote: File too large for vision — metadata-only analysis." : ""}\n\nAnalyze filename patterns, known AI platform naming conventions (kling_, runway_, sora_, etc), EXIF integrity, and metadata signals.\nScore strictly: 0-30 authentic, 31-69 uncertain, 70-100 deepfake/synthetic.\nReturn ONLY the JSON.` }];

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 4096, system: SYSTEM_PROMPT, messages }),
    });

    const data = await response.json();
    if (data.type === "error") return res.status(500).json({ error: "Analysis service error. Try again." });

    const text  = data.content?.map(i => i.text || "").join("") || "";
    const clean = text.replace(/```json|```/g, "").trim();
    const start = clean.indexOf("{"), end = clean.lastIndexOf("}");
    if (start === -1 || end === -1) return res.status(422).json({ error: "Invalid model response." });

    const parsed     = JSON.parse(clean.slice(start, end + 1));
    parsed.fileHash  = { sha256 };
    parsed.fileSize  = file.size;
    parsed.usedVision = useVision;
    res.json(parsed);
  } catch (err) {
    console.error("[analyze]", err.message);
    res.status(500).json({ error: "Analysis failed. Please try again." });
  } finally {
    activeUploads--;
  }
});

// ── PDF export ────────────────────────────────────────────────────────────────
app.post("/api/export", auth, express.json({ limit: "10mb" }), (req, res) => {
  const { result, fileName, scanDate } = req.body;
  if (!result || typeof result !== "object" || !fileName)
    return res.status(400).json({ error: "Invalid export data." });

  try {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="VERIDEX-${Date.now()}.pdf"`);
    doc.pipe(res);

    const vColor = result.verdict === "DEEPFAKE" ? "#CC0000"
      : result.verdict === "UNCERTAIN" ? "#CC6600" : "#006600";

    doc.rect(0, 0, doc.page.width, 70).fill("#0b0f1a");
    doc.fontSize(20).fillColor("#00d4ff").text("VERIDEX FORENSIC REPORT", 50, 18);
    doc.fontSize(8).fillColor("#4a6080").text("SOCIETAL ENFORCEMENT USE ONLY — CONFIDENTIAL", 50, 45);
    doc.moveDown(3);

    doc.fontSize(26).fillColor(vColor).text(result.verdict || "UNKNOWN", { align: "center" });
    doc.fontSize(14).fillColor("#333").text(`Manipulation Score: ${result.overallScore ?? "?"}%  |  Grade: ${result.evidenceGrade || "?"}`, { align: "center" });
    doc.fontSize(9).fillColor("#666").text(String(scanDate || ""), { align: "center" });
    doc.moveDown();

    const line = () => doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor("#ddd").stroke().moveDown(0.4);

    line();
    doc.fontSize(11).fillColor("#000").text("FILE INTEGRITY");
    doc.fontSize(8).fillColor("#333")
      .text(`File: ${String(fileName)}`)
      .text(`SHA-256: ${result.fileHash?.sha256 || "N/A"}`)
      .text(`Size: ${result.fileSize ? (result.fileSize / 1024).toFixed(1) + " KB" : "N/A"}`)
      .text(`Vision Analysis: ${result.usedVision ? "YES — actual image content examined" : "NO — metadata analysis only"}`);
    doc.moveDown(0.5);

    line();
    doc.fontSize(11).fillColor("#000").text("SUMMARY");
    doc.fontSize(9).fillColor("#333").text(String(result.summary || "N/A"));
    doc.moveDown(0.5);

    if (result.exifAnalysis) {
      line();
      doc.fontSize(11).fillColor("#000").text("EXIF / METADATA ANALYSIS");
      doc.fontSize(9).fillColor("#333").text(String(result.exifAnalysis));
      doc.moveDown(0.5);
    }
    if (Array.isArray(result.integrityFlags) && result.integrityFlags.length) {
      line();
      doc.fontSize(11).fillColor("#000").text("INTEGRITY FLAGS");
      result.integrityFlags.forEach(f => doc.fontSize(9).fillColor("#cc0000").text(`⚠  ${String(f)}`));
      doc.moveDown(0.5);
    }

    line();
    doc.fontSize(11).fillColor("#000").text("DETECTION FINDINGS");
    (result.findings || []).forEach((f, i) => {
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor("#000").text(`${i + 1}. ${String(f.category || "")}  [${String(f.risk || "")} — ${f.score ?? "?"}%]`);
      doc.fontSize(9).fillColor("#333").text(String(f.detail || ""));
      (f.indicators || []).forEach(ind => doc.fontSize(8).fillColor("#555").text(`    •  ${String(ind)}`));
    });
    doc.moveDown(0.5);

    line();
    doc.fontSize(11).fillColor("#000").text("INVESTIGATOR ACTIONS");
    (result.recommendations || []).forEach(r => doc.fontSize(9).fillColor("#333").text(`→  ${String(r)}`));
    doc.moveDown(0.5);

    line();
    doc.fontSize(11).fillColor("#000").text("CASE FILE NOTES");
    doc.fontSize(9).fillColor("#555").text(String(result.caseNotes || "N/A"));
    doc.moveDown(1.5);

    line();
    doc.fontSize(10).fillColor("#CC6600").text("FORENSIC DISCLAIMER — READ BEFORE RELYING ON THIS REPORT");
    doc.moveDown(0.3);
    doc.fontSize(8).fillColor("#555")
      .text("This report is AI-generated by VERIDEX Forensic AI (Claude, Anthropic) and constitutes a PROBABILISTIC ASSESSMENT ONLY. It is not the certified opinion of a qualified human forensic examiner.")
      .moveDown(0.2)
      .text("Analysis basis: Images ≤5MB receive visual AI inspection + metadata analysis. All other files receive metadata, filename, and MIME type analysis only.")
      .moveDown(0.2)
      .text("SCORING: 0–30% = AUTHENTIC | 31–69% = UNCERTAIN | 70–100% = DEEPFAKE")
      .moveDown(0.2)
      .text("This output MUST NOT be used as the sole basis for arrest, search, detention, charging decisions, or court submissions without independent verification by a certified forensic professional.")
      .moveDown(0.2)
      .text("CHAIN OF CUSTODY: Preserve original files using hardware write-blockers. Document SHA-256 hash before and after analysis.");
    doc.moveDown(1.5);

    doc.fontSize(7).fillColor("#aaa").text("VERIDEX FORENSIC AI — Powered by Claude AI (Anthropic) — Restricted Access — Societal Enforcement Use Only", { align: "center" });
    doc.end();
  } catch (err) {
    console.error("[export]", err.message);
    if (!res.headersSent) res.status(500).json({ error: "Export failed. Try again." });
  }
});

app.listen(PORT, () => console.log(`API server running on http://localhost:${PORT}`));
