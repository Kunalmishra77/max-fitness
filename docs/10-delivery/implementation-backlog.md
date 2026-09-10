# Implementation Backlog (epics → tasks)

Status legend: ☐ todo · ◐ in progress · ☑ done. IDs referenced by commits (`feat(crm): CRM-08 renew in 3 taps`).

## E1 Foundation (Phase 1)
- ☐ F-01 pnpm + Turborepo monorepo, TS base config, ESLint flat config, Prettier, EditorConfig, `.nvmrc`
- ☐ F-02 `packages/shared`: env schema, time (IST) helpers, phone/money/mask utils, Zod schemas skeleton, settings schema with defaults
- ☐ F-03 `packages/db`: Prisma 7 setup (`prisma.config.ts`, adapter-pg), schema from docs, first migration + raw SQL additions, client export
- ☐ F-04 `packages/core`: ports (Clock, providers), pricing, membership dates, fee state, renewal start, receipt FY, signed tokens — with unit tests from business-rules examples
- ☐ F-05 Seed script per demo-data spec (220 members, relative dates, histories, attendance, leads, messages, tasks, alerts)
- ☐ F-06 `apps/web` Next.js skeleton, next-intl (en/hi), Tailwind v4 tokens from design-tokens.json, fonts Khand + Hind via next/font, base UI primitives
- ☐ F-07 `apps/worker` skeleton with pg-boss boot, heartbeat, graceful shutdown
- ☐ F-08 `packages/integrations` interfaces + simulator/simulated implementations
- ☐ F-09 Docker compose dev (Postgres 17), web/worker Dockerfiles
- ☐ F-10 GitHub Actions CI; Dependabot
- ☐ F-11 VPS bootstrap script, Caddy, staging deploy, backups + restore test
- ☐ F-12 Health endpoint; Sentry wiring (PII scrubbing)

## E1b Face POC
- ☐ POC-01 Kotlin CameraX + ML Kit detection demo with quality gate overlay
- ☐ POC-02 Pluggable embedding engine; research weights for internal measurement only; vendor SDK trial integration
- ☐ POC-03 Enrolment (selfie import + 5-frame assisted), matcher, decision logging to CSV
- ☐ POC-04 Field test per protocol; report with ROC/threshold, speed, thermal; licence recommendation

## E2 Website (Phase 2)
- ☐ LP-01..02 Nav + announcement bar
- ☐ LP-03 Hero slider (Embla), video sources/posters, reduced-motion & Save-Data, rep-tally indicator, pause control
- ☐ LP-04 Lead form + `POST /leads` + dedupe + alert outbox + call task rule
- ☐ LP-05..08 Trust strip, About, Facilities zones, How to start
- ☐ LP-09 Fee board with gender toggle (plans from DB, cache tag)
- ☐ LP-10 Champion plaque (content placeholders)
- ☐ LP-11..13 Promo banner, testimonials, gallery lightbox
- ☐ LP-17..21 FAQ (+schema), final CTA, contact/map click-to-load, footer, mobile sticky bar, WhatsApp float
- ☐ LP-23 SEO: metadata, OG, JSON-LD ExerciseGym, sitemap, robots
- ☐ LP-25 Consent banner + analytics wrapper
- ☐ Legal pages (privacy/terms/refund/contact) from markdown
- ☐ Lighthouse CI + axe in pipeline

## E3 Sign-up & payments (Phase 3)
- ☐ SU-01 `/join` routes + intercepted modal
- ☐ SU-02 Details form (RHF + Zod), DOB selects, gender, consents, minor notice
- ☐ SU-03/04 SelfieCapture (permission explainer, MediaPipe face check, capture/compress, fallback, in-app browser banner)
- ☐ SU-09 `POST /registrations` (sharp pipeline, MediaFile, Consent, token)
- ☐ SU-10/11 Plan step + `GET /plans` + date preview
- ☐ PAY-02 `POST /checkout/orders` (Razorpay + simulated)
- ☐ PAY-03 `POST /checkout/verify`, `confirmPayment()` idempotent, webhook route with signature + WebhookEvent
- ☐ PAY-04 Pay at reception reservation
- ☐ PAY-05/06 Confirmation & failure pages; receipt PDF job; `/r/[token]`
- ☐ PAY-07 `/renew/[token]`
- ☐ SU-12 Abandoned signup call task
- ☐ E2E journeys 3–6

## E4 CRM core (Phase 4)
- ☐ CRM-01 PIN login keypad, sessions, lockout, trusted device
- ☐ CRM-02 Permissions module + tests
- ☐ CRM-03 Home dashboard (tiles, calls, birthdays, verify count, money)
- ☐ CRM-04/05 MemberRow, list, search
- ☐ CRM-06 Profile (fee card, actions, attendance dots, plan/payment history, messages)
- ☐ CRM-07 Add member wizard (photo first)
- ☐ CRM-08 Renew 3 taps + desk payment + receipt + undo
- ☐ CRM-09 Mark left / reactivate
- ☐ CRM-10 Calls list + outcomes + nightly job
- ☐ CRM-12/13 Birthdays, Fees tabs
- ☐ CRM-14 Leads pipeline (basic)
- ☐ CRM-15 Attendance today/absent/manual
- ☐ CRM-16 Alerts bell
- ☐ CRM-17 Reports (basic cards)
- ☐ CRM-20 Settings: prices, hours, promo, trust, staff
- ☐ CRM-22/23/24 Voice button, undo bar, PWA manifest
- ☐ CRM-25/26 Export & privacy request actions

## E5 QR & import (Phase 5)
- ☐ QR-01..05 `/qr` flows, OTP provider (simulated + WhatsApp auth template), lookup
- ☐ CRM-11 Verify queue + approve/edit/reject
- ☐ CRM-21 CSV import preview/commit
- ☐ QR poster generator script

## E6 WhatsApp (Phase 6)
- ☐ WA-core rules/engine/eligibility + full test matrix
- ☐ Worker slot crons + catch-up + send handler + retries
- ☐ Meta Cloud provider (template/text/interactive) + error classification
- ☐ Webhook inbound: statuses, buttons, keywords, quality events
- ☐ Unsubscribe/restart transactions + confirmation messages
- ☐ Receipts, welcome, verification approved, owner digest, owner alerts
- ☐ Safeguards: quiet hours, number cap, failure guard, quality auto-pause, kill switch
- ☐ Simulator timeline + time travel (non-prod)
- ☐ CRM Messages log + pause reminders + reminder settings UI

## E7 Kiosk (Phase 7)
- ☐ K-01 App shell, Hilt, Compose theme, Device Owner lock task, boot, keep-awake, crash restart
- ☐ K-02 CameraX analyzer with adaptive fps + thermal handling
- ☐ K-03 FaceEngine impl (licensed), quality gate, aligner, matcher, liveness
- ☐ K-04 Decision machine + screens (idle/welcome/expired/confirm/unknown/keypad)
- ☐ K-05 Room + SQLCipher, Keystore, gallery index
- ☐ K-06 Pairing, sync, attendance upload, enrolment jobs, templates upload, heartbeat, commands
- ☐ K-07 Assisted enrolment + admin screen
- ☐ K-08 TTS Hindi greetings
- ☐ K-09 Server: kiosk endpoints, ingest service, CRM kiosk settings/pairing/status, offline alert job
- ☐ K-10 Acceptance tests on device

## E8 Hardening & launch (Phase 8)
- ☐ Security checklist, ZAP, IDOR tests, CSP enforcement
- ☐ Privacy checklist, retention jobs verified with fake clock
- ☐ Performance: Lighthouse, k6 load, worker soak
- ☐ Restore drill; monitoring & alert routing
- ☐ Production seed; secrets; webhooks live
- ☐ UAT with owner; training; handover docs
- ☐ Go-live & launch sequence
