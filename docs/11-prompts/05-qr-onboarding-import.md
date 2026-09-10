# 05 — Phase 5: QR Onboarding, Verification & Register Import

```text
Phase 5: migrate existing members and onboard walk-ins via QR.

Read first: CLAUDE.md; PRD §5.4 and CRM-11, CRM-21; business-rules BR-3.6, BR-13; docs/05-engineering/qr-onboarding-flow.md; landing-page-wireframes.md (QR flow); copy deck (QR flow); crm-ux-blueprint §9; crm-module-spec §7; api-specification.md (/qr/*, /otp/*, verifications, import).

Build:
1. /qr choice screen (bilingual, huge targets), /qr/existing one-question-per-screen wizard including the REQUIRED "What is your month-end date?" step, /qr/new reusing Phase 3 components with Pay at reception option, /qr/done/[ref].
2. OTP: OtpProvider interface; simulated provider in DEMO_MODE; WhatsApp authentication-template provider stub for Phase 6; POST /otp/send, /otp/verify with limits; feature flag otpRequired.
3. POST /qr/lookup (after OTP) returning imported candidates on that mobile (names + masked info only).
4. POST /qr/existing and /qr/new; VerificationRequest with random reference code; alerts; VERIFICATION_PENDING call task after 2 h.
5. CRM Verify queue per UX §9 with side-by-side import match; approve/edit date/reject transactions per spec §4; outbox verification-approved message; enrolment job if consent.
6. CRM Import wizard: CSV upload (template in assets/demo-data/member_import_template.csv), parse & validate (DD-MM-YYYY), preview with row errors/warnings, owner PIN commit, declared memberships, whatsappOptIn=false unless desk-consent group ticked, audit log.
7. infra/scripts/generate-qr-poster.ts: SVG poster (A5 and A4) with logo, bilingual instruction, QR (error correction Q) for a given URL; output to assets/reception-qr/.
8. Tests: E2E journey 7; import parser unit tests (bad dates, duplicate mobiles, family numbers); verification transaction integration tests.
Finish: update progress-log.md.
```
