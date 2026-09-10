# 04 — Risk Register

Scale: Likelihood (L) and Impact (I) 1–5. Score = L×I. Review weekly.

| ID | Risk | L | I | Score | Mitigation | Owner | Trigger |
|---|---|---|---|---|---|---|---|
| R1 | Face recognition accuracy too low in real reception lighting (backlight from door, evening tube lights) | 3 | 5 | 15 | Week-1 POC on actual phone at actual spot; add LED panel light; multi-template enrolment; confirm-prompt band; shadow mode 2 weeks; manual fallback always available | Tech lead | Auto-recognition < 90% in POC |
| R2 | Face model licence not valid for commercial use | 4 | 5 | 20 | `FaceEngine` interface; evaluate licensed SDKs in parallel with POC; no production release on research-only weights | Founder | Before Phase 7 build |
| R3 | Meta Business verification or template approval delays | 3 | 4 | 12 | Start week 0; utility-only wording; simulator for demo; BSP fallback adapter | Delivery | Not verified by week 4 |
| R4 | WhatsApp number quality drop due to repeated reminders | 3 | 4 | 12 | Post-expiry cap; quiet hours; clear Unsubscribe; monitor quality rating via webhook/Business Manager; auto-pause rule on quality downgrade | Tech lead | Quality rating Medium |
| R5 | Owner does not adopt CRM | 3 | 5 | 15 | Co-design with owner using paper prototypes; home screen = 3 tasks; Hindi voice; WhatsApp digest delivers value even if CRM unopened; weekly check-in first month | Founder + UI/UX | < 3 opens/week |
| R6 | Razorpay live activation delayed | 3 | 3 | 9 | Policy pages in Phase 2; submit KYC week 1; desk payments recorded in CRM meanwhile | Delivery | Not live by Phase 8 |
| R7 | Paper-register data messy or incomplete | 4 | 3 | 12 | CSV template; staff-assisted import day; QR confirm drive; verification queue | Delivery | < 70% verified in 2 weeks |
| R8 | Android phone overheats / battery swells running 14 h daily | 3 | 3 | 9 | Adaptive frame rate; idle dim mode; charge-limit feature or smart plug schedule; ventilated stand; heartbeat temperature alerts | Tech lead | Temp > 42°C alerts |
| R9 | Camera permission blocked in in-app browsers (Instagram/WhatsApp webviews) | 4 | 2 | 8 | Detect webview → "Open in Chrome" banner; `<input capture="user">` fallback | Frontend | Selfie failure > 10% |
| R10 | Privacy complaint about biometric use | 2 | 4 | 8 | Opt-in consent, notice in Hindi/English, manual alternative, deletion on leaving, grievance contact | Founder | Any complaint |
| R11 | Single VPS failure / data loss | 2 | 5 | 10 | Nightly encrypted off-site backups, weekly restore test, infra-as-code rebuild < 2 h, kiosk offline queue | DevOps | Backup job failure |
| R12 | Scope creep (diet plans, trainer apps) | 4 | 3 | 12 | Scope doc signed; 1.1 backlog; change-request process | Founder | New requests |
| R13 | Owner-story claims unverifiable | 2 | 3 | 6 | Publish only documented facts; certificates photographed | Content | Missing proof |
| R14 | Framework security advisories during build | 3 | 3 | 9 | Pin active LTS, Dependabot/Renovate, patch window within 72 h for critical | Tech lead | Advisory published |
| R15 | Shared family phone numbers cause wrong unsubscribe | 3 | 3 | 9 | Signed per-member payloads; confirmation + restart button | Backend | Mismatch report |
