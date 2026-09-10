# Development Roadmap

Indicative calendar starting Mon 14 Sep 2026. ~9 weeks build + 2–4 weeks rollout. Adjust to team capacity. Gantt: `docs/06-diagrams/diagrams.md` §9.

## 1. Guiding sequence
1. **De-risk first:** face-recognition POC and Meta/Razorpay approvals start in week 0, in parallel.
2. **Core rules before screens:** `packages/core` + tests land in Phase 1 so every UI uses the same logic.
3. **Demo early:** full clickable demo with seeded data, simulated payment and WhatsApp simulator by end of Phase 4 (~week 5).
4. **Real integrations when approvals land:** swap adapters, not code.

## 2. Phases

| Phase | Weeks | Goal | Key outputs | Exit criteria | Prompt |
|---|---|---|---|---|---|
| 0 Kick-off (parallel) | W0–W1 | Remove long lead-time blockers | Client inputs sheet returned, Meta business verification started, WABA number, templates submitted, Razorpay KYC started, domain, VPS bootstrapped, shoot done, owner interview, phone bought, face vendor shortlist | Blockers list tracked; shoot assets in drive | — (ops checklist in README) |
| 1 Foundation | W1 | Monorepo, tooling, DB, core rules, seed, design tokens, CI | Running `pnpm dev`, migrations, 220-member seed, core unit tests green, staging deployed with placeholder page | CI green; staging reachable over HTTPS; backups running | `00-FIRST-PROMPT.md` |
| 1b Face POC spike | W1–W2 | Prove recognition on real phone & spot | Minimal Kotlin POC app, measurements per §13 protocol, vendor comparison, licence recommendation | Go/no-go decision recorded | `01-face-recognition-poc.md` |
| 2 Landing page + legal | W2 | Conversion-ready website | All sections, hero video slider, lead form → DB + simulated owner alert, SEO, legal pages, analytics consent | Lighthouse mobile ≥ 90 perf / 95 SEO / 95 a11y; client copy approval | `02-landing-page.md` |
| 3 Sign-up & payments | W3 | Registration → plan → pay → confirmation | Selfie capture, registration API, plans API, Razorpay test mode + simulated, confirmation, receipts, renew page, pay at reception | E2E journeys 3–5 green | `03-signup-selfie-payment.md` |
| 4 CRM core | W4–W5 | Owner can run the gym | Auth/PIN, Home, Members, Profile, Add, Renew, Fees, Calls, Alerts, Attendance (manual), Reports (basic), Settings (prices), PWA, Hindi + voice | Owner paper/Figma test done before build; 5-task test on staging | `04-crm-core.md` |
| ★ Client demo | end W5 | Show the full journey | Staging with simulator | Client feedback captured | — |
| 5 QR onboarding & import | W6 | Migrate existing members | `/qr` flows, OTP (toggle), Verify queue, CSV import, QR poster generator | E2E journey 7 green | `05-qr-onboarding-import.md` |
| 6 WhatsApp engine | W6–W7 | Automated reminders & unsubscribe | Rules, slot engine, send handler, webhook inbound, unsubscribe/restart, receipts/welcome/digest/alerts, simulator time travel, kill switch | Reminder test matrix 100% green; templates approved; allowlist live test | `06-whatsapp-engine.md` |
| 7 Attendance kiosk | W7–W9 | Production kiosk | Kotlin app with licensed engine, kiosk mode, enrolment, sync, heartbeat, CRM kiosk pages, expired alerts | Acceptance tests §14 pass on device | `07-attendance-kiosk.md` |
| 8 Hardening & launch | W9–W10 | Production-ready | Security & privacy checklists, perf, load/soak, ZAP, restore drill, UAT, training, go-live | Release criteria PRD §8 | `08-hardening-launch.md` |
| Rollout | W10–W12 | Adoption | QR migration drive, kiosk shadow mode 2 weeks, hypercare | ≥ 90% members verified; kiosk targets met | — |

## 3. Critical path & dependencies
```
Meta business verification ──► template approval ──► Phase 6 live sends ──► launch
Razorpay KYC (needs legal pages from Phase 2) ──► live payments ──► launch
Face POC go/no-go + licence ──► Phase 7 production engine ──► kiosk go-live (can trail website launch)
Owner inputs (prices B1, story C2, refund B6) ──► Phase 2 content ──► launch
Photo/video shoot ──► Phase 2 visuals
```
**Decoupling:** the website + CRM + reminders can go live before the kiosk. Attendance can run manually in CRM until the kiosk passes shadow mode.

## 4. Suggested team allocation
| Person | Primary | Secondary |
|---|---|---|
| Tech lead (e.g., Vimlendra) | Architecture, core package, reviews, security, deployment | Face POC oversight, vendor evaluation |
| Full stack (e.g., Rachit) | APIs, payments, WhatsApp engine, worker, DB | CI/CD |
| Frontend (e.g., Yash) | Landing, signup/selfie, CRM UI, PWA | Playwright |
| UI/UX (e.g., Mithlesh) | Design system, landing visuals, CRM co-design with owner, kiosk screens, print assets | Content with client |
| QA (e.g., Nafis) | Test matrices, E2E, UAT coordination, field tests at gym | Accessibility checks |
| Android dev (assign or contract) | Face POC, kiosk app | — |
| Founder | Client inputs, approvals, owner training, commercial licence decisions | — |

## 5. Milestone reviews
- **M1 (end W1):** foundation + POC early numbers.
- **M2 (end W3):** website + signup on staging for client copy/visual review.
- **M3 (end W5):** full demo with simulator — biggest client feedback checkpoint.
- **M4 (end W7):** real WhatsApp on allowlist; QR drive dry-run.
- **M5 (end W9):** kiosk on-site shadow mode start.
- **M6 (W10):** go-live.

## 6. Release 1.1 candidates
Membership freeze, member self-service portal (fees, attendance, receipts), personal training packages, trainer app, class/batch schedules, turnstile integration, multi-branch UI, GST invoices, referral rewards, Google review requests automation (policy-safe), BMI/diet lead magnets.
