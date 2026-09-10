# Max Fitness Platform

Complete digital system for **Max Fitness Gym**, Krishan Plaza, Plot No. 6, Nyay Khand 1, Indirapuram, Ghaziabad, Uttar Pradesh 201020 (opposite Sai Mandir).

This folder starts as a **documentation-first blueprint**. Nothing is built yet. Every decision needed to build the product is written down in `docs/`, and the build is driven phase by phase using the prompts in `docs/11-prompts/`.

## What we are building

| Product | Who uses it | What it does |
|---|---|---|
| **Website** (`apps/web`, public routes) | Prospective and existing members | Premium landing page, lead capture, sign-up with live selfie, plan selection, online payment, confirmation |
| **Max Register** (`apps/web`, `/crm`) | Gym owner and reception staff | Extremely simple, visual, Hindi-first CRM: members, fees, renewals, birthdays, call list, attendance, WhatsApp log, reports |
| **QR onboarding** (`apps/web`, `/qr`) | People standing at reception | Scan poster QR, choose Existing or New customer, self-register (existing members declare their month-end date) |
| **Reminder engine** (`apps/worker`) | Runs automatically | WhatsApp renewal reminders, unsubscribe handling, owner daily digest, call-list generation |
| **Max Haazri kiosk** (`apps/kiosk-android`) | Members walking in | Always-on Android phone at reception that recognises faces and marks attendance offline-first |

## How to start (read in this order)

1. `docs/00-START-HERE.md` — map of every document and the reading order.
2. `docs/01-project/01-project-analysis.md` — the deep analysis, key decisions and the things we deliberately changed from the original brief.
3. `docs/01-project/03-client-inputs-and-open-questions.md` — send this to the gym owner **today**; several items block launch.
4. `docs/10-delivery/development-roadmap.md` — phases, timeline, critical path.
5. `CLAUDE.md` — operating rules for AI coding agents (Claude Code or others).
6. `docs/11-prompts/00-FIRST-PROMPT.md` — paste this into your coding agent to begin Phase 1.

## Start-this-week checklist (long lead-time items)

These take days to weeks and do not depend on code. Start them in parallel with Phase 1.

- [ ] Meta Business verification + WhatsApp Business Account + dedicated phone number
- [ ] Razorpay account KYC (needs live Terms, Privacy, Refund and Contact pages — see Phase 2)
- [ ] Domain purchase and DNS access
- [ ] Mumbai-region VPS provisioned and hardened
- [ ] Photo and video shoot at the gym (`docs/04-content/assets-checklist-and-shot-list.md`)
- [ ] Owner interview for the champion story (`assets/owner-story/README.md`)
- [ ] Face-recognition model or SDK licence decision (`docs/05-engineering/attendance-face-recognition-system.md` §4)
- [ ] Buy the reception Android phone, stand and light (`docs/05-engineering/attendance-face-recognition-system.md` §3)

## Repository layout (target)

See `docs/05-engineering/folder-structure.md`. Summary:

```
apps/web               Next.js: website + signup + QR + CRM + API
apps/worker            Node worker: schedules, WhatsApp, digests
apps/kiosk-android     Kotlin kiosk app for face attendance
packages/core          Domain logic (pricing, dates, reminders, attendance rules)
packages/db            Prisma schema, migrations, seed
packages/shared        Zod schemas, types, constants, IST time helpers
packages/integrations  WhatsApp, Razorpay, storage adapters
infra/                 Docker, Caddy, backups, scripts
docs/                  All blueprints (this package)
assets/                Brand, photos, videos, demo data
```
