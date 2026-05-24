import { useState, useRef } from "react";

// ── Constants ────────────────────────────────────────────────────────────────
const RISK_COLORS  = { HIGH: "#FF2D2D", MEDIUM: "#FF9500", LOW: "#30D158", CLEAN: "#30D158" };
const RISK_LABELS  = { HIGH: "DEEPFAKE", MEDIUM: "UNCERTAIN", LOW: "LIKELY REAL", CLEAN: "AUTHENTIC" };
const VERDICT_COLORS = { DEEPFAKE: "#FF2D2D", UNCERTAIN: "#FF9500", AUTHENTIC: "#30D158" };
const MAX_FILE_SIZE = 50 * 1024 * 1024;

// ── Small components ─────────────────────────────────────────────────────────
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

async function apiAuth(password) {
  const res = await fetch(`${API_BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Authentication failed");
  return data;
}

async function apiLogout(token) {
  try { await fetch(`${API_BASE}/api/logout`, { method: "POST", headers: { "x-auth-token": token } }); } catch {}
}

async function apiExport(payload, token) {
  return fetch(`${API_BASE}/api/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-auth-token": token },
    body: JSON.stringify(payload),
  });
}

// ── Case storage ──────────────────────────────────────────────────────────────
function loadCases() { return JSON.parse(localStorage.getItem("veridex_cases") || "[]"); }
function saveCase(result, fileName) {
  const cases = loadCases();
  cases.unshift({ id: Date.now(), fileName, verdict: result.verdict,
    overallScore: result.overallScore, overallRisk: result.overallRisk,
    scanDate: new Date().toISOString(), result });
  localStorage.setItem("veridex_cases", JSON.stringify(cases.slice(0, 50)));
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function ForensicsApp() {
  const savedAuth    = localStorage.getItem("veridex_auth");
  const savedTerms   = localStorage.getItem("veridex_terms");
  const [screen,       setScreen]       = useState(savedAuth ? "home" : "login");
  const [authToken,    setAuthToken]    = useState(savedAuth || "");
  const [file,         setFile]         = useState(null);
  const [fileType,     setFileType]     = useState(null);
  const [result,       setResult]       = useState(null);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanStep,     setScanStep]     = useState("");
  const [error,        setError]        = useState(null);
  const [password,     setPassword]     = useState("");
  const [authLoading,  setAuthLoading]  = useState(false);
  const [cases,        setCases]        = useState(loadCases);
  const [exporting,    setExporting]    = useState(false);
  const [scanDate,     setScanDate]     = useState("");
  const [termsAccepted, setTermsAccepted] = useState(!!savedTerms);
  const [termsChecked,  setTermsChecked]  = useState(false);
  const [legalTab,      setLegalTab]      = useState(0);
  const fileRef   = useRef();
  const termsRef  = useRef();

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

  async function handleLogin(e) {
    e.preventDefault();
    setAuthLoading(true);
    setError(null);
    try {
      const data = await apiAuth(password);
      localStorage.setItem("veridex_auth", data.token);
      setAuthToken(data.token);
      const accepted = !!localStorage.getItem("veridex_terms");
      setTermsAccepted(accepted);
      setScreen(accepted ? "home" : "terms");
    } catch (err) {
      setError(err.message);
    } finally {
      setAuthLoading(false);
    }
  }

  function handleAcceptTerms() {
    const ts = new Date().toISOString();
    localStorage.setItem("veridex_terms", ts);
    setTermsAccepted(true);
    setTermsChecked(false);
    setScreen("home");
  }

  async function handleLogout() {
    await apiLogout(authToken);
    localStorage.removeItem("veridex_auth");
    setAuthToken("");
    setScreen("login");
    setPassword("");
  }

  function handleUnauthorized() {
    localStorage.removeItem("veridex_auth");
    setAuthToken("");
    setError("Session expired. Please log in again.");
    setScreen("login");
  }

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

  const S = {
    shell:    { minHeight: "100vh", background: "#080c14", display: "flex", justifyContent: "center", fontFamily: "'Courier New', monospace" },
    phone:    { width: 390, minHeight: "100vh", background: "#0b0f1a", display: "flex", flexDirection: "column" },
    topBar:   { background: "#0d1220", borderBottom: "1px solid #1e2d4a", padding: "14px 20px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 10 },
    logo:     { fontSize: 13, fontWeight: 700, color: "#00d4ff", letterSpacing: 3 },
    badge:    { background: "#00d4ff22", border: "1px solid #00d4ff44", borderRadius: 4, padding: "2px 8px", fontSize: 9, color: "#00d4ff", letterSpacing: 1.5 },
    content:  { flex: 1, padding: "24px 20px", overflowY: "auto" },
    btn:      { width: "100%", padding: "16px", background: "linear-gradient(135deg,#00d4ff22,#0066ff22)", border: "1px solid #00d4ff66", borderRadius: 14, color: "#00d4ff", fontSize: 13, fontWeight: 700, letterSpacing: 2, cursor: "pointer", fontFamily: "monospace" },
    btnGhost: { flex: 1, padding: 14, background: "#0d1220", border: "1px solid #1e2d4a", borderRadius: 12, color: "#4a6080", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "monospace", letterSpacing: 1 },
  };

  return (
    <div style={S.shell}>
      <style>{`
        @keyframes scanline{0%{transform:translateY(-100%)}100%{transform:translateY(100vh)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes glow{0%,100%{box-shadow:0 0 20px #00d4ff44}50%{box-shadow:0 0 40px #00d4ff88}}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#0b0f1a}::-webkit-scrollbar-thumb{background:#1e2d4a;border-radius:2px}
        input[type=password]{width:100%;box-sizing:border-box;background:#0d1220;border:1px solid #1e2d4a;border-radius:10px;padding:14px 16px;color:#e8eaf6;font-family:monospace;font-size:14px;letter-spacing:3px;outline:none}
        input[type=password]:focus{border-color:#00d4ff66}
        .terms-scroll{max-height:380px;overflow-y:auto;background:#060a12;border:1px solid #1e2d4a;border-radius:10px;padding:16px;margin-bottom:16px;font-size:11px;color:#6a8090;line-height:1.8}
        .terms-scroll h3{color:#00d4ff;font-size:11px;letter-spacing:2px;margin:14px 0 6px}
        .terms-scroll h3:first-child{margin-top:0}
        .terms-scroll p{margin:0 0 8px}
        .terms-scroll ul{margin:0 0 8px;padding-left:16px}
        .terms-scroll li{margin-bottom:4px}
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
        input[type=checkbox]{accent-color:#00d4ff;width:16px;height:16px;cursor:pointer;flex-shrink:0}
      `}</style>
      <div style={S.phone}>

        {/* Top bar */}
        <div style={S.topBar}>
          <div style={S.logo}>VERIDEX</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={S.badge}>LAW ENFORCEMENT</div>
            {screen !== "login" && (
              <button onClick={handleLogout} style={{ background: "none", border: "none", color: "#2a3a55", fontSize: 10, cursor: "pointer", fontFamily: "monospace" }}>LOGOUT</button>
            )}
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#30D158", animation: "pulse 2s infinite", boxShadow: "0 0 8px #30D158" }} />
          </div>
        </div>

        <div style={S.content}>

          {/* LOGIN */}
          {screen === "login" && (
            <div style={{ animation: "fadeIn .4s ease" }}>
              <div style={{ marginBottom: 40, textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#00d4ff", letterSpacing: 3, marginBottom: 12 }}>FORENSIC AI DETECTION SUITE</div>
                <div style={{ fontSize: 24, color: "#e8eaf6", fontWeight: 700, marginBottom: 8 }}>VERIDEX</div>
                <div style={{ fontSize: 11, color: "#4a6080" }}>Authorized access only</div>
              </div>
              {error && <div style={{ background: "#FF2D2D11", border: "1px solid #FF2D2D44", borderRadius: 10, padding: 12, marginBottom: 20, fontSize: 12, color: "#FF2D2D" }}>{error}</div>}
              <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#4a6080", letterSpacing: 2, marginBottom: 8 }}>ACCESS CODE</div>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••••" autoFocus />
                </div>
                <button type="submit" style={{ ...S.btn, animation: "glow 3s infinite", opacity: authLoading ? 0.6 : 1 }} disabled={authLoading}>
                  {authLoading ? "AUTHENTICATING..." : "⊕ AUTHENTICATE"}
                </button>
              </form>
            </div>
          )}

          {/* HOME */}
          {screen === "home" && (
            <div style={{ animation: "fadeIn .4s ease" }}>
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, color: "#00d4ff", letterSpacing: 3, marginBottom: 8 }}>FORENSIC AI DETECTION SUITE</div>
                <div style={{ fontSize: 20, color: "#e8eaf6", fontWeight: 700, lineHeight: 1.3, marginBottom: 8 }}>Media Authenticity<br />Analysis System</div>
                <div style={{ fontSize: 12, color: "#4a6080", lineHeight: 1.6 }}>Upload video, image, or audio for AI manipulation detection, deepfake analysis, and identity modification screening.</div>
              </div>
              {error && <div style={{ background: "#FF2D2D11", border: "1px solid #FF2D2D44", borderRadius: 10, padding: 12, marginBottom: 20, fontSize: 12, color: "#FF2D2D" }}>{error}</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
                {[
                  { icon: "◈", label: "Deepfake Video Detection", desc: "GAN artifacts, temporal inconsistencies, face swap markers" },
                  { icon: "◉", label: "AI Image Analysis", desc: "Vision AI · EXIF integrity · diffusion fingerprints" },
                  { icon: "◎", label: "Voice Clone Detection", desc: "Synthetic audio markers, frequency pattern analysis" },
                  { icon: "◍", label: "Identity Modification Scan", desc: "BBL, rhinoplasty, facial fillers, biometric evasion markers" },
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

          {/* SCANNING */}
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

          {/* REPORT */}
          {screen === "report" && result && (
            <div style={{ animation: "fadeIn .4s ease" }}>
              <div style={{ fontSize: 10, color: "#4a6080", letterSpacing: 3, marginBottom: 6 }}>FORENSIC REPORT · {scanDate}</div>
              <div style={{ fontSize: 11, color: "#2a5a7a", marginBottom: 16, wordBreak: "break-all" }}>FILE: {file?.name}</div>

              {/* Analysis type badges */}
              <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                <span style={{ background: result.usedVision ? "#30D15822" : "#FF950022", border: `1px solid ${result.usedVision ? "#30D15844" : "#FF950044"}`, borderRadius: 6, padding: "3px 10px", fontSize: 10, color: result.usedVision ? "#30D158" : "#FF9500", fontFamily: "monospace" }}>
                  {result.usedVision ? "◉ VISION ANALYSIS" : "◎ METADATA ONLY"}
                </span>
                <span style={{ background: "#00d4ff11", border: "1px solid #00d4ff33", borderRadius: 6, padding: "3px 10px", fontSize: 10, color: "#00d4ff", fontFamily: "monospace" }}>
                  GRADE: {result.evidenceGrade}
                </span>
              </div>

              {/* Verdict banner */}
              {result.verdict && (
                <div style={{ background: `${VERDICT_COLORS[result.verdict]}22`, border: `2px solid ${VERDICT_COLORS[result.verdict]}`, borderRadius: 12, padding: "16px 20px", marginBottom: 12, textAlign: "center" }}>
                  <div style={{ fontSize: 9, color: VERDICT_COLORS[result.verdict], letterSpacing: 3, marginBottom: 4 }}>FORENSIC VERDICT</div>
                  <div style={{ fontSize: 28, fontWeight: 900, color: VERDICT_COLORS[result.verdict], letterSpacing: 4 }}>{result.verdict}</div>
                </div>
              )}

              {/* Score */}
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

              {/* File integrity */}
              {result.fileHash && (
                <>
                  <SectionLabel>FILE INTEGRITY</SectionLabel>
                  <Card style={{ marginBottom: 16 }}>
                    {[["SHA-256", result.fileHash.sha256], ["MD5", result.fileHash.md5], ["SIZE", result.fileSize ? (result.fileSize / 1024).toFixed(1) + " KB" : "—"]].map(([k, v]) => (
                      <div key={k} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "flex-start" }}>
                        <span style={{ fontSize: 9, color: "#4a6080", letterSpacing: 1, minWidth: 60 }}>{k}</span>
                        <span style={{ fontSize: 9, color: "#6a9ab5", fontFamily: "monospace", wordBreak: "break-all" }}>{v}</span>
                      </div>
                    ))}
                  </Card>
                </>
              )}

              {/* EXIF analysis */}
              {result.exifAnalysis && (
                <>
                  <SectionLabel>EXIF / METADATA ANALYSIS</SectionLabel>
                  <Card style={{ marginBottom: 16, borderLeft: "3px solid #0066ff" }}>
                    <div style={{ fontSize: 11, color: "#6a8090", lineHeight: 1.6 }}>{result.exifAnalysis}</div>
                  </Card>
                </>
              )}

              {/* Integrity flags */}
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

              {/* Findings */}
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

              {/* Recommendations */}
              <SectionLabel>INVESTIGATOR ACTIONS</SectionLabel>
              <Card style={{ marginBottom: 16 }}>
                {result.recommendations?.map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: i < result.recommendations.length - 1 ? 12 : 0, paddingBottom: i < result.recommendations.length - 1 ? 12 : 0, borderBottom: i < result.recommendations.length - 1 ? "1px solid #1a2535" : "none" }}>
                    <div style={{ color: "#00d4ff", fontSize: 12, marginTop: 1 }}>→</div>
                    <div style={{ fontSize: 12, color: "#8a9ab5", lineHeight: 1.5 }}>{r}</div>
                  </div>
                ))}
              </Card>

              {/* Case notes */}
              <SectionLabel>CASE FILE NOTES</SectionLabel>
              <Card style={{ marginBottom: 24, borderLeft: "3px solid #30D158", background: "#0a1520" }}>
                <div style={{ fontSize: 11, color: "#4a8060", lineHeight: 1.7, fontStyle: "italic" }}>{result.caseNotes}</div>
              </Card>

              {/* AI Disclaimer banner */}
              <div style={{ background: "#FF950011", border: "1px solid #FF950033", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
                <div style={{ fontSize: 9, color: "#FF9500", letterSpacing: 2, marginBottom: 6, fontWeight: 700 }}>⚠ AI ANALYSIS DISCLAIMER</div>
                <div style={{ fontSize: 10, color: "#8a7060", lineHeight: 1.6 }}>
                  This report is AI-generated (Claude, Anthropic) and constitutes a <strong style={{color:"#c8a070"}}>probabilistic assessment only</strong> — not a certified forensic expert opinion. Results must be independently verified by a qualified digital forensics professional before use in any legal proceeding. Evidence Grade reflects analysis confidence, not legal admissibility.
                </div>
                <button onClick={() => setScreen("legal")} style={{ background: "none", border: "none", color: "#FF9500", fontSize: 9, cursor: "pointer", fontFamily: "monospace", letterSpacing: 1, padding: 0, marginTop: 8, textDecoration: "underline" }}>
                  VIEW FULL FORENSIC DISCLAIMER →
                </button>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                <button onClick={reset} style={S.btnGhost}>← NEW SCAN</button>
                <button onClick={handleExport} disabled={exporting} style={{ flex: 2, padding: 14, background: "linear-gradient(135deg,#00d4ff22,#0066ff22)", border: "1px solid #00d4ff66", borderRadius: 12, color: "#00d4ff", fontSize: 12, fontWeight: 700, cursor: exporting ? "not-allowed" : "pointer", fontFamily: "monospace", letterSpacing: 1, opacity: exporting ? 0.6 : 1 }}>
                  {exporting ? "EXPORTING..." : "⬇ EXPORT PDF"}
                </button>
              </div>
              <div style={{ textAlign: "center", fontSize: 9, color: "#1e2d4a", marginBottom: 10 }}>VERIDEX FORENSIC AI · CLASSIFIED · LAW ENFORCEMENT USE ONLY</div>
            </div>
          )}

          {/* TERMS ACCEPTANCE */}
          {screen === "terms" && (
            <div style={{ animation: "fadeIn .4s ease" }}>
              <div style={{ marginBottom: 16, textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#FF9500", letterSpacing: 3, marginBottom: 6 }}>MANDATORY — READ BEFORE PROCEEDING</div>
                <div style={{ fontSize: 16, color: "#e8eaf6", fontWeight: 700, marginBottom: 4 }}>Legal Agreement & Forensic Disclaimer</div>
                <div style={{ fontSize: 10, color: "#4a6080" }}>You must read and accept the following before using this system.</div>
              </div>
              <div className="terms-scroll" ref={termsRef}>
                <h3>⚠ FORENSIC DISCLAIMER</h3>
                <p>VERIDEX Forensic AI uses artificial intelligence (Claude, Anthropic) to perform <strong style={{color:"#c8d6e8"}}>probabilistic forensic analysis</strong>. All outputs are AI-generated assessments — <strong style={{color:"#FF9500"}}>not the certified opinion of a qualified human forensic examiner.</strong></p>
                <p><strong style={{color:"#c8d6e8"}}>Evidence grades:</strong></p>
                <ul>
                  <li><strong style={{color:"#30D158"}}>Grade A</strong> — High confidence: image with full EXIF and vision analysis</li>
                  <li><strong style={{color:"#00d4ff"}}>Grade B</strong> — Moderate: partial metadata or no vision analysis</li>
                  <li><strong style={{color:"#FF9500"}}>Grade C</strong> — Low: metadata-only or limited signals</li>
                  <li><strong style={{color:"#FF2D2D"}}>Grade D</strong> — Minimal: filename and MIME type only</li>
                </ul>
                <p><strong style={{color:"#FF2D2D"}}>Scoring: 0–30% = AUTHENTIC · 31–69% = UNCERTAIN · 70–100% = DEEPFAKE</strong></p>
                <p>System outputs must NOT be used as the sole basis for arrest, charging, or court submissions without independent verification by a certified forensic examiner.</p>

                <h3>TERMS OF SERVICE (SUMMARY)</h3>
                <p>Access is licensed <strong style={{color:"#c8d6e8"}}>exclusively</strong> to duly authorized law enforcement officers, licensed forensic investigators, and certified digital forensics professionals acting within official duties.</p>
                <p>Prohibited: unauthorized surveillance, misleading courts, circumventing security, sharing access credentials, using outputs to harass individuals.</p>
                <p>The System is provided <strong style={{color:"#FF9500"}}>"AS IS"</strong> with no warranty of accuracy. AI-generated results are probabilistic and subject to error. The developer and Agency accept no liability for decisions made based on System outputs.</p>

                <h3>PRIVACY POLICY (SUMMARY)</h3>
                <p>Uploaded files are <strong style={{color:"#c8d6e8"}}>not written to disk</strong> — processed in memory and discarded immediately after analysis. For images ≤5MB, image content is transmitted to the <strong style={{color:"#c8d6e8"}}>Anthropic Claude API</strong> for AI analysis.</p>
                <p>GPS coordinates extracted from EXIF data are <strong style={{color:"#c8d6e8"}}>not transmitted to the frontend or included in reports</strong>. Case history is stored in your browser's localStorage only and never transmitted to the server.</p>
                <p>Agencies operating under CJIS or GDPR requirements must review Anthropic's data processing terms before submitting sensitive evidence.</p>

                <h3>ACCEPTABLE USE POLICY (SUMMARY)</h3>
                <p>You may only analyze media connected to an <strong style={{color:"#c8d6e8"}}>active, lawfully authorized investigation</strong>. You must not analyze media of unauthorized subjects, use the System against colleagues or personal acquaintances, or present AI outputs as conclusive expert opinion.</p>
                <p>Violations may result in: revocation of access, disciplinary proceedings, civil or criminal liability, referral to licensing bodies, and evidence suppression.</p>
                <p style={{color:"#FF9500",fontStyle:"italic"}}>By accepting, you acknowledge you have read, understood, and will comply with all four legal documents in their entirety (Privacy Policy, Terms of Service, Acceptable Use Policy, and Forensic Disclaimer).</p>
              </div>
              <label style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 16, cursor: "pointer" }}>
                <input type="checkbox" checked={termsChecked} onChange={e => setTermsChecked(e.target.checked)} style={{ marginTop: 2 }} />
                <span style={{ fontSize: 11, color: "#8a9ab5", lineHeight: 1.6 }}>
                  I confirm that I am an authorized law enforcement officer, licensed forensic investigator, or certified digital forensics professional. I have read and agree to the Terms of Service, Privacy Policy, Acceptable Use Policy, and Forensic Disclaimer.
                </span>
              </label>
              <button
                onClick={handleAcceptTerms}
                disabled={!termsChecked}
                style={{ ...S.btn, opacity: termsChecked ? 1 : 0.35, cursor: termsChecked ? "pointer" : "not-allowed", animation: termsChecked ? "glow 3s infinite" : "none", marginBottom: 12 }}
              >
                ✓ ACCEPT &amp; PROCEED
              </button>
              <button onClick={() => setScreen("legal")} style={{ ...S.btnGhost, width: "100%", textAlign: "center" }}>
                ◧ VIEW FULL LEGAL DOCUMENTS
              </button>
            </div>
          )}

          {/* LEGAL DOCUMENTS */}
          {screen === "legal" && (
            <div style={{ animation: "fadeIn .4s ease" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: "#00d4ff", letterSpacing: 3 }}>LEGAL DOCUMENTS</div>
                <button onClick={() => setScreen(termsAccepted ? "home" : "terms")} style={{ background: "none", border: "1px solid #1e2d4a", borderRadius: 8, color: "#4a6080", fontSize: 11, cursor: "pointer", padding: "6px 12px", fontFamily: "monospace" }}>← BACK</button>
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
                {["DISCLAIMER","TERMS","PRIVACY","AUP"].map((t,i) => (
                  <button key={i} className={`legal-tab${legalTab===i?" active":""}`} onClick={() => setLegalTab(i)}>{t}</button>
                ))}
              </div>
              <div className="legal-body">
                {legalTab === 0 && <>
                  <h2>FORENSIC DISCLAIMER</h2>
                  <p><strong style={{color:"#FF9500"}}>Effective Date:</strong> 2026-05-24 · Version 1.0 · Law Enforcement Use Only</p>
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
                  <p><strong style={{color:"#FF9500"}}>Effective Date:</strong> 2026-05-24 · Version 1.0 · Law Enforcement Use Only</p>
                  <h3>1. Authorized Use</h3>
                  <p>Licensed exclusively for: forensic analysis of digital media in active authorized investigations, generating forensic reports, agency training using non-sensitive media.</p>
                  <h3>2. Access Controls</h3>
                  <ul><li>Session requires authentication with valid access code</li><li>Access codes must not be shared</li><li>Sessions expire after 8 hours of inactivity</li></ul>
                  <h3>3. Prohibited Uses</h3>
                  <ul>
                    <li>Unauthorized surveillance of any individual</li>
                    <li>Producing reports intended to mislead any court or tribunal</li>
                    <li>Circumventing, testing, or attacking system security</li>
                    <li>Processing classified materials beyond system certification</li>
                    <li>Sharing access with unauthorized personnel</li>
                    <li>Using outputs to harass, defame, or harm any individual</li>
                  </ul>
                  <h3>4. Disclaimer of Warranties</h3>
                  <p>THE SYSTEM IS PROVIDED "AS IS". AI-GENERATED FORENSIC ANALYSIS IS PROBABILISTIC AND SUBJECT TO ERROR. RESULTS DO NOT CONSTITUTE CONCLUSIVE PROOF OF AUTHENTICITY OR MANIPULATION.</p>
                  <h3>5. Limitation of Liability</h3>
                  <p>IN NO EVENT SHALL THE DEVELOPER OR AGENCY BE LIABLE FOR WRONGFUL CONVICTION OR ACQUITTAL, DIRECT OR CONSEQUENTIAL DAMAGES, LOSS OF DATA OR EVIDENCE INTEGRITY. AUTHORIZED USERS ASSUME ALL RISK.</p>
                  <h3>6. Evidence Standards</h3>
                  <p>Reports do not constitute certified forensic expert opinion. They are investigative tools that must be reviewed and validated by a qualified professional before being presented as expert evidence.</p>
                  <h3>7. Data Handling Compliance</h3>
                  <p>Authorized Users are responsible for compliance with CJIS Security Policy, GDPR, Agency-specific evidence handling policies, and applicable AI-in-law-enforcement laws.</p>
                </>}
                {legalTab === 2 && <>
                  <h2>PRIVACY POLICY</h2>
                  <p><strong style={{color:"#FF9500"}}>Effective Date:</strong> 2026-05-24 · Version 1.0 · Law Enforcement Use Only</p>
                  <h3>1. Data Processed</h3>
                  <ul>
                    <li><strong style={{color:"#c8d6e8"}}>Media files:</strong> Loaded into server memory only. NOT written to disk. Discarded after analysis.</li>
                    <li><strong style={{color:"#c8d6e8"}}>Images ≤5MB:</strong> Transmitted to Anthropic Claude API in base64 for AI analysis.</li>
                    <li><strong style={{color:"#c8d6e8"}}>EXIF metadata:</strong> Extracted for analysis. GPS coordinates extracted but NOT sent to frontend or included in reports — flagged presence only.</li>
                    <li><strong style={{color:"#c8d6e8"}}>SHA-256 hash:</strong> Computed for chain-of-custody, included in reports.</li>
                    <li><strong style={{color:"#c8d6e8"}}>Session tokens:</strong> 256-bit random, server memory only, 8-hour TTL, browser localStorage.</li>
                    <li><strong style={{color:"#c8d6e8"}}>Case history:</strong> Stored in browser localStorage only — never transmitted to server.</li>
                  </ul>
                  <h3>2. Third-Party Processors</h3>
                  <p><strong style={{color:"#FF9500"}}>Anthropic (Claude AI):</strong> Image content (≤5MB) and file metadata transmitted to Anthropic API under their Terms of Service. Agencies under CJIS/GDPR must verify compatibility before use with sensitive evidence.</p>
                  <h3>3. Data Retention</h3>
                  <table><thead><tr><th>Data Type</th><th>Retention</th></tr></thead><tbody>
                    <tr><td>Uploaded files</td><td>Not retained — in-memory only</td></tr>
                    <tr><td>Analysis results</td><td>Session + browser localStorage</td></tr>
                    <tr><td>Session tokens</td><td>8 hours auto-expiry</td></tr>
                    <tr><td>PDF exports</td><td>User's local device</td></tr>
                  </tbody></table>
                  <h3>4. Security Measures</h3>
                  <ul><li>Session-based auth with cryptographically random tokens</li><li>Rate limiting on authentication (5 attempts/15 min)</li><li>Constant-time password comparison (timing-attack resistant)</li><li>Magic byte validation on all uploads</li><li>CORS restricted to localhost</li><li>Max 3 concurrent uploads</li></ul>
                </>}
                {legalTab === 3 && <>
                  <h2>ACCEPTABLE USE POLICY</h2>
                  <p><strong style={{color:"#FF9500"}}>Effective Date:</strong> 2026-05-24 · Version 1.0 · Law Enforcement Use Only</p>
                  <h3>1. Authorized Users</h3>
                  <table><thead><tr><th>User Type</th><th>Conditions</th></tr></thead><tbody>
                    <tr><td>Law Enforcement Officers</td><td>Active duty, case-related authorization</td></tr>
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
                    <li>Processing intimate images or images of minors outside authorized investigation</li>
                  </ul>
                  <h3>4. Sensitive Material</h3>
                  <p>When submitting sensitive material (CSAM investigations, victim imagery, classified material): ensure Agency authorization is in place; note that image content is transmitted to Anthropic API; maintain strict chain-of-custody documentation.</p>
                  <h3>5. Consequences of Misuse</h3>
                  <ul>
                    <li>Immediate revocation of System access</li>
                    <li>Disciplinary proceedings under Agency policy</li>
                    <li>Civil or criminal liability</li>
                    <li>Referral to professional licensing bodies</li>
                    <li>Evidence suppression in affected proceedings</li>
                  </ul>
                </>}
              </div>
            </div>
          )}

          {/* CASES */}
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

        </div>
      </div>
    </div>
  );
}
