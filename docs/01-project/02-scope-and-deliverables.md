# 02 — Scope and Deliverables

## 1. In scope (Release 1.0)

### A. Public website
- Landing page with all sections defined in `docs/03-design/landing-page-wireframes.md`
- Hero video slider with text overlays, CTAs and lead form
- Sign-up modal with live camera selfie, plan selection, Razorpay payment, confirmation
- Renew page reachable from WhatsApp (`/renew/[token]`)
- Legal pages: Privacy, Terms, Refund & Cancellation, Contact
- Local SEO (schema, metadata, sitemap), analytics (consent-gated)
- Hindi/English toggle for key public flows

### B. QR onboarding
- Printed reception standee with QR → `/qr`
- Existing-customer flow with mandatory "month-end date", selfie, verification queue
- New-customer flow with pay online or pay at reception

### C. Max Register (CRM)
- PIN login for owner and staff, role-based permissions
- Home "Today" dashboard: members, today's attendance, fees due, expired, birthdays, call list, alerts, money this month
- Members: list, search by name/phone/photo, profile, add, edit, renew, record payment, mark left
- Fees: due this week, expired, collections, receipts
- Call list with one-tap call/WhatsApp and big outcome buttons
- Verification queue (QR existing customers)
- Leads pipeline (website + walk-in)
- Attendance: today, per-member calendar, absent list, manual mark
- WhatsApp: message log, per-member pause, Message Simulator (demo)
- Reports: simple monthly insights
- Settings: prices, plans, reminder rules, gym hours, promo banner, staff, kiosk devices
- CSV import of existing register

### D. Reminder engine (worker)
- Pre-expiry, expiry-day, post-expiry reminder rules with cap
- Unsubscribe handling → member marked Left, reminders stop permanently
- Owner daily digest on WhatsApp
- Call-task generation, birthday detection, absence detection
- Webhook processing for delivery status

### E. Max Haazri attendance kiosk (Android)
- Kiosk-locked app, always-on camera, on-device face detection + recognition
- Enrolment from signup selfie + at-desk enrolment
- Offline queue and sync, device pairing, heartbeat
- Greeting screen + Hindi voice, expired-member discreet handling
- Manual fallback (mobile number keypad)

### F. Infrastructure & operations
- Dockerised deployment on Mumbai VPS, staging + production
- CI/CD, backups with restore drill, monitoring and alerting
- Security hardening, DPDP-aligned consent and data-rights workflows

### G. Documentation & training
- This blueprint package
- Owner training (Hindi video + laminated one-page guide)
- Staff SOPs, handover runbook

## 2. Out of scope for 1.0 (candidates for 1.1+)
- Member mobile app / member login portal
- Diet plans, workout plans, trainer scheduling, class booking
- Turnstile / door-lock integration
- Personal-training package billing (unless owner confirms it's needed now)
- Membership freeze/pause (schema-ready, UI later)
- GST invoicing (depends on owner's GST registration — see open questions)
- Marketing broadcast campaigns on WhatsApp
- Multi-branch operation (schema-ready)
- Supplement/merchandise shop

## 3. Deliverables checklist

| # | Deliverable | Phase | Acceptance owner |
|---|---|---|---|
| 1 | Blueprint package (this) | 0 | Founder |
| 2 | Face recognition POC report with go/no-go | 1b | Tech lead |
| 3 | Clickable demo on staging with seeded data | 4 | Founder + client |
| 4 | Production website live + GBP website link | 2/8 | Client |
| 5 | Sign-up + payment live (Razorpay live mode) | 3/8 | Client |
| 6 | Max Register CRM live | 4 | Owner (UAT) |
| 7 | QR standee printed and live | 5 | Owner |
| 8 | WhatsApp templates approved, engine live | 6 | Owner |
| 9 | Kiosk installed, shadow mode → live | 7 | Owner |
| 10 | Training, SOPs, handover | 8 | Owner |
| 11 | 30-day hypercare report | Post | Founder |
