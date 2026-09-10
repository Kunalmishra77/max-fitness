# Implementation Prompts

| # | Prompt | When | Depends on |
|---|---|---|---|
| 00 | `00-FIRST-PROMPT.md` — Foundation | Start here | Blueprint only |
| 01 | `01-face-recognition-poc.md` — Face POC spike | Parallel with 00 (Android dev) | Phone at reception |
| 02 | `02-landing-page.md` | After 00 | Copy + placeholder media |
| 03 | `03-signup-selfie-payment.md` | After 02 | Razorpay test keys (optional) |
| 04 | `04-crm-core.md` | After 03 | Owner co-design session |
| 05 | `05-qr-onboarding-import.md` | After 04 | Register CSV sample |
| 06 | `06-whatsapp-engine.md` | After 05 | Meta app + test number for live test |
| 07 | `07-attendance-kiosk.md` | After 06 + POC go | Licensed face engine |
| 08 | `08-hardening-launch.md` | Last | Everything |

Tips: one phase per session (or per few sessions); always let the agent read the listed docs first; review its plan before it codes; keep `progress-log.md` current so any session can resume.
