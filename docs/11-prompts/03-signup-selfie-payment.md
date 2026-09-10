# 03 — Phase 3: Sign-up, Selfie, Plans, Payment, Confirmation

```text
Phase 3: registration and payments.

Read first: CLAUDE.md; PRD §5.2–5.3; business-rules BR-2, BR-3, BR-4, BR-11, BR-12; docs/05-engineering/signup-and-payment-flow.md (all); landing-page-wireframes.md (Sign-up modal section); website-copy-deck.md (Sign-up flow); api-specification.md §3–4; security-plan.md §3.1 (uploads, tokens, webhooks); privacy doc §3–5.

Build:
1. Routes /join, /join/plan, /join/pay, /join/done and the intercepted modal @modal/(.)join from the landing page; deep-linkable; sessionStorage state per spec.
2. Details form: fields, DOB selects, gender, consents (face consent un-ticked, forced off for minors), notice version constant, minor notice.
3. SelfieCapture component exactly per spec §2 (explainer, getUserMedia errors, MediaPipe Face Detector self-hosted WASM assets, oval guide, capture/compress, fallback input, in-app browser banner, track cleanup). Component tests for each state with mocked mediaDevices.
4. POST /api/v1/registrations: multipart parsing, magic-byte check, sharp pipeline, StorageDriver, MediaFile, Member PENDING_PAYMENT, Consent rows, registrationToken (signed), duplicate hint.
5. GET /api/v1/plans; plan step UI (monthly first, then packages; start date ≤ 15 days; end date preview via core).
6. POST /api/v1/checkout/orders with PaymentProvider (simulated in DEMO_MODE, Razorpay test mode when keys present). Implement packages/integrations/payments/razorpay.ts (orders.create, payment fetch, signature helpers).
7. POST /api/v1/checkout/verify, GET /api/v1/checkout/status, POST /api/v1/webhooks/razorpay (raw body HMAC, WebhookEvent unique, handlers). One confirmPayment() in packages/core used by all paths; receipt counter per FY with row lock; Outbox events (receipt, receipt pdf, enrolment-if-consent, owner alert).
8. Pay at reception reservation; failure page; confirmation page with receipt and next steps.
9. Worker: outbox-dispatch job; receipt-pdf job (@react-pdf/renderer) storing RECEIPT_PDF; /r/[token] receipt page.
10. /renew/[token] page + GET /api/v1/renew/{token}; renewal start rule BR-3.4.
11. Call task SIGNUP_NOT_PAID after 24h (nightly job partial implementation).
12. Tests: integration tests P1–P9 (testing-strategy §5) with Testcontainers; Playwright journeys 3–6 using Chrome fake media stream flags and a fixture y4m file (generate a synthetic face-like test pattern; do not use real people's images).

Security: never trust client amounts; verify amounts on webhook; signed tokens purpose-bound; no PII in logs.
Finish: update progress-log.md and decision-log.md.
```
