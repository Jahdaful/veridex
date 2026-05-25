import { useState, useRef } from "react";

// ── Constants ─────────────────────────────────────────────────────────────────
const RISK_COLORS   = { HIGH: "#FF2D2D", MEDIUM: "#FF9500", LOW: "#30D158", CLEAN: "#30D158" };
const RISK_LABELS   = { HIGH: "DEEPFAKE", MEDIUM: "UNCERTAIN", LOW: "LIKELY REAL", CLEAN: "AUTHENTIC" };
const VERDICT_COLORS = { DEEPFAKE: "#FF2D2D", UNCERTAIN: "#FF9500", AUTHENTIC: "#30D158" };
const MAX_FILE_SIZE  = 50 * 1024 * 1024;

// ── Small components ──────────────────────────────────────────────────────────
function RiskBadge({ level }) {
  return (
    <span style={{
      background: RISK_COLORS[level] + "22", color: RISK_COLORS[level],
      border: `1px solid ${RISK_COLORS[level]}55`, borderRadius: 6,
      padding: "3px 10px", fontSize: 11, fontWeight: 700,
      letterSpacing: 1.2, fontFamily: "monospace",
    }}>
      {RISK_LABELS[level]}
    </span>
  );
}

function ProgressBar({ value, color }) {
  return (
    <div style={{ background: "#1a1f2e", borderRadius: 4, height: 6, width: "100%", overflow: "hidden" }}>
      <div style={{
        width: `${value}%`, height: "100%", background: color, borderRadius: 4,
        transition: "width 1.2s cubic-bezier(.4,0,.2,1)", boxShadow: `0 0 8px ${color}88`,
      }} />
    </div>
  );
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 10, color: "#4a6080", letterSpacing: 3, marginBottom: 12 }}>{children}</div>;
}

function Card({ children, style }) {
  return (
    <div style={{ background: "#0d1220", border: "1px solid #1e2d4a", borderRadius: 12, padding: 16, ...style }}>
      {children}
    </div>
  );
}

// ── API helpers ───────────────────────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_URL || "";

async function apiAuth(email, password) {
  const res = await fetch(`${API_BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Authentication failed");
  return data;
}

async function apiRegister(email, password) {
  const res = await fetch(`${API_BASE}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Registration failed");
  return data;
}

async function apiLogout(token) {
  try {
    await fetch(`${API_BASE}/api/logout`, { method: "POST", headers: { "x-auth-token": token } });
  } catch { /* best-effort */ }
}

async function apiAnalyze(file, fileType, token) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("fileName", file.name);
  formData.append("fileType", fileType);
  const res = await fetch(`${API_BASE}/api/analyze`, {
    method: "POST",
    headers: { "x-auth-token": token },
    body: formData,
  });
  if (res.status === 401) throw new Error("Unauthorized");
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || "Analysis failed");
  return data;
}

async function apiExport(payload, token) {
  return fetch(`${API_BASE}/api/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-auth-token": token },
    body: JSON.stringify(payload),
  });
}

async function apiChangeEmail(token, newEmail, password) {
  const res = await fetch(`${API_BASE}/api/me/email`, { method: "PUT", headers: { "Content-Type": "application/json", "x-auth-token": token }, body: JSON.stringify({ newEmail, password }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Email update failed");
  return data;
}
async function apiChangePassword(token, currentPassword, newPassword) {
  const res = await fetch(`${API_BASE}/api/me/password`, { method: "PUT", headers: { "Content-Type": "application/json", "x-auth-token": token }, body: JSON.stringify({ currentPassword, newPassword }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Password update failed");
  return data;
}
async function apiDeleteAccount(token, password) {
  const res = await fetch(`${API_BASE}/api/me`, { method: "DELETE", headers: { "Content-Type": "application/json", "x-auth-token": token }, body: JSON.stringify({ password }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Deletion failed");
}
function emailFromToken(t) { try { return JSON.parse(atob(t.split(".")[1])).sub||"" } catch { return "" } }

// ── Case storage ──────────────────────────────────────────────────────────────
function loadCases() { return JSON.parse(localStorage.getItem("veridex_cases") || "[]"); }
function saveCase(result, fileName) {
  const cases = loadCases();
  cases.unshift({ id: Date.now(), fileName, verdict: result.verdict,
    overallScore: result.overallScore, overallRisk: result.overallRisk,
    scanDate: new Date().toISOString(), result });
  localStorage.setItem("veridex_cases", JSON.stringify(cases.slice(0, 50)));
}

// ── Modal content ─────────────────────────────────────────────────────────────
function TermsContent() {
  return (
    <div style={{ fontSize: 11, color: "#6a8090", lineHeight: 1.8 }}>
      <p style={{ color: "#FF9500", fontSize: 10, letterSpacing: 1 }}>Effective Date: 2026-05-24 · Version 1.0 · Societal Enforcement Use Only</p>

      <h4 style={{ color: "#00d4ff", fontSize: 10, letterSpacing: 2, margin: "14px 0 6px" }}>1. AUTHORIZED USE</h4>
      <p>Access to VERIDEX Forensic AI is granted exclusively to duly authorized societal enforcement officers, licensed forensic investigators, and certified digital forensics professionals acting within the scope of their official duties. By creating an account, you represent and warrant that you fall within one of these categories.</p>

      <h4 style={{ color: "#00d4ff", fontSize: 10, letterSpacing: 2, margin: "14px 0 6px" }}>2. ACCOUNT RESPONSIBILITY</h4>
      <p>You are solely responsible for maintaining the confidentiality of your account credentials. You must not share your login credentials with any other person. Each account is strictly personal and non-transferable. You must notify your system administrator immediately of any unauthorized use of your account.</p>

      <h4 style={{ color: "#00d4ff", fontSize: 10, letterSpacing: 2, margin: "14px 0 6px" }}>3. PROHIBITED USES</h4>
      <p>You must not use this system to: conduct unauthorized surveillance of any individual; produce reports intended to mislead any court, tribunal, or agency; analyze media of persons not subject to an active, lawfully authorized investigation; share system access with unauthorized personnel; or use analysis outputs to harass, defame, or harm any individual.</p>

      <h4 style={{ color: "#00d4ff", fontSize: 10, letterSpacing: 2, margin: "14px 0 6px" }}>4. AI DISCLAIMER</h4>
      <p>All analysis outputs are AI-generated probabilistic assessments — not the certified opinion of a qualified human forensic examiner. Results must be independently verified by a qualified professional before use in any legal proceeding. The system may produce false positives and false negatives.</p>

      <h4 style={{ color: "#00d4ff", fontSize: 10, letterSpacing: 2, margin: "14px 0 6px" }}>5. DATA HANDLING</h4>
      <p>Uploaded files are processed in server memory only and are not written to disk. Files are discarded immediately after analysis. Images ≤5MB are transmitted to the Anthropic Claude API for AI analysis. GPS coordinates extracted from EXIF data are not sent to the client or included in reports.</p>

      <h4 style={{ color: "#00d4ff", fontSize: 10, letterSpacing: 2, margin: "14px 0 6px" }}>6. DISCLAIMER OF WARRANTIES</h4>
      <p>THE SYSTEM IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND. AI-GENERATED FORENSIC ANALYSIS IS PROBABILISTIC AND SUBJECT TO ERROR. RESULTS DO NOT CONSTITUTE CONCLUSIVE PROOF OF AUTHENTICITY OR MANIPULATION.</p>

      <h4 style={{ color: "#00d4ff", fontSize: 10, letterSpacing: 2, margin: "14px 0 6px" }}>7. LIMITATION OF LIABILITY</h4>
      <p>IN NO EVENT SHALL THE DEVELOPER OR AGENCY BE LIABLE FOR WRONGFUL CONVICTION OR ACQUITTAL, DIRECT OR CONSEQUENTIAL DAMAGES, OR LOSS OF DATA OR EVIDENCE INTEGRITY. AUTHORIZED USERS ASSUME ALL RISK ARISING FROM USE OF THIS SYSTEM.</p>

      <h4 style={{ color: "#00d4ff", fontSize: 10, letterSpacing: 2, margin: "14px 0 6px" }}>8. COMPLIANCE</h4>
      <p>Authorized Users are responsible for ensuring their use of this system complies with all applicable laws, regulations, and agency policies, including CJIS Security Policy, GDPR, and any applicable AI-in-societal-enforcement regulations.</p>
    </div>
  );
}

function PrivacyContent() {
  return (
    <div style={{ fontSize: 11, color: "#6a8090", lineHeight: 1.8 }}>
      <p style={{ color: "#FF9500", fontSize: 10, letterSpacing: 1 }}>Effective Date: 2026-05-24 · Version 1.0 · Societal Enforcement Use Only</p>

      <h4 style={{ color: "#00d4ff", fontSize: 10, letterSpacing: 2, margin: "14px 0 6px" }}>1. WHAT WE COLLECT</h4>
      <p><strong style={{ color: "#c8d6e8" }}>Account data:</strong> Your email address and a cryptographically hashed password (scrypt + random salt). Your plaintext password is never stored or logged.</p>
      <p><strong style={{ color: "#c8d6e8" }}>Session tokens:</strong> A 256-bit cryptographically random session token stored server-side with an 8-hour TTL, and in your browser's localStorage for session persistence.</p>
      <p><strong style={{ color: "#c8d6e8" }}>Uploaded files:</strong> Loaded into server memory for analysis only. Never written to disk. Discarded immediately after analysis completes.</p>

      <h4 style={{ color: "#00d4ff", fontSize: 10, letterSpacing: 2, margin: "14px 0 6px" }}>2. WHAT WE DO NOT COLLECT</h4>
      <p>We do not collect or store: uploaded file content beyond the analysis request; GPS coordinates extracted from EXIF data (presence is flagged, coordinates are discarded); analysis results (these are returned to your device only); or any analytics, tracking, or telemetry data.</p>

      <h4 style={{ color: "#00d4ff", fontSize: 10, letterSpacing: 2, margin: "14px 0 6px" }}>3. THIRD-PARTY PROCESSORS</h4>
      <p><strong style={{ color: "#c8d6e8" }}>Anthropic (Claude AI):</strong> Images ≤5MB and associated file metadata are transmitted to the Anthropic Claude API for AI-powered forensic analysis. This transmission is governed by Anthropic's Terms of Service and Privacy Policy. Agencies operating under CJIS Security Policy or GDPR must verify that Anthropic's data processing terms are compatible with their requirements before submitting sensitive evidence materials.</p>

      <h4 style={{ color: "#00d4ff", fontSize: 10, letterSpacing: 2, margin: "14px 0 6px" }}>4. DATA RETENTION</h4>
      <p><strong style={{ color: "#c8d6e8" }}>Uploaded files:</strong> Not retained — in-memory only, discarded after analysis.</p>
      <p><strong style={{ color: "#c8d6e8" }}>Session tokens:</strong> Auto-expire after 8 hours. Invalidated immediately on logout.</p>
      <p><strong style={{ color: "#c8d6e8" }}>Account data:</strong> Retained until account deletion. Contact your system administrator to request deletion.</p>
      <p><strong style={{ color: "#c8d6e8" }}>Case history:</strong> Stored in your browser's localStorage only — never transmitted to the server. You may clear it at any time from the Case History screen.</p>
      <p><strong style={{ color: "#c8d6e8" }}>PDF exports:</strong> Downloaded to your local device only. Not stored server-side.</p>

      <h4 style={{ color: "#00d4ff", fontSize: 10, letterSpacing: 2, margin: "14px 0 6px" }}>5. SECURITY MEASURES</h4>
      <p>Passwords are hashed using scrypt with a unique random salt per account. Session tokens are 256-bit cryptographically random values. Authentication is rate-limited to 5 attempts per 15 minutes per IP. CORS is restricted to authorized origins. All uploads undergo magic byte validation. A maximum of 3 concurrent uploads are permitted.</p>

      <h4 style={{ color: "#00d4ff", fontSize: 10, letterSpacing: 2, margin: "14px 0 6px" }}>6. YOUR RIGHTS</h4>
      <p>Under GDPR and applicable data protection laws, you have rights to access, rectify, and erase your personal data. Contact your agency's data protection officer or system administrator to exercise these rights. Note that deletion of your account will invalidate all active sessions.</p>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function ForensicsApp() {
  const savedAuth = localStorage.getItem("veridex_auth");

  const [screen,       setScreen]       = useState(savedAuth ? "home" : "login");
  const [authToken,    setAuthToken]    = useState(savedAuth || "");
  const [authMode,     setAuthMode]     = useState("login"); // "login" | "signup"
  const [email,        setEmail]        = useState("");
  const [password,     setPassword]     = useState("");
  const [confirmPw,    setConfirmPw]    = useState("");
  const [termsChecked, setTermsChecked] = useState(false);
  const [authLoading,  setAuthLoading]  = useState(false);
  const [modal,        setModal]        = useState(null); // null | "terms" | "privacy"
  const [file,         setFile]         = useState(null);
  const [fileType,     setFileType]     = useState(null);
  const [result,       setResult]       = useState(null);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanStep,     setScanStep]     = useState("");
  const [error,        setError]        = useState(null);
  const [cases,        setCases]        = useState(loadCases);
  const [exporting,    setExporting]    = useState(false);
  const [scanDate,     setScanDate]     = useState("");
  const [legalTab,       setLegalTab]       = useState(0);
  const [userEmail,      setUserEmail]      = useState(savedAuth ? emailFromToken(savedAuth) : "");
  const [settingsTab,    setSettingsTab]    = useState("email");
  const [newEmail,       setNewEmail]       = useState("");
  const [emailPw,        setEmailPw]        = useState("");
  const [curPw,          setCurPw]          = useState("");
  const [newPw,          setNewPw]          = useState("");
  const [confirmNewPw,   setConfirmNewPw]   = useState("");
  const [deletePw,       setDeletePw]       = useState("");
  const [deleteConfirm,  setDeleteConfirm]  = useState(false);
  const [settingsMsg,    setSettingsMsg]    = useState(null);
  const [settingsLoading,setSettingsLoading]= useState(false);
  const fileRef = useRef();

  const SCAN_STEPS = [
    "Initializing forensic engine...",
    "Extracting file metadata & hashes...",
    "Running deepfake neural analysis...",
    "Scanning biometric markers...",
    "Analyzing EXIF integrity...",
    "Detecting AI generation signatures...",
    "Cross-referencing forensic database...",
    "Generating authenticity report...",
  ];

  // ── Auth handlers ───────────────────────────────────────────────────────────
  function switchAuthMode(mode) {
    setAuthMode(mode);
    setError(null);
    setEmail("");
    setPassword("");
    setConfirmPw("");
    setTermsChecked(false);
  }

  async function handleLogin(e) {
    e.preventDefault();
    setAuthLoading(true);
    setError(null);
    try {
      const data = await apiAuth(email, password);
      localStorage.setItem("veridex_auth", data.token);
      setAuthToken(data.token);
      setScreen("home");
    } catch (err) {
      setError(err.message);
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleSignup(e) {
    e.preventDefault();
    if (password !== confirmPw)  { setError("Passwords do not match."); return; }
    if (password.length < 8)     { setError("Password must be at least 8 characters."); return; }
    setAuthLoading(true);
    setError(null);
    try {
      const data = await apiRegister(email, password);
      localStorage.setItem("veridex_auth", data.token);
      setAuthToken(data.token);
      setScreen("home");
    } catch (err) {
      setError(err.message);
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    await apiLogout(authToken);
    localStorage.removeItem("veridex_auth");
    setAuthToken("");
    setScreen("login");
    switchAuthMode("login");
  }

  function handleUnauthorized() {
    localStorage.removeItem("veridex_auth");
    setAuthToken("");
    setError("Session expired. Please log in again.");
    setScreen("login");
  }

  async function handleChangeEmail(e) {
    e.preventDefault();
    setSettingsLoading(true); setSettingsMsg(null);
    try {
      const data = await apiChangeEmail(authToken, newEmail, emailPw);
      localStorage.setItem("veridex_auth", data.token);
      setAuthToken(data.token);
      setUserEmail(newEmail.toLowerCase().trim());
      setNewEmail(""); setEmailPw("");
      setSettingsMsg({ text: "Email updated successfully.", type: "success" });
    } catch (err) { setSettingsMsg({ text: err.message, type: "error" }); }
    finally { setSettingsLoading(false); }
  }
  async function handleChangePassword(e) {
    e.preventDefault();
    if (newPw !== confirmNewPw) { setSettingsMsg({ text: "Passwords do not match.", type: "error" }); return; }
    if (newPw.length < 8) { setSettingsMsg({ text: "Min 8 characters.", type: "error" }); return; }
    setSettingsLoading(true); setSettingsMsg(null);
    try {
      await apiChangePassword(authToken, curPw, newPw);
      setCurPw(""); setNewPw(""); setConfirmNewPw("");
      setSettingsMsg({ text: "Password updated.", type: "success" });
    } catch (err) { setSettingsMsg({ text: err.message, type: "error" }); }
    finally { setSettingsLoading(false); }
  }
  async function handleDeleteAccount(e) {
    e.preventDefault();
    setSettingsLoading(true); setSettingsMsg(null);
    try { await apiDeleteAccount(authToken, deletePw); await handleLogout(); }
    catch (err) { setSettingsMsg({ text: err.message, type: "error" }); setSettingsLoading(false); }
  }

  // ── File / scan handlers ────────────────────────────────────────────────────
  async function handleFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > MAX_FILE_SIZE) { setError("File too large. Maximum 50MB."); return; }
    setFile(f);
    setError(null);
    const type = f.type.startsWith("video") ? "video" : f.type.startsWith("audio") ? "audio" : "image";
    setFileType(type);
    setScreen("scanning");
    setScanProgress(0);
    setScanDate(new Date().toLocaleString());

    for (let i = 0; i < SCAN_STEPS.length; i++) {
      setScanStep(SCAN_STEPS[i]);
      setScanProgress(Math.round(((i + 1) / SCAN_STEPS.length) * 85));
      await new Promise(r => setTimeout(r, 600));
    }
    try {
      const analysis = await apiAnalyze(f, type, authToken);
      setScanProgress(100);
      setScanStep("Complete.");
      await new Promise(r => setTimeout(r, 400));
      setResult(analysis);
      saveCase(analysis, f.name);
      setCases(loadCases());
      setScreen("report");
    } catch (err) {
      if (err.message === "Unauthorized") { handleUnauthorized(); return; }
      setError(err.message);
      setScreen("home");
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const res = await apiExport({ result, fileName: file?.name, scanDate }, authToken);
      if (res.status === 401) { handleUnauthorized(); return; }
      if (!res.ok) { setError("Export failed. Try again."); return; }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = `VERIDEX-${Date.now()}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch { setError("Export failed."); }
    finally { setExporting(false); }
  }

  function reset() {
    setScreen("home"); setFile(null); setResult(null);
    setScanProgress(0); setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function viewCase(c) {
    setResult(c.result);
    setFile({ name: c.fileName });
    setScanDate(new Date(c.scanDate).toLocaleString());
    setScreen("report");
  }

  // ── Styles ──────────────────────────────────────────────────────────────────
  const S = {
    shell:    { minHeight: "100vh", background: "#080c14", display: "flex", justifyContent: "center", fontFamily: "'Courier New', monospace" },
    phone:    { width: 390, minHeight: "100vh", background: "#0b0f1a", display: "flex", flexDirection: "column", position: "relative" },
    topBar:   { background: "#0d1220", borderBottom: "1px solid #1e2d4a", padding: "14px 20px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 10 },
    logo:     { fontSize: 13, fontWeight: 700, color: "#00d4ff", letterSpacing: 3 },
    badge:    { background: "#00d4ff22", border: "1px solid #00d4ff44", borderRadius: 4, padding: "2px 8px", fontSize: 9, color: "#00d4ff", letterSpacing: 1.5 },
    content:  { flex: 1, padding: "24px 20px", overflowY: "auto" },
    btn:      { width: "100%", padding: "16px", background: "linear-gradient(135deg,#00d4ff22,#0066ff22)", border: "1px solid #00d4ff66", borderRadius: 14, color: "#00d4ff", fontSize: 13, fontWeight: 700, letterSpacing: 2, cursor: "pointer", fontFamily: "monospace" },
    btnGhost: { flex: 1, padding: 14, background: "#0d1220", border: "1px solid #1e2d4a", borderRadius: 12, color: "#4a6080", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "monospace", letterSpacing: 1 },
  };

  const inputStyle = {
    width: "100%", boxSizing: "border-box", background: "#0d1220",
    border: "1px solid #1e2d4a", borderRadius: 10, padding: "14px 16px",
    color: "#e8eaf6", fontFamily: "monospace", fontSize: 13, outline: "none",
  };

  return (
    <div style={S.shell}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes glow{0%,100%{box-shadow:0 0 20px #00d4ff44}50%{box-shadow:0 0 40px #00d4ff88}}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#0b0f1a}::-webkit-scrollbar-thumb{background:#1e2d4a;border-radius:2px}
        input:focus{border-color:#00d4ff66 !important}
        .tab-btn{flex:1;padding:10px 0;border-radius:10px;font-size:10px;font-weight:700;cursor:pointer;font-family:monospace;letter-spacing:1.5px;transition:all .2s}
        .tab-btn.active{background:#00d4ff11;border:1px solid #00d4ff44;color:#00d4ff}
        .tab-btn.inactive{background:#0d1220;border:1px solid #1e2d4a;color:#4a6080}
        .legal-tab{flex:1;padding:8px;background:#0d1220;border:1px solid #1e2d4a;border-radius:8px;color:#4a6080;font-size:9px;font-weight:700;cursor:pointer;font-family:monospace;letter-spacing:1px;text-align:center}
        .legal-tab.active{background:#00d4ff11;border-color:#00d4ff44;color:#00d4ff}
        .legal-body{max-height:520px;overflow-y:auto;font-size:11px;color:#6a8090;line-height:1.8;padding:4px}
        .legal-body h2{color:#00d4ff;font-size:11px;letter-spacing:2px;margin:16px 0 6px;border-bottom:1px solid #1e2d4a;padding-bottom:6px}
        .legal-body h2:first-child{margin-top:0}
        .legal-body h3{color:#8aaabf;font-size:10px;letter-spacing:1px;margin:10px 0 4px}
        .legal-body p{margin:0 0 8px}
        .legal-body ul{margin:0 0 8px;padding-left:16px}
        .legal-body li{margin-bottom:4px}
        .legal-body table{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:10px}
        .legal-body th{color:#4a6080;text-align:left;padding:4px 6px;border-bottom:1px solid #1e2d4a}
        .legal-body td{color:#6a8090;padding:4px 6px;border-bottom:1px solid #0d1220}
        input[type=checkbox]{accent-color:#00d4ff;width:15px;height:15px;cursor:pointer;flex-shrink:0;margin-top:2px}
        .modal-link{background:none;border:none;color:#00d4ff;font-family:monospace;font-size:11px;cursor:pointer;padding:0;text-decoration:underline;text-underline-offset:2px}
      `}</style>
      <div style={S.phone}>

        {/* ── Top bar ─────────────────────────────────────────────────────── */}
        <div style={S.topBar}>
          <div style={S.logo}>VERIDEX</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={S.badge}>SOCIETAL ENFORCEMENT</div>
            {screen !== "login" && (
              <>
                <button onClick={() => { setSettingsMsg(null); setDeleteConfirm(false); setScreen("settings"); }} style={{ background: "none", border: "none", color: "#2a3a55", fontSize: 10, cursor: "pointer", fontFamily: "monospace", letterSpacing: 1 }}>SETTINGS</button>
                <button onClick={handleLogout} style={{ background: "none", border: "none", color: "#2a3a55", fontSize: 10, cursor: "pointer", fontFamily: "monospace", letterSpacing: 1 }}>LOGOUT</button>
              </>
            )}
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#30D158", animation: "pulse 2s infinite", boxShadow: "0 0 8px #30D158" }} />
          </div>
        </div>

        <div style={S.content}>

          {/* ── LOGIN / SIGNUP ──────────────────────────────────────────────── */}
          {screen === "login" && (
            <div style={{ animation: "fadeIn .4s ease" }}>

              {/* Header */}
              <div style={{ marginBottom: 24, textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#00d4ff", letterSpacing: 3, marginBottom: 10 }}>FORENSIC AI DETECTION SUITE</div>
                <div style={{ fontSize: 26, color: "#e8eaf6", fontWeight: 700, marginBottom: 6, letterSpacing: 2 }}>VERIDEX</div>
                <div style={{ fontSize: 10, color: "#4a6080", marginBottom: 16 }}>v2.0 · Forensic Media Analysis</div>

                {/* Disclaimer */}
                <div style={{ background: "#FF2D2D08", border: "1px solid #FF2D2D22", borderRadius: 8, padding: "10px 14px", textAlign: "left" }}>
                  <div style={{ fontSize: 9, color: "#FF2D2D", letterSpacing: 2, marginBottom: 4, fontWeight: 700 }}>⚠ RESTRICTED ACCESS</div>
                  <div style={{ fontSize: 10, color: "#7a5050", lineHeight: 1.6 }}>
                    Authorized access only. This tool is for societal enforcement purposes. Unauthorized access is prohibited.
                  </div>
                </div>
              </div>

              {/* Mode tabs */}
              <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
                <button className={`tab-btn ${authMode === "login" ? "active" : "inactive"}`} onClick={() => switchAuthMode("login")}>LOGIN</button>
                <button className={`tab-btn ${authMode === "signup" ? "active" : "inactive"}`} onClick={() => switchAuthMode("signup")}>CREATE ACCOUNT</button>
              </div>

              {/* Error */}
              {error && (
                <div style={{ background: "#FF2D2D11", border: "1px solid #FF2D2D44", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "#FF6060" }}>
                  {error}
                </div>
              )}

              {/* LOGIN form */}
              {authMode === "login" && (
                <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 9, color: "#4a6080", letterSpacing: 2, marginBottom: 7 }}>EMAIL ADDRESS</div>
                    <input
                      type="email" value={email} onChange={e => setEmail(e.target.value)}
                      placeholder="civil@agency.truth" autoFocus required
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: "#4a6080", letterSpacing: 2, marginBottom: 7 }}>PASSWORD</div>
                    <input
                      type="password" value={password} onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••••" required
                      style={{ ...inputStyle, letterSpacing: "3px" }}
                    />
                  </div>
                  <button
                    type="submit"
                    style={{ ...S.btn, marginTop: 4, animation: "glow 3s infinite", opacity: authLoading ? 0.6 : 1 }}
                    disabled={authLoading}
                  >
                    {authLoading ? "AUTHENTICATING..." : "⊕ LOGIN"}
                  </button>
                  <div style={{ textAlign: "center", marginTop: 10 }}>
                    <button type="button" onClick={() => switchAuthMode("forgot")} style={{ background: "none", border: "none", color: "#4a6080", fontSize: 10, cursor: "pointer", fontFamily: "monospace", letterSpacing: 1, textDecoration: "underline" }}>Forgot password?</button>
                  </div>
                </form>
              )}

              {/* SIGNUP form */}
              {authMode === "signup" && (
                <form onSubmit={handleSignup} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 9, color: "#4a6080", letterSpacing: 2, marginBottom: 7 }}>EMAIL ADDRESS</div>
                    <input
                      type="email" value={email} onChange={e => setEmail(e.target.value)}
                      placeholder="civil@agency.truth" autoFocus required
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: "#4a6080", letterSpacing: 2, marginBottom: 7 }}>
                      PASSWORD <span style={{ color: "#2a3a55" }}>— min 8 characters</span>
                    </div>
                    <input
                      type="password" value={password} onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••••" required
                      style={{ ...inputStyle, letterSpacing: "3px" }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: "#4a6080", letterSpacing: 2, marginBottom: 7 }}>CONFIRM PASSWORD</div>
                    <input
                      type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                      placeholder="••••••••••" required
                      style={{ ...inputStyle, letterSpacing: "3px" }}
                    />
                  </div>

                  {/* T&C checkbox */}
                  <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", background: "#0d1220", border: "1px solid #1e2d4a", borderRadius: 10, padding: "12px 14px" }}>
                    <input
                      type="checkbox" checked={termsChecked}
                      onChange={e => setTermsChecked(e.target.checked)}
                    />
                    <span style={{ fontSize: 11, color: "#6a8090", lineHeight: 1.6 }}>
                      I confirm I am an authorized societal enforcement officer, and I agree to the{" "}
                      <button type="button" className="modal-link" onClick={() => setModal("terms")}>Terms &amp; Conditions</button>
                      {" "}and{" "}
                      <button type="button" className="modal-link" onClick={() => setModal("privacy")}>Privacy Policy</button>.
                    </span>
                  </label>

                  <button
                    type="submit"
                    style={{ ...S.btn, opacity: (termsChecked && !authLoading) ? 1 : 0.35, cursor: (termsChecked && !authLoading) ? "pointer" : "not-allowed", animation: termsChecked ? "glow 3s infinite" : "none" }}
                    disabled={!termsChecked || authLoading}
                  >
                    {authLoading ? "CREATING ACCOUNT..." : "⊕ CREATE ACCOUNT"}
                  </button>
                </form>
              )}

              {authMode === "forgot" && (
                <div style={{ textAlign: "center", padding: "8px 0" }}>
                  <div style={{ fontSize: 13, color: "#e8eaf6", marginBottom: 10, fontWeight: 700, letterSpacing: 1 }}>PASSWORD RESET</div>
                  <div style={{ fontSize: 11, color: "#6a8090", lineHeight: 1.8, marginBottom: 20 }}>
                    Contact your system administrator with your registered email address to have your password reset.
                  </div>
                  <button onClick={() => switchAuthMode("login")} style={{ ...S.btnGhost, width: "100%" }}>← BACK TO LOGIN</button>
                </div>
              )}

              <div style={{ textAlign: "center", fontSize: 9, color: "#1e2d4a", marginTop: 24, lineHeight: 1.8 }}>
                VERIDEX FORENSIC AI · CLASSIFIED<br />
                SOCIETAL ENFORCEMENT USE ONLY
              </div>
            </div>
          )}

          {/* ── HOME ────────────────────────────────────────────────────────── */}
          {screen === "home" && (
            <div style={{ animation: "fadeIn .4s ease" }}>
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, color: "#00d4ff", letterSpacing: 3, marginBottom: 8 }}>FORENSIC AI DETECTION SUITE</div>
                <div style={{ fontSize: 20, color: "#e8eaf6", fontWeight: 700, lineHeight: 1.3, marginBottom: 8 }}>Media Authenticity<br />Analysis System</div>
                <div style={{ fontSize: 12, color: "#4a6080", lineHeight: 1.6 }}>Upload video, image, or audio for AI manipulation detection, deepfake analysis, and identity modification screening.</div>
              </div>
              {error && <div style={{ background: "#FF2D2D11", border: "1px solid #FF2D2D44", borderRadius: 10, padding: 12, marginBottom: 20, fontSize: 12, color: "#FF6060" }}>{error}</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
                {[
                  { icon: "◈", label: "Deepfake Video Detection",    desc: "GAN artifacts, temporal inconsistencies, face swap markers" },
                  { icon: "◉", label: "AI Image Analysis",           desc: "Vision AI · EXIF integrity · diffusion fingerprints" },
                  { icon: "◎", label: "Voice Clone Detection",       desc: "Synthetic audio markers, frequency pattern analysis" },
                  { icon: "◍", label: "Identity Modification Scan",  desc: "BBL, rhinoplasty, facial fillers, biometric evasion markers" },
                ].map((cap, i) => (
                  <Card key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                    <div style={{ fontSize: 20, color: "#00d4ff", lineHeight: 1, marginTop: 2 }}>{cap.icon}</div>
                    <div>
                      <div style={{ fontSize: 13, color: "#c8d6e8", fontWeight: 700, marginBottom: 3 }}>{cap.label}</div>
                      <div style={{ fontSize: 11, color: "#4a6080", lineHeight: 1.5 }}>{cap.desc}</div>
                    </div>
                  </Card>
                ))}
              </div>
              <input type="file" ref={fileRef} accept="video/*,image/*,audio/*" style={{ display: "none" }} onChange={handleFile} />
              <button onClick={() => fileRef.current.click()} style={{ ...S.btn, marginBottom: 12, animation: "glow 3s infinite" }}>⬆ UPLOAD MEDIA FILE</button>
              {cases.length > 0 && (
                <button onClick={() => setScreen("cases")} style={{ ...S.btnGhost, width: "100%", textAlign: "center" }}>
                  ◧ CASE HISTORY ({cases.length})
                </button>
              )}
              <div style={{ textAlign: "center", fontSize: 10, color: "#2a3a55", marginTop: 12 }}>VIDEO · IMAGE · AUDIO · MAX 50MB · ENCRYPTED</div>
              <div style={{ textAlign: "center", marginTop: 10 }}>
                <button onClick={() => setScreen("legal")} style={{ background: "none", border: "none", color: "#2a3a55", fontSize: 9, cursor: "pointer", fontFamily: "monospace", letterSpacing: 1, textDecoration: "underline" }}>
                  LEGAL · PRIVACY · TERMS · AUP
                </button>
              </div>
            </div>
          )}

          {/* ── SCANNING ─────────────────────────────────────────────────────── */}
          {screen === "scanning" && (
            <div style={{ animation: "fadeIn .3s ease", textAlign: "center" }}>
              <div style={{ marginBottom: 40 }}>
                <div style={{ fontSize: 11, color: "#4a6080", letterSpacing: 3, marginBottom: 20 }}>ANALYZING FILE</div>
                <div style={{ fontSize: 13, color: "#c8d6e8", marginBottom: 6, fontWeight: 700 }}>{file?.name}</div>
                <div style={{ fontSize: 11, color: "#4a6080" }}>{file && (file.size / 1024).toFixed(1)} KB · {fileType?.toUpperCase()}</div>
              </div>
              <div style={{ width: 140, height: 140, margin: "0 auto 40px", borderRadius: "50%", border: "2px solid #1e2d4a", background: "radial-gradient(circle,#00d4ff08 0%,transparent 70%)", position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid transparent", borderTopColor: "#00d4ff", animation: "spin 1s linear infinite" }} />
                <div style={{ position: "absolute", inset: 16, borderRadius: "50%", border: "1px solid #1e2d4a", borderTopColor: "#0066ff", animation: "spin 1.5s linear infinite reverse" }} />
                <div style={{ fontSize: 28, color: "#00d4ff" }}>◈</div>
              </div>
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, color: "#00d4ff", letterSpacing: 1, marginBottom: 12, animation: "pulse 1s infinite" }}>{scanStep}</div>
                <ProgressBar value={scanProgress} color="#00d4ff" />
                <div style={{ fontSize: 11, color: "#4a6080", marginTop: 8 }}>{scanProgress}% COMPLETE</div>
              </div>
              <div style={{ fontSize: 10, color: "#2a3a55", lineHeight: 1.8 }}>
                {SCAN_STEPS.map((s, i) => (
                  <div key={i} style={{ color: scanProgress > (i / SCAN_STEPS.length) * 100 ? "#2a5a3a" : "#2a3a55" }}>
                    {scanProgress > (i / SCAN_STEPS.length) * 100 ? "✓" : "○"} {s}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── REPORT ───────────────────────────────────────────────────────── */}
          {screen === "report" && result && (
            <div style={{ animation: "fadeIn .4s ease" }}>
              <div style={{ fontSize: 10, color: "#4a6080", letterSpacing: 3, marginBottom: 6 }}>FORENSIC REPORT · {scanDate}</div>
              <div style={{ fontSize: 11, color: "#2a5a7a", marginBottom: 16, wordBreak: "break-all" }}>FILE: {file?.name}</div>

              <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                <span style={{ background: result.usedVision ? "#30D15822" : "#FF950022", border: `1px solid ${result.usedVision ? "#30D15844" : "#FF950044"}`, borderRadius: 6, padding: "3px 10px", fontSize: 10, color: result.usedVision ? "#30D158" : "#FF9500", fontFamily: "monospace" }}>
                  {result.usedVision ? "◉ VISION ANALYSIS" : "◎ METADATA ONLY"}
                </span>
                <span style={{ background: "#00d4ff11", border: "1px solid #00d4ff33", borderRadius: 6, padding: "3px 10px", fontSize: 10, color: "#00d4ff", fontFamily: "monospace" }}>
                  GRADE: {result.evidenceGrade}
                </span>
              </div>

              {result.verdict && (
                <div style={{ background: `${VERDICT_COLORS[result.verdict]}22`, border: `2px solid ${VERDICT_COLORS[result.verdict]}`, borderRadius: 12, padding: "16px 20px", marginBottom: 12, textAlign: "center" }}>
                  <div style={{ fontSize: 9, color: VERDICT_COLORS[result.verdict], letterSpacing: 3, marginBottom: 4 }}>FORENSIC VERDICT</div>
                  <div style={{ fontSize: 28, fontWeight: 900, color: VERDICT_COLORS[result.verdict], letterSpacing: 4 }}>{result.verdict}</div>
                </div>
              )}

              <Card style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#4a6080", letterSpacing: 2, marginBottom: 4 }}>MANIPULATION SCORE</div>
                    <div style={{ fontSize: 40, fontWeight: 700, color: RISK_COLORS[result.overallRisk], lineHeight: 1 }}>{result.overallScore}%</div>
                    <div style={{ fontSize: 9, color: "#2a3a55", marginTop: 4 }}>0–30 REAL · 31–69 UNCERTAIN · 70–100 FAKE</div>
                  </div>
                  <RiskBadge level={result.overallRisk} />
                </div>
                <div style={{ fontSize: 12, color: "#8a9ab5", lineHeight: 1.6 }}>{result.summary}</div>
              </Card>

              {result.fileHash && (
                <>
                  <SectionLabel>FILE INTEGRITY</SectionLabel>
                  <Card style={{ marginBottom: 16 }}>
                    {[["SHA-256", result.fileHash.sha256], ["SIZE", result.fileSize ? (result.fileSize / 1024).toFixed(1) + " KB" : "—"]].map(([k, v]) => (
                      <div key={k} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "flex-start" }}>
                        <span style={{ fontSize: 9, color: "#4a6080", letterSpacing: 1, minWidth: 60 }}>{k}</span>
                        <span style={{ fontSize: 9, color: "#6a9ab5", fontFamily: "monospace", wordBreak: "break-all" }}>{v}</span>
                      </div>
                    ))}
                  </Card>
                </>
              )}

              {result.exifAnalysis && (
                <>
                  <SectionLabel>EXIF / METADATA ANALYSIS</SectionLabel>
                  <Card style={{ marginBottom: 16, borderLeft: "3px solid #0066ff" }}>
                    <div style={{ fontSize: 11, color: "#6a8090", lineHeight: 1.6 }}>{result.exifAnalysis}</div>
                  </Card>
                </>
              )}

              {result.integrityFlags?.length > 0 && (
                <>
                  <SectionLabel>INTEGRITY FLAGS</SectionLabel>
                  <Card style={{ marginBottom: 16, borderLeft: "3px solid #FF2D2D" }}>
                    {result.integrityFlags.map((flag, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: i < result.integrityFlags.length - 1 ? 8 : 0 }}>
                        <span style={{ color: "#FF2D2D", fontSize: 12 }}>⚠</span>
                        <span style={{ fontSize: 11, color: "#c87070", lineHeight: 1.5 }}>{flag}</span>
                      </div>
                    ))}
                  </Card>
                </>
              )}

              <SectionLabel>DETECTION FINDINGS</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                {result.findings?.map((f, i) => (
                  <Card key={i} style={{ animation: `fadeIn ${0.3 + i * 0.1}s ease` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <div style={{ fontSize: 12, color: "#c8d6e8", fontWeight: 700 }}>{f.category}</div>
                      <RiskBadge level={f.risk} />
                    </div>
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 10, color: "#4a6080" }}>CONFIDENCE</span>
                        <span style={{ fontSize: 10, color: RISK_COLORS[f.risk], fontWeight: 700 }}>{f.score}%</span>
                      </div>
                      <ProgressBar value={f.score} color={RISK_COLORS[f.risk]} />
                    </div>
                    <div style={{ fontSize: 11, color: "#6a8090", marginBottom: 10, lineHeight: 1.5 }}>{f.detail}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {f.indicators?.map((ind, j) => (
                        <span key={j} style={{ background: "#1a2535", border: "1px solid #2a3a55", borderRadius: 4, padding: "3px 8px", fontSize: 10, color: "#5a7090" }}>{ind}</span>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>

              <SectionLabel>INVESTIGATOR ACTIONS</SectionLabel>
              <Card style={{ marginBottom: 16 }}>
                {result.recommendations?.map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: i < result.recommendations.length - 1 ? 12 : 0, paddingBottom: i < result.recommendations.length - 1 ? 12 : 0, borderBottom: i < result.recommendations.length - 1 ? "1px solid #1a2535" : "none" }}>
                    <div style={{ color: "#00d4ff", fontSize: 12, marginTop: 1 }}>→</div>
                    <div style={{ fontSize: 12, color: "#8a9ab5", lineHeight: 1.5 }}>{r}</div>
                  </div>
                ))}
              </Card>

              <SectionLabel>CASE FILE NOTES</SectionLabel>
              <Card style={{ marginBottom: 24, borderLeft: "3px solid #30D158", background: "#0a1520" }}>
                <div style={{ fontSize: 11, color: "#4a8060", lineHeight: 1.7, fontStyle: "italic" }}>{result.caseNotes}</div>
              </Card>

              <div style={{ background: "#FF950011", border: "1px solid #FF950033", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
                <div style={{ fontSize: 9, color: "#FF9500", letterSpacing: 2, marginBottom: 6, fontWeight: 700 }}>⚠ AI ANALYSIS DISCLAIMER</div>
                <div style={{ fontSize: 10, color: "#8a7060", lineHeight: 1.6 }}>
                  This report is AI-generated (Claude, Anthropic) and constitutes a <strong style={{color:"#c8a070"}}>probabilistic assessment only</strong> — not a certified forensic expert opinion. Results must be independently verified before use in any legal proceeding.
                </div>
                <button onClick={() => setScreen("legal")} style={{ background: "none", border: "none", color: "#FF9500", fontSize: 9, cursor: "pointer", fontFamily: "monospace", letterSpacing: 1, padding: 0, marginTop: 8, textDecoration: "underline" }}>
                  VIEW FULL FORENSIC DISCLAIMER →
                </button>
              </div>

              <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                <button onClick={reset} style={S.btnGhost}>← NEW SCAN</button>
                <button onClick={handleExport} disabled={exporting} style={{ flex: 2, padding: 14, background: "linear-gradient(135deg,#00d4ff22,#0066ff22)", border: "1px solid #00d4ff66", borderRadius: 12, color: "#00d4ff", fontSize: 12, fontWeight: 700, cursor: exporting ? "not-allowed" : "pointer", fontFamily: "monospace", letterSpacing: 1, opacity: exporting ? 0.6 : 1 }}>
                  {exporting ? "EXPORTING..." : "⬇ EXPORT PDF"}
                </button>
              </div>
              <div style={{ textAlign: "center", fontSize: 9, color: "#1e2d4a", marginBottom: 10 }}>VERIDEX FORENSIC AI · CLASSIFIED · SOCIETAL ENFORCEMENT USE ONLY</div>
            </div>
          )}

          {/* ── SETTINGS ─────────────────────────────────────────────────────── */}
          {screen === "settings" && (
            <div style={{ animation: "fadeIn .4s ease" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: "#00d4ff", letterSpacing: 3 }}>ACCOUNT SETTINGS</div>
                <button onClick={() => setScreen("home")} style={{ background: "none", border: "1px solid #1e2d4a", borderRadius: 8, color: "#4a6080", fontSize: 11, cursor: "pointer", padding: "6px 12px", fontFamily: "monospace" }}>← BACK</button>
              </div>
              <div style={{ fontSize: 10, color: "#4a6080", marginBottom: 16, letterSpacing: 1 }}>{userEmail}</div>
              <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
                {["EMAIL","PASSWORD","DELETE"].map(t => (
                  <button key={t} onClick={() => { setSettingsTab(t.toLowerCase()); setSettingsMsg(null); setDeleteConfirm(false); }} style={{ flex: 1, padding: "8px 4px", background: settingsTab === t.toLowerCase() ? "#00d4ff22" : "none", border: settingsTab === t.toLowerCase() ? "1px solid #00d4ff66" : "1px solid #1e2d4a", borderRadius: 8, color: settingsTab === t.toLowerCase() ? "#00d4ff" : "#4a6080", fontSize: 10, cursor: "pointer", fontFamily: "monospace", letterSpacing: 1 }}>{t}</button>
                ))}
              </div>
              {settingsMsg && (
                <div style={{ background: settingsMsg.type==="success" ? "#30D15811" : "#FF2D2D11", border: `1px solid ${settingsMsg.type==="success" ? "#30D15844" : "#FF2D2D44"}`, borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 12, color: settingsMsg.type==="success" ? "#30D158" : "#FF6060" }}>
                  {settingsMsg.text}
                </div>
              )}
              {settingsTab === "email" && (
                <form onSubmit={handleChangeEmail} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#4a6080", letterSpacing: 2, marginBottom: 6 }}>NEW EMAIL ADDRESS</div>
                    <input className="input" type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="new@example.com" required style={{ width: "100%", boxSizing: "border-box" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#4a6080", letterSpacing: 2, marginBottom: 6 }}>CURRENT PASSWORD</div>
                    <input className="input" type="password" value={emailPw} onChange={e => setEmailPw(e.target.value)} placeholder="••••••••" required style={{ width: "100%", boxSizing: "border-box", letterSpacing: "3px" }} />
                  </div>
                  <button type="submit" style={{ ...S.btn, opacity: settingsLoading ? 0.6 : 1 }} disabled={settingsLoading}>{settingsLoading ? "UPDATING..." : "UPDATE EMAIL"}</button>
                </form>
              )}
              {settingsTab === "password" && (
                <form onSubmit={handleChangePassword} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#4a6080", letterSpacing: 2, marginBottom: 6 }}>CURRENT PASSWORD</div>
                    <input className="input" type="password" value={curPw} onChange={e => setCurPw(e.target.value)} placeholder="••••••••" required style={{ width: "100%", boxSizing: "border-box", letterSpacing: "3px" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#4a6080", letterSpacing: 2, marginBottom: 6 }}>NEW PASSWORD</div>
                    <input className="input" type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Min 8 characters" required style={{ width: "100%", boxSizing: "border-box", letterSpacing: "3px" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#4a6080", letterSpacing: 2, marginBottom: 6 }}>CONFIRM NEW PASSWORD</div>
                    <input className="input" type="password" value={confirmNewPw} onChange={e => setConfirmNewPw(e.target.value)} placeholder="••••••••" required style={{ width: "100%", boxSizing: "border-box", letterSpacing: "3px" }} />
                  </div>
                  <button type="submit" style={{ ...S.btn, opacity: settingsLoading ? 0.6 : 1 }} disabled={settingsLoading}>{settingsLoading ? "UPDATING..." : "CHANGE PASSWORD"}</button>
                </form>
              )}
              {settingsTab === "delete" && (
                <div>
                  <div style={{ background: "#FF2D2D08", border: "1px solid #FF2D2D22", borderRadius: 8, padding: "12px 14px", marginBottom: 16 }}>
                    <div style={{ fontSize: 10, color: "#FF2D2D", letterSpacing: 1, marginBottom: 4, fontWeight: 700 }}>⚠ PERMANENT ACTION</div>
                    <div style={{ fontSize: 11, color: "#7a5050", lineHeight: 1.6 }}>This will permanently delete your account and all data. Cannot be undone.</div>
                  </div>
                  {!deleteConfirm ? (
                    <button onClick={() => setDeleteConfirm(true)} style={{ ...S.btn, background: "#FF2D2D22", border: "1px solid #FF2D2D66", color: "#FF6060" }}>DELETE MY ACCOUNT</button>
                  ) : (
                    <form onSubmit={handleDeleteAccount} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 10, color: "#4a6080", letterSpacing: 2, marginBottom: 6 }}>CONFIRM WITH PASSWORD</div>
                        <input className="input" type="password" value={deletePw} onChange={e => setDeletePw(e.target.value)} placeholder="••••••••" required style={{ width: "100%", boxSizing: "border-box", letterSpacing: "3px" }} />
                      </div>
                      <div style={{ display: "flex", gap: 10 }}>
                        <button type="button" onClick={() => { setDeleteConfirm(false); setDeletePw(""); }} style={{ ...S.btnGhost, flex: 1 }}>CANCEL</button>
                        <button type="submit" style={{ flex: 2, padding: 14, background: "#FF2D2D22", border: "1px solid #FF2D2D66", borderRadius: 12, color: "#FF6060", fontSize: 12, fontWeight: 700, cursor: settingsLoading ? "not-allowed" : "pointer", fontFamily: "monospace", letterSpacing: 1 }} disabled={settingsLoading}>{settingsLoading ? "DELETING..." : "CONFIRM DELETE"}</button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── LEGAL DOCUMENTS ──────────────────────────────────────────────── */}
          {screen === "legal" && (
            <div style={{ animation: "fadeIn .4s ease" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: "#00d4ff", letterSpacing: 3 }}>LEGAL DOCUMENTS</div>
                <button onClick={() => setScreen("home")} style={{ background: "none", border: "1px solid #1e2d4a", borderRadius: 8, color: "#4a6080", fontSize: 11, cursor: "pointer", padding: "6px 12px", fontFamily: "monospace" }}>← BACK</button>
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
                {["DISCLAIMER","TERMS","PRIVACY","AUP"].map((t,i) => (
                  <button key={i} className={`legal-tab${legalTab===i?" active":""}`} onClick={() => setLegalTab(i)}>{t}</button>
                ))}
              </div>
              <div className="legal-body">
                {legalTab === 0 && <>
                  <h2>FORENSIC DISCLAIMER</h2>
                  <p><strong style={{color:"#FF9500"}}>Effective Date:</strong> 2026-05-24 · Version 1.0 · Societal Enforcement Use Only</p>
                  <h3>1. Nature of Analysis</h3>
                  <p>VERIDEX uses AI (Claude, Anthropic) for probabilistic forensic analysis. All outputs are AI-generated assessments, not certified expert opinions.</p>
                  <h3>2. Limitations</h3>
                  <ul>
                    <li>Images ≤5MB: visual inspection + metadata analysis</li>
                    <li>All other files: metadata, filename, MIME type only — no content analysis</li>
                    <li>No FFT, facial landmark detection, mel-spectrogram, or binary-level signal processing</li>
                    <li>May produce false positives and false negatives</li>
                    <li>Metadata can be fabricated; novel techniques may not be detected</li>
                  </ul>
                  <h3>3. Evidence Grades</h3>
                  <table><thead><tr><th>Grade</th><th>Meaning</th></tr></thead><tbody>
                    <tr><td>A</td><td>High confidence — full EXIF + vision analysis</td></tr>
                    <tr><td>B</td><td>Moderate — partial metadata / no vision</td></tr>
                    <tr><td>C</td><td>Low — metadata-only or limited signals</td></tr>
                    <tr><td>D</td><td>Minimal — filename and MIME type only</td></tr>
                  </tbody></table>
                  <h3>4. Scoring Guide</h3>
                  <table><thead><tr><th>Range</th><th>Verdict</th><th>Meaning</th></tr></thead><tbody>
                    <tr><td>0–30%</td><td style={{color:"#30D158"}}>AUTHENTIC</td><td>No significant manipulation indicators</td></tr>
                    <tr><td>31–69%</td><td style={{color:"#FF9500"}}>UNCERTAIN</td><td>Inconclusive — certified examiner required</td></tr>
                    <tr><td>70–100%</td><td style={{color:"#FF2D2D"}}>DEEPFAKE</td><td>Significant manipulation indicators — must verify</td></tr>
                  </tbody></table>
                  <h3>5. Not a Substitute for Expert Analysis</h3>
                  <p>Outputs must NOT be used as the sole basis for arrest, search, detention, charging decisions, or court submissions as expert evidence without independent verification by a certified forensic professional.</p>
                  <h3>6. Chain of Custody</h3>
                  <p>Preserve original files unchanged using hardware write-blockers. Document SHA-256 hash before and after analysis. Record AI-assisted analysis in the case file.</p>
                  <h3>7. Disclosure in Legal Proceedings</h3>
                  <p>Where outputs are referenced in court filings, you must disclose: (1) AI-assisted tool was used (VERIDEX); (2) AI model is Claude (Anthropic); (3) the limitations described above; (4) whether independent verification was conducted.</p>
                </>}
                {legalTab === 1 && <>
                  <h2>TERMS OF SERVICE</h2>
                  <p><strong style={{color:"#FF9500"}}>Effective Date:</strong> 2026-05-24 · Version 1.0 · Societal Enforcement Use Only</p>
                  <h3>1. Authorized Use</h3>
                  <p>Licensed exclusively for: forensic analysis of digital media in active authorized investigations, generating forensic reports, and agency training using non-sensitive media.</p>
                  <h3>2. Access Controls</h3>
                  <ul>
                    <li>Access is restricted to authorized personnel acting within official duties</li>
                    <li>Account credentials must not be shared with unauthorized individuals</li>
                    <li>Use is subject to agency oversight and audit</li>
                  </ul>
                  <h3>3. Prohibited Uses</h3>
                  <ul>
                    <li>Unauthorized surveillance of any individual</li>
                    <li>Producing reports intended to mislead any court or tribunal</li>
                    <li>Circumventing, testing, or attacking system security</li>
                    <li>Processing classified materials beyond system certification</li>
                    <li>Sharing account access with unauthorized personnel</li>
                    <li>Using outputs to harass, defame, or harm any individual</li>
                  </ul>
                  <h3>4. Disclaimer of Warranties</h3>
                  <p>THE SYSTEM IS PROVIDED "AS IS". AI-GENERATED FORENSIC ANALYSIS IS PROBABILISTIC AND SUBJECT TO ERROR. RESULTS DO NOT CONSTITUTE CONCLUSIVE PROOF OF AUTHENTICITY OR MANIPULATION.</p>
                  <h3>5. Limitation of Liability</h3>
                  <p>IN NO EVENT SHALL THE DEVELOPER OR AGENCY BE LIABLE FOR WRONGFUL CONVICTION OR ACQUITTAL, DIRECT OR CONSEQUENTIAL DAMAGES, OR LOSS OF DATA OR EVIDENCE INTEGRITY. AUTHORIZED USERS ASSUME ALL RISK.</p>
                  <h3>6. Data Handling Compliance</h3>
                  <p>Authorized Users are responsible for compliance with CJIS Security Policy, GDPR, agency-specific evidence handling policies, and applicable AI-in-societal-enforcement laws.</p>
                </>}
                {legalTab === 2 && <>
                  <h2>PRIVACY POLICY</h2>
                  <p><strong style={{color:"#FF9500"}}>Effective Date:</strong> 2026-05-24 · Version 1.0 · Societal Enforcement Use Only</p>
                  <h3>1. Data Processed</h3>
                  <ul>
                    <li><strong style={{color:"#c8d6e8"}}>Account data:</strong> Email address and scrypt-hashed password. Plaintext passwords are never stored.</li>
                    <li><strong style={{color:"#c8d6e8"}}>Session tokens:</strong> 256-bit random, 8-hour TTL, stored in browser localStorage.</li>
                    <li><strong style={{color:"#c8d6e8"}}>Media files:</strong> Loaded into server memory only. NOT written to disk. Discarded after analysis.</li>
                    <li><strong style={{color:"#c8d6e8"}}>Images ≤5MB:</strong> Transmitted to Anthropic Claude API in base64 for AI analysis.</li>
                    <li><strong style={{color:"#c8d6e8"}}>EXIF metadata:</strong> GPS coordinates extracted but NOT sent to frontend or reports — presence flagged only.</li>
                    <li><strong style={{color:"#c8d6e8"}}>Case history:</strong> Stored in browser localStorage only — never transmitted to server.</li>
                  </ul>
                  <h3>2. Third-Party Processors</h3>
                  <p><strong style={{color:"#FF9500"}}>Anthropic (Claude AI):</strong> Image content (≤5MB) and file metadata transmitted to Anthropic API. Agencies under CJIS/GDPR must verify compatibility before submitting sensitive evidence.</p>
                  <h3>3. Data Retention</h3>
                  <table><thead><tr><th>Data Type</th><th>Retention</th></tr></thead><tbody>
                    <tr><td>Uploaded files</td><td>Not retained — in-memory only</td></tr>
                    <tr><td>Session tokens</td><td>8 hours auto-expiry</td></tr>
                    <tr><td>Account data</td><td>Until account deletion</td></tr>
                    <tr><td>Case history</td><td>Browser localStorage — device-local</td></tr>
                    <tr><td>PDF exports</td><td>User's local device only</td></tr>
                  </tbody></table>
                  <h3>4. Security Measures</h3>
                  <ul>
                    <li>scrypt password hashing with unique random salt per account</li>
                    <li>Rate limiting on auth: 5 attempts per 15 min per IP</li>
                    <li>Magic byte validation on all uploads</li>
                    <li>CORS restricted to authorized origins</li>
                    <li>Max 3 concurrent uploads</li>
                  </ul>
                </>}
                {legalTab === 3 && <>
                  <h2>ACCEPTABLE USE POLICY</h2>
                  <p><strong style={{color:"#FF9500"}}>Effective Date:</strong> 2026-05-24 · Version 1.0 · Societal Enforcement Use Only</p>
                  <h3>1. Authorized Users</h3>
                  <table><thead><tr><th>User Type</th><th>Conditions</th></tr></thead><tbody>
                    <tr><td>Societal Enforcement Officers</td><td>Active duty, case-related authorization</td></tr>
                    <tr><td>Licensed Forensic Investigators</td><td>Valid professional license, authorized matter</td></tr>
                    <tr><td>Certified Digital Forensics Professionals</td><td>EnCE, GCFE, GCFA, CCE or equivalent</td></tr>
                    <tr><td>Agency IT/Security Staff</td><td>System administration only</td></tr>
                    <tr><td>Authorized Trainees</td><td>Under direct supervision</td></tr>
                  </tbody></table>
                  <h3>2. Permitted Activities</h3>
                  <ul>
                    <li>Analyzing digital media in connection with an active, lawfully authorized investigation</li>
                    <li>Generating investigative reports for official case files</li>
                    <li>Supporting certified forensic examiners as a preliminary screening tool</li>
                    <li>Professional training under Agency supervision</li>
                  </ul>
                  <h3>3. Prohibited Activities</h3>
                  <ul>
                    <li>Analyzing media of individuals not subject to an authorized investigation</li>
                    <li>Investigating colleagues, superiors, or personal acquaintances</li>
                    <li>Processing media obtained through illegal means</li>
                    <li>Presenting AI analysis as conclusive expert opinion without verification</li>
                    <li>Altering or selectively presenting System outputs to mislead</li>
                    <li>Attempting to bypass or attack any security feature</li>
                  </ul>
                  <h3>4. Consequences of Misuse</h3>
                  <ul>
                    <li>Immediate revocation of account access</li>
                    <li>Disciplinary proceedings under Agency policy</li>
                    <li>Civil or criminal liability</li>
                    <li>Referral to professional licensing bodies</li>
                    <li>Evidence suppression in affected proceedings</li>
                  </ul>
                </>}
              </div>
            </div>
          )}

          {/* ── CASES ────────────────────────────────────────────────────────── */}
          {screen === "cases" && (
            <div style={{ animation: "fadeIn .4s ease" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#00d4ff", letterSpacing: 3, marginBottom: 4 }}>CASE HISTORY</div>
                  <div style={{ fontSize: 10, color: "#4a6080" }}>{cases.length} scan{cases.length !== 1 ? "s" : ""} on record</div>
                </div>
                <button onClick={() => setScreen("home")} style={{ background: "none", border: "1px solid #1e2d4a", borderRadius: 8, color: "#4a6080", fontSize: 11, cursor: "pointer", padding: "6px 12px", fontFamily: "monospace" }}>← BACK</button>
              </div>
              {cases.length === 0
                ? <div style={{ textAlign: "center", color: "#2a3a55", fontSize: 12, marginTop: 60 }}>No cases on record</div>
                : <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {cases.map(c => (
                      <button key={c.id} onClick={() => viewCase(c)} style={{ background: "#0d1220", border: "1px solid #1e2d4a", borderRadius: 12, padding: 16, textAlign: "left", cursor: "pointer", fontFamily: "monospace" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                          <div style={{ fontSize: 12, color: "#c8d6e8", fontWeight: 700, wordBreak: "break-all", flex: 1, marginRight: 8 }}>{c.fileName}</div>
                          <span style={{ background: (VERDICT_COLORS[c.verdict] || "#888") + "22", color: VERDICT_COLORS[c.verdict] || "#888", border: `1px solid ${(VERDICT_COLORS[c.verdict] || "#888")}55`, borderRadius: 6, padding: "3px 8px", fontSize: 10, fontWeight: 700, letterSpacing: 1, whiteSpace: "nowrap" }}>{c.verdict}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontSize: 10, color: "#4a6080" }}>{new Date(c.scanDate).toLocaleDateString()} {new Date(c.scanDate).toLocaleTimeString()}</span>
                          <span style={{ fontSize: 10, color: RISK_COLORS[c.overallRisk], fontWeight: 700 }}>{c.overallScore}%</span>
                        </div>
                      </button>
                    ))}
                  </div>
              }
              {cases.length > 0 && (
                <button onClick={() => { localStorage.removeItem("veridex_cases"); setCases([]); }} style={{ ...S.btnGhost, width: "100%", marginTop: 16, textAlign: "center", color: "#FF2D2D55", borderColor: "#FF2D2D22" }}>
                  ✕ CLEAR ALL CASES
                </button>
              )}
            </div>
          )}

        </div>{/* end S.content */}

        {/* ── T&C / Privacy modals (overlays inside phone frame) ────────────── */}
        {modal && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(4,8,18,.96)", zIndex: 50, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ background: "#0d1220", borderBottom: "1px solid #1e2d4a", padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <div style={{ fontSize: 11, color: "#00d4ff", letterSpacing: 2, fontFamily: "monospace", fontWeight: 700 }}>
                {modal === "terms" ? "TERMS & CONDITIONS" : "PRIVACY POLICY"}
              </div>
              <button
                onClick={() => setModal(null)}
                style={{ background: "#FF2D2D22", border: "1px solid #FF2D2D44", borderRadius: 6, color: "#FF6060", fontSize: 10, cursor: "pointer", fontFamily: "monospace", padding: "5px 12px", letterSpacing: 1 }}
              >
                ✕ CLOSE
              </button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 20px 40px" }}>
              {modal === "terms" ? <TermsContent /> : <PrivacyContent />}
            </div>
            <div style={{ background: "#0d1220", borderTop: "1px solid #1e2d4a", padding: "12px 20px", flexShrink: 0 }}>
              <button
                onClick={() => setModal(null)}
                style={{ width: "100%", padding: 12, background: "linear-gradient(135deg,#00d4ff22,#0066ff22)", border: "1px solid #00d4ff66", borderRadius: 10, color: "#00d4ff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "monospace", letterSpacing: 2 }}
              >
                ✓ CLOSE &amp; RETURN TO SIGNUP
              </button>
            </div>
          </div>
        )}

      </div>{/* end S.phone */}
    </div>
  );
}
