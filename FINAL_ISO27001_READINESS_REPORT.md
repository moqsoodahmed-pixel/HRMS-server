# DutyLaunch HRMS — ISO/IEC 27001:2022 Readiness Report

Prepared: 2026-08-30 · Prepared by: AI-assisted internal technical review (Claude Code), at the direction of the repository owner · Document Owner: [SECURITY OWNER] · Approved by: [APPROVER]

> **This report does not claim ISO/IEC 27001 certification.** [ORGANIZATION NAME] is not currently certified against ISO/IEC 27001:2022. This document records a technical readiness assessment and the hardening work performed during it — it is an input to a real certification effort, not a substitute for one. Certification requires a certification body's independent audit, which is outside what any code review can produce.

Allowed statuses used throughout this report: **PASS**, **PARTIAL**, **FAIL**, **NOT VERIFIED**, **NOT APPLICABLE**, **EVIDENCE REQUIRED**. No status is used without the evidence to back it.

---

## 1. Executive summary

DutyLaunch HRMS is a MERN-stack (MongoDB, Express, React, Node.js) HR management system with a substantially complete, previously-implemented feature set (employees, attendance, leave, payroll/compensation, documents, onboarding/offboarding, policies, announcements, assets, reports, audit, notifications, role-based dashboards). Entering this engagement, it had 143 passing backend smoke-test assertions and 68 passing business-rule assertions (including a mandatory-employee-document-enforcement feature implemented in a prior session).

This engagement performed a security-focused hardening pass and produced a full ISO/IEC 27001:2022 readiness documentation package. The most significant finding was **CRITICAL**: the application's JWT session-signing key had an insecure hardcoded fallback, and the actual `.env` configuration on disk held a never-rotated, literal placeholder secret (`your_jwt_secret_key_here`) — meaning session tokens were effectively signed with a guessable value. This has been fixed: the fallback was removed, a fail-closed startup validator was added, and the secret was rotated. Two dependency vulnerabilities (one high-severity each in `nodemailer` and `vite`, plus two moderate in `react-router-dom`) were also found and fixed via safe version upgrades, bringing both the server and client dependency trees to **0 known vulnerabilities**. A defense-in-depth gap (the `password` field lacking `select: false`) and a real file-upload validation gap (no content-signature check against declared MIME type) were also found and fixed, each with a new automated regression test.

After hardening, both regression suites were re-run from a clean server restart and pass completely: **143/143** and **75/75** (the business-rule suite grew from 68 to 75 with 7 new security-specific assertions added this session). The frontend build succeeds with 0 errors.

The remaining gaps are infrastructure and organizational in nature, not application-code defects: **no backup mechanism, no version control/CI pipeline, and no external monitoring/SIEM exist**. These are documented honestly throughout this report and the supporting ISMS package, with concrete remediation plans — not glossed over.

## 2. Scope

- **In scope and directly verified:** `server/` (Node/Express/MongoDB backend), `client/` (React/Vite frontend), both automated regression suites, npm dependency trees for both, and the ISMS documentation package produced in `docs/` and `docs/iso27001/`.
- **Out of scope / not verified:** physical security, network infrastructure, hosting-provider controls, legal/regulatory compliance determination, HR/organizational processes (screening, disciplinary process, contracts) — all placeholder-marked throughout the ISMS package pending real organizational input.

## 3. System description

Roles: SUPER_ADMIN, CTO (carries SUPER_ADMIN-equivalent effective permissions via a centralized `ELEVATED_ROLES` array — verified not to be hardcoded by name/email), HR_ADMIN, FINANCE, MANAGER, EMPLOYEE, AUDITOR. Authentication is email/password with bcrypt hashing and an httpOnly JWT cookie. Authorization is enforced server-side via centralized middleware on every protected route. Identity documents are AES-256-GCM encrypted at rest. A mandatory-document completion gate blocks employee activation until required documents are verified, enforced regardless of the caller's role.

## 4. Repository inspection

**PASS.** The existing implementation, prior test baselines (143/143 core, 68/68 business-rule), and prior session's mandatory-document-enforcement feature were confirmed present and functioning before any change was made this session. No working functionality was removed or weakened.

## 5. Security testing results

| Check | Status | Evidence |
|---|---|---|
| Hardcoded/placeholder JWT signing secret | **FAIL → FIXED, PASS** | Found: `server/middleware/auth.js`, `server/controllers/authController.js`, `server/.env` (literal placeholder). Fixed: fallback removed, `server/config/env.js` fail-closed validator added, secret rotated. Re-verified: forged-cookie rejection test passes; fail-closed behavior directly confirmed |
| `password` field exposure risk | **PARTIAL → FIXED, PASS** | `server/models/User.js` — `select: false` added; verified no current code path leaked it, and no future default-query path can either |
| Upload content-type spoofing | **FAIL → FIXED, PASS** | `server/utils/fileSignature.js` added; verified by new automated test |
| Dependency vulnerabilities | **FAIL → FIXED, PASS** | `npm audit`: 1 high (server, nodemailer) + 1 high/2 moderate (client, vite/react-router-dom) → 0/0 after upgrades |
| Security headers (Helmet) | **PASS** | Verified live: `X-Content-Type-Options: nosniff` present, `X-Powered-By` absent |
| CORS restriction | **PASS** | `server/app.js` — restricted to configured `CLIENT_URL`, not wildcard |
| NoSQL injection protection | **PASS** | `express-mongo-sanitize` applied globally |
| Rate limiting | **PASS** | Global + auth-specific limiters verified present and functioning (triggered naturally during this session's repeated test runs) |
| Stack-trace/secret leakage in error responses | **PASS** | `server/middleware/errorHandler.js` — generic messages only, full error logged server-side |
| MFA | **NOT APPLICABLE — gap, not a failure of an existing control** | No MFA exists for any role; tracked as an open risk (R1), not scored as a broken control |

## 6. Functional testing results

| Suite | Result |
|---|---|
| `server/scripts/smoke-test.cjs` | **PASS — 143/143**, 0 failed (fresh server restart) |
| `server/scripts/smoke-test-business-rules.cjs` | **PASS — 75/75**, 0 failed (fresh server restart; grew from 68 baseline + 7 new security assertions) |
| `cd client && npm run build` | **PASS** — 0 errors (vite 6.4.3) |
| Browser/UI interactive QA | **NOT VERIFIED** — no browser-automation tool (Playwright/Puppeteer) is available in this environment; see §20 |

## 7. Authorization testing

**PASS.** Verified live via automated test across both suites: RBAC enforcement on every checked endpoint, cross-employee IDOR denial (documents, leave, payroll), CTO/SUPER_ADMIN elevated access working identically without name/email hardcoding, HR cannot self-approve or directly write compensation, FINANCE cannot approve compensation, MANAGER/EMPLOYEE payroll visibility correctly restricted, AUDITOR read-only access to audit log while HR/EMPLOYEE are denied it.

## 8. Document security

**PASS.** Required-document lifecycle (MISSING → UNDER_REVIEW → VERIFIED, or REJECTED) verified correct; `documentStatus` becomes COMPLETE only when every required category is VERIFIED; activation gate blocks ACTIVE transition while incomplete, verified role-independent (SUPER_ADMIN/CTO included); upload authorization, MIME allowlist, size limits, safe UUID-based storage, and (added this session) content-signature verification all confirmed by automated test.

## 9. Audit logging

**PARTIAL.** Confirmed append-only at the application layer (no delete route) and confirmed present for the specific actions both test suites exercise (login, document lifecycle, compensation, leave, policy). **Not** systematically proven for every sensitive-mutation endpoint in the codebase — flagged as internal-audit finding F14, tracked as a follow-up, not asserted as complete.

## 10. Secure development

**PARTIAL.** Strong in-application practices verified (input validation, centralized authz, no stack-trace leakage, mass-assignment protection). **No version control, no CI/CD, no code-review gate, no SAST/DAST/secrets-scanning** exist for this codebase — a real, unresolved gap (internal-audit finding F5), deliberately not fixed unilaterally this session since initializing version control is an organizational decision with real consequences (what gets committed, what remote, what workflow).

## 11. Dependency / security review

**PASS** (as of this report). `npm audit` on both `server/` and `client/`: **0 known vulnerabilities** after upgrading `nodemailer` 6.10.1→9.0.6, `vite` 5.4.21→6.4.3, `react-router-dom` 6.30.6→7.18.3. This was a manual, one-off check — no recurring/CI-gated scan exists yet (tracked in risk-treatment-plan item 12).

## 12. Risk assessment summary

20 risks assessed in `docs/iso27001/risk-assessment.md`. One CRITICAL inherent risk (R2, the JWT-secret issue) was fully treated this session. Remaining High residual risks: R8 (no backups, **OPEN**), R9 (no version control, **OPEN**), R16 (no monitoring, **OPEN**), R1/R13/R17 (**IN PROGRESS**, partial mitigation with follow-up identified). No risk in the register carries a residual score of zero.

## 13. Annex A applicability summary

93 controls assessed in `docs/iso27001/statement-of-applicability.md`: 16 IMPLEMENTED/VERIFIED, 14 IMPLEMENTED/NEEDS EVIDENCE, 17 PARTIALLY IMPLEMENTED, 20 NOT IMPLEMENTED, 26 NOT APPLICABLE—JUSTIFICATION REQUIRED (mostly physical/A.7 and cloud/network controls pending a hosting decision).

## 14. Statement of Applicability status

**PARTIAL — first version complete, not yet approved.** See `docs/iso27001/statement-of-applicability.md` for the full control-by-control mapping. Requires [APPROVER] sign-off and re-assessment of the 26 conditional items once hosting infrastructure is chosen.

## 15. Evidence index

**PARTIAL.** See `docs/iso27001/evidence-index.md`: 5 of 13 evidence categories have complete evidence today (source code, test results, configuration, risk records, access-control/security tests); 5 categories are explicitly marked **EVIDENCE REQUIRED — NOT YET AVAILABLE** (production deployment, backup testing, incident exercises, security training, management review/approval).

## 16. Internal audit findings

See `docs/iso27001/internal-audit-report.md`: 16 findings (1 CRITICAL — fixed; 4 HIGH — 2 fixed/2 open; 3 MEDIUM — 1 fixed/2 open; 3 LOW — 1 fixed/2 open; 3+1 OBSERVATION — all open). **Zero unresolved CRITICAL or exploitable-today application-security findings** remain from this audit; the open HIGH items (backup, version control, monitoring) are infrastructure/organizational, not application code defects.

## 17. Remaining limitations

- No backup mechanism exists (F4/R8) — the single largest open gap.
- No version control/CI/CD exists (F5/R9) — deliberately not remediated unilaterally; requires an organizational decision.
- No external monitoring/SIEM/alerting exists (F6/R16).
- No MFA exists for any role (F7/R1).
- Deactivating a user does not immediately revoke an already-issued session token (F8/R13).
- No malware/AV scanning of uploaded file content beyond type/signature validation (F13).
- Audit-log coverage is verified only for tested actions, not swept systematically across every controller (F14).
- Automated tests run against a shared (not isolated) test database (F15).
- No browser-automation tool was available in this environment, so interactive UI/QA and responsive-breakpoint testing were not performed live this session (§20).

## 18. Organizational evidence required

Policy approvals and sign-off ([APPROVER]), a completed management review (`management-review-template.md`), security-awareness training completion records, a data-classification/retention decision with real retention periods (legal input needed), screening/background-check evidence, disciplinary-process evidence, supplier due-diligence records for the SMTP provider and any future hosting vendor — none of these can be produced from source code and must come from [ORGANIZATION NAME] itself.

## 19. External infrastructure evidence required

A chosen [HOSTING PROVIDER], TLS-in-transit configuration, network segmentation, physical/data-center controls, redundancy/failover, an actual executed backup and a tested restore, a CI/CD pipeline with automated scanning gates, and log-shipping/alerting/SIEM integration — none of these exist yet because no production infrastructure has been decided.

## 20. Browser QA status

**NOT VERIFIED.** No Playwright/Puppeteer or other browser-automation tool is installed or available in this environment. Verification for UI-facing behavior in this report rests on: (a) the 218 passing API-level assertions across both regression suites, and (b) direct static code review of the relevant React components (`Employees.jsx`, `EmployeeDetail.jsx`, `Dashboard.jsx`) confirming they consume real backend data rather than mocked/hardcoded values. This is a real limitation, not a claimed pass.

## 21. Backup/recovery evidence status

**EVIDENCE REQUIRED.** No backup has ever been taken; `docs/backup-and-recovery.md` and `docs/disaster-recovery.md` define the required procedure but neither has been executed even once.

## 22. Incident-response evidence status

**EVIDENCE REQUIRED.** `docs/incident-response-plan.md` and policy 09 are drafted but have never been exercised against a real or simulated incident.

## 23. Management-review status

**EVIDENCE REQUIRED.** `docs/iso27001/management-review-template.md` is a blank, fillable template. No management review has been conducted; do not treat any example content in that template as a completed review.

## 24. Final readiness status

**Application security posture: materially hardened and evidence-backed.** **ISMS documentation: complete first draft, not yet approved or operationally exercised.** **Infrastructure/organizational readiness: early-stage, with the largest gaps (backup, version control, monitoring) clearly identified and planned, not yet closed.**

DutyLaunch HRMS is **not** ISO/IEC 27001 certified. It is, as of this report, a codebase with strong, independently-verified application-security controls and zero unresolved critical findings — sitting on top of infrastructure and process foundations that [ORGANIZATION NAME] has not yet built. Certification readiness requires closing the OPEN items in §17–19 and completing a real independent audit; this report is the honest starting point for that work, not its conclusion.

---

## Final status matrix

| Area | Status | Evidence |
|---|---|---|
| Application Security | **PASS** | §5, §11; 1 CRITICAL + 3 other findings fixed and re-verified this session |
| Authentication | **PASS** (MFA gap noted) | §5, §6; bcrypt, lockout, fail-closed secret validation, forged-token rejection all verified |
| Authorization | **PASS** | §7; RBAC + IDOR denial verified across 218 assertions |
| Document Security | **PASS** | §8; full lifecycle + activation gate verified role-independent |
| Audit Logging | **PARTIAL** | §9, F14; verified for tested actions, not swept exhaustively |
| API Security | **PASS** | §5, §11; validation, sanitization, rate limiting, generic errors all verified |
| Frontend Security | **PARTIAL** | §6, §20; code-level verification only, no live browser QA |
| Dependency Security | **PASS** | §11; 0 known vulnerabilities on both trees as of this report |
| Backup/Recovery | **FAIL** (gap, being actively addressed) | §17, §21; no mechanism exists, plan documented |
| Incident Response | **PARTIAL** | §22; plan documented, never exercised |
| Risk Management | **PASS** (as a process, not as "risk eliminated") | §12; register + treatment plan complete |
| ISMS Documentation | **PASS** | 17 policies + all supporting documents drafted |
| Annex A Mapping | **PASS** (as a completed mapping exercise) | §13; all 93 controls assessed |
| Statement of Applicability | **PARTIAL** | §14; complete, unapproved |
| Internal Audit | **PASS** (as a completed audit; findings remain open per above) | §16; 16 findings, 0 unresolved CRITICAL |
| Management Review | **EVIDENCE REQUIRED** | §23; template only |
| Browser QA | **NOT VERIFIED** | §20 |
| Production Infrastructure | **EVIDENCE REQUIRED** | §19; none exists |

### A. FIXED
Hardcoded/placeholder JWT secret (CRITICAL); `User.password` exposure gap; upload content-type spoofing; 4 dependency CVEs (nodemailer, vite, react-router-dom); a flaky test date-collision bug.

### B. VERIFIED
RBAC/IDOR denial; CTO elevated-permission architecture (no name/email hardcoding); compensation-approval separation of duties; mandatory-document lifecycle and activation gate; security headers; CORS restriction; NoSQL-injection protection; rate limiting; error-handling secret-safety; 218/218 total regression assertions passing; 0/0 dependency vulnerabilities; clean frontend build.

### C. NEEDS REAL-WORLD EVIDENCE
Policy approvals; a completed management review; security-training completion; an executed and tested backup; an exercised incident-response/DR plan; a production deployment.

### D. NEEDS ORGANIZATIONAL DECISION
Whether/how to initialize version control and a review process; choice of [HOSTING PROVIDER]; MFA rollout scope and timeline; retention periods (needs [LEGAL COUNSEL]); token-revocation-on-deactivation design; security-awareness training program.

### E. NEEDS EXTERNAL AUDITOR / CERTIFICATION BODY
Any actual ISO/IEC 27001:2022 certification decision, Stage 1/Stage 2 audit, and surveillance audits — none of which this or any code-level engagement can perform or substitute for.
