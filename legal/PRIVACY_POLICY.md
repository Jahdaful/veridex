# VERIDEX FORENSIC AI — PRIVACY POLICY

**Effective Date:** 2026-05-24
**Version:** 1.0
**Classification:** Societal Enforcement Use Only

---

## 1. INTRODUCTION

VERIDEX Forensic AI ("the System", "we", "the Platform") is a restricted-access forensic media analysis tool designed exclusively for use by authorized societal enforcement personnel, licensed forensic investigators, and certified digital forensics professionals ("Authorized Users").

This Privacy Policy explains how the System handles data submitted through its interface. By using this System, you acknowledge that you have read, understood, and agree to be bound by this Policy.

---

## 2. DATA CONTROLLER

This System is operated by the deploying societal enforcement agency or authorized institution ("Agency") responsible for its installation and access control. The Agency is the data controller for all data processed through this Platform.

---

## 3. WHAT DATA IS PROCESSED

### 3.1 Media Files
When you upload a media file (image, video, or audio) for analysis:
- The file is loaded into server memory for processing only.
- **Files are NOT written to disk.** They are discarded from memory immediately after analysis is complete.
- File content (for images ≤5MB) is transmitted to the Anthropic Claude API for AI-assisted forensic analysis. See Section 5 for third-party disclosures.

### 3.2 File Metadata Extracted
The following metadata may be extracted from uploaded files:
- EXIF data: camera make/model, software, capture timestamp, lens information, ISO/exposure settings
- File dimensions, size, and format
- **GPS coordinates, if present in EXIF, are extracted for analysis purposes but are NOT transmitted to the frontend or included in exported reports.** GPS presence is flagged (yes/no) only.

### 3.3 Cryptographic Hashes
- A SHA-256 cryptographic hash is computed for each uploaded file for chain-of-custody purposes.
- Hashes are included in analysis reports and PDF exports as evidence integrity markers.

### 3.4 Session Data
- Upon authentication, a cryptographically random session token (256-bit) is generated and stored in server memory.
- Session tokens expire automatically after **8 hours**.
- Session tokens are stored in your browser's sessionStorage and are destroyed when the browser tab is closed.
- **Passwords are never stored.** Authentication credentials are compared in memory using constant-time comparison and immediately discarded.

### 3.5 Case History
- Forensic analysis reports are stored in your **browser's localStorage** on the device used to access the System.
- Case history remains on the local device only and is not transmitted to any server.
- Users may delete case history at any time from the Case History screen.

### 3.6 Server Logs
- The server logs operational error messages for diagnostic purposes.
- Logs do NOT contain file contents, uploaded media, or personal data from uploaded files.
- Log retention is governed by the deploying Agency's data retention policy.

---

## 4. HOW DATA IS USED

Data processed by this System is used exclusively for:
1. Forensic analysis of submitted media files
2. Generation of forensic investigation reports
3. Chain-of-custody documentation
4. System security and access control

Data is **not** used for:
- Commercial purposes
- Training AI models
- Building user profiles
- Any purpose beyond authorized forensic analysis

---

## 5. THIRD-PARTY DATA PROCESSORS

### 5.1 Anthropic (Claude AI)
This System uses the Anthropic Claude API to perform AI-assisted forensic analysis. When a file is submitted:
- For images ≤5MB: image content is transmitted to Anthropic's API in base64 format along with metadata.
- For all files: file metadata (name, type, size, EXIF summary, SHA-256 hash) is transmitted.
- Anthropic processes this data under their API Terms of Service and Privacy Policy.
- The deploying Agency is responsible for ensuring Anthropic's data processing terms are compatible with applicable societal enforcement data handling requirements before deploying this System in official investigative contexts.

**Important:** Agencies operating under strict data sovereignty requirements should review whether transmitting evidence to a third-party API complies with applicable regulations (e.g., CJIS, GDPR, local evidence handling laws) before use.

---

## 6. DATA RETENTION

| Data Type | Retention Period | Location |
|---|---|---|
| Uploaded media files | Not retained — in-memory only | Server RAM (transient) |
| Analysis results | Session only, plus browser localStorage | User's device |
| Session tokens | 8 hours (auto-expiry) | Server memory |
| PDF exports | User's local device upon download | User's device |
| Server error logs | Per Agency policy | Server |

---

## 7. DATA SECURITY

The System implements the following security measures:
- Session-based authentication with cryptographically random tokens
- Rate limiting on authentication (5 attempts per 15 minutes)
- Constant-time password comparison (timing-attack resistant)
- Magic byte validation on all uploaded files
- CORS restricted to localhost
- Concurrent upload limiting (max 3)
- No persistent storage of uploaded evidence

---

## 8. YOUR RIGHTS

As an Authorized User, you have the right to:
- Know what data is processed during your session
- Delete local case history at any time
- Request information about Agency-level data handling from your Agency data controller

---

## 9. EVIDENCE AND LEGAL PROCEEDINGS

Reports generated by this System contain AI-assisted analysis. See the **Forensic Disclaimer** for important limitations regarding the use of System outputs as evidence. The Agency is responsible for ensuring compliance with applicable evidence handling rules and chain-of-custody requirements.

---

## 10. CHANGES TO THIS POLICY

This Policy may be updated by the System administrator. Continued use of the System following notification of changes constitutes acceptance of the revised Policy.

---

## 11. CONTACT

For privacy-related enquiries regarding this System, contact your Agency's data protection officer or the System administrator.

---

*VERIDEX Forensic AI — Restricted Access — Societal Enforcement Use Only*
