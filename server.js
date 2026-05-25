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

// ── Environment ───────────────────────────────────────────────────────────────
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("FATAL: ANTHROPIC_API_KEY not set in .env"); process.exit(1);
}
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || (() => {
  const s = crypto.randomBytes(32).toString("hex");
  console.warn("[warn] JWT_SECRET not set — using ephemeral secret. Sessions won't survive server restart.");
  return s;
})();
const JWT_TTL = 8 * 3600; // 8 hours in seconds

function b64url(s) {
  return Buffer.from(s).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
}
function signJwt(payload) {
  const h = b64url(JSON.stringify({ alg:"HS256", typ:"JWT" }));
  const p = b64url(JSON.stringify(payload));
  const s = crypto.createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64")
    .replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
  return `${h}.${p}.${s}`;
}
function verifyJwt(token) {
  try {
    const [h, p, s] = token.split(".");
    const expected = crypto.createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64")
      .replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
    if (s !== expected) return null;
    const payload = JSON.parse(Buffer.from(p, "base64").toString());
    if (payload.exp && Date.now() > payload.exp * 1000) return null;
    return payload;
  } catch { return null; }
}

const app = express();

// ── CORS ──────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173", "http://localhost:5174",
  "capacitor://localhost", "https://localhost", "ionic://localhost",
  "https://veridex-two.vercel.app",
]);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.has(origin)) cb(null, true);
    else cb(new Error("CORS: origin not allowed"));
  },
}));

// ── Data directory (Railway Volume at /data, local falls back to cwd) ─────────
const DATA_DIR = process.env.DATA_DIR || process.cwd();
try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

// ── User store (users.json) ───────────────────────────────────────────────────
const USERS_FILE  = path.join(DATA_DIR, "users.json");
const scryptAsync = promisify(crypto.scrypt);

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, "utf8")); }
  catch { return {}; }
}
function saveUsers(users) {
  try { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }
  catch (e) { console.error("[users] save failed:", e.message); }
}
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scryptAsync(pw, salt, 64);
  return `${salt}:${hash.toString("hex")}`;
}
async function verifyPassword(pw, stored) {
  const [salt, hash] = stored.split(":");
  const hashBuf = Buffer.from(hash, "hex");
  const derived  = await scryptAsync(pw, salt, 64);
  return crypto.timingSafeEqual(hashBuf, derived);
}

// ── JWT helpers ───────────────────────────────────────────────────────────────
const REVOKED_FILE = path.join(DATA_DIR, "revoked.json");
function loadRevoked() {
  try { return new Set(JSON.parse(fs.readFileSync(REVOKED_FILE, "utf8"))); }
  catch { return new Set(); }
}
function saveRevoked(set) {
  try { fs.writeFileSync(REVOKED_FILE, JSON.stringify([...set])); }
  catch (e) { console.error("[revoked] save failed:", e.message); }
}
const revokedTokens = loadRevoked();

// Prune expired revoked tokens hourly
setInterval(() => {
  let changed = false;
  for (const t of revokedTokens) {
    if (!verifyJwt(t)) { revokedTokens.delete(t); changed = true; }
  }
  if (changed) saveRevoked(revokedTokens);
}, 3_600_000);

function issueToken(email) {
  return signJwt({ sub: email, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + JWT_TTL });
}

// ── Auth middleware ───────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers["x-auth-token"] || "";
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  if (revokedTokens.has(token)) return res.status(401).json({ error: "Session expired. Please log in again." });
  const payload = verifyJwt(token);
  if (!payload) return res.status(401).json({ error: "Session expired. Please log in again." });
  req.userId = payload.sub;
  req.token  = token;
  next();
}

// ── Case store (cases.json) ───────────────────────────────────────────────────
const CASES_FILE = path.join(DATA_DIR, "cases.json");

function loadCases() {
  try { return JSON.parse(fs.readFileSync(CASES_FILE, "utf8")); }
  catch { return { sequence: {}, cases: {} }; }
}
function saveCases(store) {
  try { fs.writeFileSync(CASES_FILE, JSON.stringify(store)); }
  catch (e) { console.error("[cases] save failed:", e.message); }
}
function nextCaseId(store) {
  const year = new Date().getFullYear().toString();
  store.sequence[year] = (store.sequence[year] || 0) + 1;
  return `VDX-${year}-${String(store.sequence[year]).padStart(4, "0")}`;
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
  windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true,
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

// ── PDF generator ─────────────────────────────────────────────────────────────
function generatePDF(caseObj, res) {
  try {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition",
      `attachment; filename="VERIDEX-${caseObj.id || Date.now()}.pdf"`);
    doc.pipe(res);

    const vColor = caseObj.verdict === "DEEPFAKE" ? "#CC0000"
      : caseObj.verdict === "UNCERTAIN" ? "#CC6600" : "#006600";

    // Header bar
    doc.rect(0, 0, doc.page.width, 80).fill("#0b0f1a");
    doc.fontSize(20).fillColor("#00d4ff").text("VERIDEX FORENSIC REPORT", 50, 18);
    doc.fontSize(8).fillColor("#4a6080")
      .text(`CASE: ${caseObj.id || "UNSAVED"} | SOCIETAL ENFORCEMENT USE ONLY — CONFIDENTIAL`, 50, 48)
      .text(`Generated: ${new Date().toISOString()}`, 50, 60);
    doc.moveDown(3);

    // Verdict block
    doc.fontSize(28).fillColor(vColor).text(caseObj.verdict || "UNKNOWN", { align: "center" });
    doc.fontSize(14).fillColor("#333")
      .text(`Manipulation Score: ${caseObj.overallScore ?? "?"}%  |  Risk: ${caseObj.overallRisk || "?"}  |  Grade: ${caseObj.evidenceGrade || "?"}`, { align: "center" });
    doc.fontSize(9).fillColor("#666")
      .text(`Status: ${caseObj.status || "Open"}  |  ${String(caseObj.createdAt || "")}`, { align: "center" });
    doc.moveDown();

    const line = () => doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y)
      .strokeColor("#ddd").stroke().moveDown(0.4);

    // File integrity
    line();
    doc.fontSize(11).fillColor("#000").text("FILE INTEGRITY");
    doc.fontSize(8).fillColor("#333")
      .text(`File: ${String(caseObj.fileName || "N/A")}`)
      .text(`MIME: ${caseObj.mimeType || "N/A"}`)
      .text(`SHA-256: ${caseObj.fileHash?.sha256 || "N/A"}`)
      .text(`Size: ${caseObj.fileSize ? (caseObj.fileSize / 1024).toFixed(1) + " KB" : "N/A"}`)
      .text(`Vision Analysis: ${caseObj.usedVision ? "YES — actual image content examined" : "NO — metadata analysis only"}`);
    doc.moveDown(0.5);

    // Summary
    line();
    doc.fontSize(11).fillColor("#000").text("EXECUTIVE SUMMARY");
    doc.fontSize(9).fillColor("#333").text(String(caseObj.summary || "N/A"));
    doc.moveDown(0.5);

    // EXIF
    if (caseObj.exifAnalysis) {
      line();
      doc.fontSize(11).fillColor("#000").text("EXIF / METADATA ANALYSIS");
      doc.fontSize(9).fillColor("#333").text(String(caseObj.exifAnalysis));
      doc.moveDown(0.5);
    }

    // Integrity flags
    if (Array.isArray(caseObj.integrityFlags) && caseObj.integrityFlags.length) {
      line();
      doc.fontSize(11).fillColor("#000").text("INTEGRITY FLAGS");
      caseObj.integrityFlags.forEach(f =>
        doc.fontSize(9).fillColor("#cc0000").text(`⚠  ${String(f)}`));
      doc.moveDown(0.5);
    }

    // Findings
    line();
    doc.fontSize(11).fillColor("#000").text("DETECTION FINDINGS");
    (caseObj.findings || []).forEach((f, i) => {
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor("#000")
        .text(`${i + 1}. ${String(f.category || "")}  [${String(f.risk || "")} — ${f.score ?? "?"}%]`);
      doc.fontSize(9).fillColor("#333").text(String(f.detail || ""));
      (f.indicators || []).forEach(ind =>
        doc.fontSize(8).fillColor("#555").text(`    •  ${String(ind)}`));
    });
    doc.moveDown(0.5);

    // Recommendations
    line();
    doc.fontSize(11).fillColor("#000").text("INVESTIGATOR ACTIONS");
    (caseObj.recommendations || []).forEach(r =>
      doc.fontSize(9).fillColor("#333").text(`→  ${String(r)}`));
    doc.moveDown(0.5);

    // Analyst notes
    if (caseObj.analystNotes) {
      line();
      doc.fontSize(11).fillColor("#000").text("ANALYST NOTES");
      doc.fontSize(9).fillColor("#333").text(String(caseObj.analystNotes));
      doc.moveDown(0.5);
    }

    // Case notes
    line();
    doc.fontSize(11).fillColor("#000").text("CASE FILE NOTES");
    doc.fontSize(9).fillColor("#555").text(String(caseObj.caseNotes || "N/A"));
    doc.moveDown(1.5);

    // Disclaimer
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

    doc.fontSize(7).fillColor("#aaa")
      .text("VERIDEX FORENSIC AI — Powered by Claude AI (Anthropic) — Restricted Access — Societal Enforcement Use Only", { align: "center" });
    doc.end();
  } catch (err) {
    console.error("[export]", err.message);
    if (!res.headersSent) res.status(500).json({ error: "Export failed. Try again." });
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get("/", (req, res) =>
  res.json({ status: "ok", service: "VERIDEX API", version: "2.0.0" }));

// ── Auth ──────────────────────────────────────────────────────────────────────

app.post("/api/register", authLimiter, express.json(), async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required." });
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email))  return res.status(400).json({ error: "Invalid email address." });
  if (password.length < 8)   return res.status(400).json({ error: "Password must be at least 8 characters." });

  const users = loadUsers();
  const key   = email.toLowerCase().trim();
  if (users[key]) return res.status(409).json({ error: "An account with this email already exists." });

  try {
    users[key] = {
      passwordHash: await hashPassword(password),
      createdAt: new Date().toISOString(),
      onboarded: false,
    };
    saveUsers(users);
    res.json({ success: true, token: issueToken(key), isNewUser: true });
  } catch {
    res.status(500).json({ error: "Registration failed. Try again." });
  }
});

app.post("/api/auth", authLimiter, express.json(), async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required." });
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) return res.status(400).json({ error: "Invalid email address." });

  const users = loadUsers();
  const key   = email.toLowerCase().trim();
  const user  = users[key];
  if (!user) return res.status(401).json({ error: "Invalid email or password." });

  try {
    if (!await verifyPassword(password, user.passwordHash))
      return res.status(401).json({ error: "Invalid email or password." });
    res.json({ success: true, token: issueToken(key), isNewUser: !user.onboarded });
  } catch {
    res.status(500).json({ error: "Authentication error. Try again." });
  }
});

app.post("/api/logout", auth, (req, res) => {
  revokedTokens.add(req.token);
  saveRevoked(revokedTokens);
  res.json({ success: true });
});

app.post("/api/refresh", auth, (req, res) => {
  revokedTokens.add(req.token);
  saveRevoked(revokedTokens);
  res.json({ success: true, token: issueToken(req.userId) });
});

// ── User profile ──────────────────────────────────────────────────────────────

app.get("/api/me", auth, (req, res) => {
  const users = loadUsers();
  const user  = users[req.userId];
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json({ email: req.userId, createdAt: user.createdAt, onboarded: user.onboarded });
});

app.post("/api/me/onboarded", auth, (req, res) => {
  const users = loadUsers();
  if (!users[req.userId]) return res.status(404).json({ error: "User not found." });
  users[req.userId].onboarded = true;
  saveUsers(users);
  res.json({ success: true });
});

app.put("/api/me/email", authLimiter, auth, express.json(), async (req, res) => {
  const { newEmail, password } = req.body || {};
  if (!newEmail || !password)
    return res.status(400).json({ error: "New email and current password required." });
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(newEmail)) return res.status(400).json({ error: "Invalid email address." });

  const users = loadUsers();
  const user  = users[req.userId];
  if (!user) return res.status(404).json({ error: "User not found." });

  try {
    if (!await verifyPassword(password, user.passwordHash))
      return res.status(401).json({ error: "Incorrect password." });

    const newKey = newEmail.toLowerCase().trim();
    if (users[newKey] && newKey !== req.userId)
      return res.status(409).json({ error: "Email already in use." });

    if (newKey !== req.userId) {
      users[newKey] = { ...user };
      delete users[req.userId];
      const store = loadCases();
      for (const c of Object.values(store.cases)) {
        if (c.userId === req.userId) c.userId = newKey;
      }
      saveCases(store);
    }
    saveUsers(users);
    revokedTokens.add(req.token);
    saveRevoked(revokedTokens);
    res.json({ success: true, token: issueToken(newKey) });
  } catch {
    res.status(500).json({ error: "Email update failed." });
  }
});

app.put("/api/me/password", authLimiter, auth, express.json(), async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: "Current and new password required." });
  if (newPassword.length < 8)
    return res.status(400).json({ error: "Password must be at least 8 characters." });

  const users = loadUsers();
  const user  = users[req.userId];
  if (!user) return res.status(404).json({ error: "User not found." });

  try {
    if (!await verifyPassword(currentPassword, user.passwordHash))
      return res.status(401).json({ error: "Incorrect current password." });
    users[req.userId].passwordHash = await hashPassword(newPassword);
    saveUsers(users);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Password update failed." });
  }
});

app.delete("/api/me", auth, express.json(), async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: "Password required to delete account." });

  const users = loadUsers();
  const user  = users[req.userId];
  if (!user) return res.status(404).json({ error: "User not found." });

  try {
    if (!await verifyPassword(password, user.passwordHash))
      return res.status(401).json({ error: "Incorrect password." });
    delete users[req.userId];
    saveUsers(users);
    const store = loadCases();
    for (const id of Object.keys(store.cases)) {
      if (store.cases[id].userId === req.userId) delete store.cases[id];
    }
    saveCases(store);
    revokedTokens.add(req.token);
    saveRevoked(revokedTokens);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Account deletion failed." });
  }
});

// ── Cases ─────────────────────────────────────────────────────────────────────

app.get("/api/cases", auth, (req, res) => {
  const store = loadCases();
  const list  = Object.values(store.cases)
    .filter(c => c.userId === req.userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ cases: list });
});

app.post("/api/cases", auth, express.json({ limit: "5mb" }), (req, res) => {
  const { analysis, fileName, fileType, fileSize, mimeType } = req.body || {};
  if (!analysis || !fileName) return res.status(400).json({ error: "Invalid case data." });

  const store = loadCases();
  const id    = nextCaseId(store);
  const now   = new Date().toISOString();

  store.cases[id] = {
    id,
    userId:          req.userId,
    createdAt:       now,
    updatedAt:       now,
    fileName:        String(fileName),
    fileType:        fileType    || "unknown",
    fileSize:        fileSize    || 0,
    mimeType:        mimeType    || "",
    fileHash:        analysis.fileHash        || {},
    verdict:         analysis.verdict         || "UNKNOWN",
    overallScore:    analysis.overallScore    ?? 0,
    overallRisk:     analysis.overallRisk     || "UNKNOWN",
    evidenceGrade:   analysis.evidenceGrade   || "D",
    summary:         analysis.summary         || "",
    findings:        analysis.findings        || [],
    recommendations: analysis.recommendations || [],
    exifAnalysis:    analysis.exifAnalysis    || "",
    integrityFlags:  analysis.integrityFlags  || [],
    caseNotes:       analysis.caseNotes       || "",
    usedVision:      analysis.usedVision      || false,
    analystNotes:    "",
    status:          "Open",
  };
  saveCases(store);
  res.status(201).json({ case: store.cases[id] });
});

app.get("/api/cases/:id", auth, (req, res) => {
  const store = loadCases();
  const c     = store.cases[req.params.id];
  if (!c || c.userId !== req.userId) return res.status(404).json({ error: "Case not found." });
  res.json({ case: c });
});

app.put("/api/cases/:id", auth, express.json(), (req, res) => {
  const store = loadCases();
  const c     = store.cases[req.params.id];
  if (!c || c.userId !== req.userId) return res.status(404).json({ error: "Case not found." });

  const { analystNotes, status } = req.body || {};
  const valid = ["Open", "Under Review", "Closed"];
  if (status !== undefined && !valid.includes(status))
    return res.status(400).json({ error: "Invalid status." });

  if (analystNotes !== undefined) c.analystNotes = String(analystNotes).slice(0, 5000);
  if (status       !== undefined) c.status = status;
  c.updatedAt = new Date().toISOString();
  saveCases(store);
  res.json({ case: c });
});

app.delete("/api/cases/:id", auth, (req, res) => {
  const store = loadCases();
  const c     = store.cases[req.params.id];
  if (!c || c.userId !== req.userId) return res.status(404).json({ error: "Case not found." });
  delete store.cases[req.params.id];
  saveCases(store);
  res.json({ success: true });
});

// ── Stats ─────────────────────────────────────────────────────────────────────

app.get("/api/stats", auth, (req, res) => {
  const store     = loadCases();
  const all       = Object.values(store.cases).filter(c => c.userId === req.userId);
  const sorted    = [...all].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({
    totalCases:        all.length,
    deepfakesDetected: all.filter(c => c.verdict === "DEEPFAKE").length,
    authenticFiles:    all.filter(c => c.verdict === "AUTHENTIC").length,
    uncertainFiles:    all.filter(c => c.verdict === "UNCERTAIN").length,
    openCases:         all.filter(c => c.status === "Open").length,
    closedCases:       all.filter(c => c.status === "Closed").length,
    avgScore:          all.length
      ? Math.round(all.reduce((s, c) => s + (c.overallScore || 0), 0) / all.length) : 0,
    recentCases:       sorted.slice(0, 5),
  });
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
    const sha256   = crypto.createHash("sha256").update(file.buffer).digest("hex");

    let exifData = null;
    try {
      exifData = await exifr.parse(file.buffer, { tiff: true, exif: true, gps: true, iptc: true });
    } catch { /* no EXIF */ }

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
      && ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(file.mimetype)
      && file.size <= 20 * 1024 * 1024;

    const messages = useVision
      ? [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: file.mimetype, data: file.buffer.toString("base64") } },
          { type: "text", text: `Forensic image analysis. Examine the actual image content AND the metadata below.\n\n${metaBlock}\n\nInspect for:\n1. GAN/diffusion artifacts — spectral anomalies, unnatural noise floor, tile/grid patterns\n2. Face/body manipulation — blending seams, lighting inconsistency, texture synthesis\n3. AI generation markers — missing sensor noise, synthetic skin, anatomical errors, AI software in EXIF\n4. Metadata integrity — missing fields, AI software tags (Midjourney/DALL-E/Stable Diffusion/Kling), timestamp anomalies\n5. Compression artifacts inconsistent with claimed camera origin\n\nScore strictly: 0-30 authentic, 31-69 uncertain, 70-100 deepfake/AI-generated.\nReturn ONLY the JSON.` },
        ]}]
      : [{ role: "user", content: `Forensic ${fileType} analysis.\n\n${metaBlock}\n${file.size > 5 * 1024 * 1024 ? "\nNote: File too large for vision — metadata-only analysis." : ""}\n\nAnalyze filename patterns, known AI platform naming conventions (kling_, runway_, sora_, etc), EXIF integrity, and metadata signals.\nScore strictly: 0-30 authentic, 31-69 uncertain, 70-100 deepfake/synthetic.\nReturn ONLY the JSON.` }];

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 4096, system: SYSTEM_PROMPT, messages }),
    });

    const data  = await response.json();
    if (data.type === "error") {
      console.error("[analyze] Anthropic API error:", JSON.stringify(data.error));
      const msg = data.error?.type === "invalid_api_key" ? "API key invalid — check Railway variables."
        : data.error?.type === "overloaded_error" ? "AI service overloaded. Try again in a moment."
        : data.error?.message || "Analysis service error. Try again.";
      return res.status(500).json({ error: msg });
    }

    const text  = data.content?.map(i => i.text || "").join("") || "";
    const clean = text.replace(/```json|```/g, "").trim();
    const start = clean.indexOf("{"), end = clean.lastIndexOf("}");
    if (start === -1 || end === -1) return res.status(422).json({ error: "Invalid model response." });

    const parsed      = JSON.parse(clean.slice(start, end + 1));
    parsed.fileHash   = { sha256 };
    parsed.fileSize   = file.size;
    parsed.mimeType   = file.mimetype;
    parsed.fileType   = fileType;
    parsed.usedVision = useVision;
    res.json(parsed);
  } catch (err) {
    console.error("[analyze]", err.message);
    res.status(500).json({ error: "Analysis failed. Please try again." });
  } finally {
    activeUploads--;
  }
});

// ── PDF Export ────────────────────────────────────────────────────────────────

app.post("/api/export/:caseId", auth, (req, res) => {
  const store = loadCases();
  const c     = store.cases[req.params.caseId];
  if (!c || c.userId !== req.userId) return res.status(404).json({ error: "Case not found." });
  generatePDF(c, res);
});

// Legacy: export from raw result object (used for unsaved scan results)
app.post("/api/export", auth, express.json({ limit: "10mb" }), (req, res) => {
  const { result, fileName, scanDate } = req.body;
  if (!result || typeof result !== "object" || !fileName)
    return res.status(400).json({ error: "Invalid export data." });
  generatePDF({ ...result, fileName, createdAt: scanDate, id: null }, res);
});

app.listen(PORT, () => console.log(`API server running on http://localhost:${PORT}`));
