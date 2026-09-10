# Diagrams (Mermaid)

Architecture context/container/component diagrams are in `docs/05-engineering/system-architecture.md`. Kiosk state machine and sync sequence are in `attendance-face-recognition-system.md`. This file holds the remaining cross-cutting diagrams.

## 1. Entity-relationship (core)

```mermaid
erDiagram
  Gym ||--o{ StaffUser : employs
  Gym ||--o{ Plan : offers
  Gym ||--o{ Member : has
  Gym ||--o{ ReminderRule : configures
  Gym ||--o{ KioskDevice : pairs
  StaffUser ||--o{ Session : opens
  Member ||--o{ Membership : holds
  Plan ||--o{ Membership : "priced by"
  Membership ||--o{ Payment : "paid by"
  Member ||--o{ Payment : makes
  Member ||--o{ Consent : gives
  Member ||--o{ MediaFile : owns
  Member ||--o{ FaceTemplate : "enrolled as"
  Member ||--o{ EnrollmentJob : needs
  Member ||--o{ AttendanceEvent : "checks in"
  KioskDevice ||--o{ AttendanceEvent : records
  Member ||--o{ MessageLog : receives
  Membership ||--o{ MessageLog : "reminded about"
  Member ||--o{ CallTask : "to call"
  Member ||--o{ VerificationRequest : claims
  Member ||--o{ Alert : about
  Gym ||--o{ Lead : receives
  Gym ||--o{ AuditLog : logs
  Gym ||--o{ OutboxEvent : queues
  Gym ||--o{ WebhookEvent : receives
  Gym ||--o{ Counter : sequences
```

## 2. Member lifecycle

```mermaid
stateDiagram-v2
  [*] --> PENDING_PAYMENT: website / QR new signup
  [*] --> PENDING_VERIFICATION: QR existing customer
  [*] --> ACTIVE: desk add with payment / CSV import
  PENDING_PAYMENT --> ACTIVE: payment PAID (online or desk)
  PENDING_PAYMENT --> [*]: 7 days unpaid (reservation cancelled, stays as lead)
  PENDING_VERIFICATION --> ACTIVE: owner approves
  PENDING_VERIFICATION --> [*]: rejected + 7 days
  ACTIVE --> LEFT: unsubscribe / owner marks left / 60 days lapsed
  LEFT --> ACTIVE: pays again / restart within 7 days
  ACTIVE --> BLOCKED: owner bans
  BLOCKED --> ACTIVE: owner unblocks
```

## 3. Fee state (derived, per day)

```mermaid
flowchart LR
  A{Confirmed membership exists?} -- no --> NONE[NONE grey]
  A -- yes --> B{today > endDate?}
  B -- yes --> EXP[EXPIRED red]
  B -- no --> C{endDate - today ≤ 7?}
  C -- yes --> DUE[DUE_SOON amber]
  C -- no --> PAID[PAID green]
```

## 4. Online sign-up & payment sequence

```mermaid
sequenceDiagram
  autonumber
  actor U as Visitor
  participant B as Browser
  participant API as Next.js API
  participant C as packages/core
  participant DB as Postgres
  participant RZ as Razorpay
  participant W as Worker
  participant WA as WhatsApp
  U->>B: Tap Sign up, fill form, take selfie
  B->>API: POST /registrations (multipart)
  API->>C: registerMember()
  C->>DB: Member PENDING_PAYMENT, Consents, MediaFile
  API-->>B: registrationToken
  B->>API: GET /plans?gender
  U->>B: Choose plan & start date
  B->>API: POST /checkout/orders
  API->>C: priceAndDates()
  C->>DB: Membership PENDING, Payment CREATED
  API->>RZ: orders.create(amount)
  RZ-->>API: order_id
  API-->>B: order_id, key_id
  B->>RZ: Checkout (UPI/card)
  RZ-->>B: payment_id, signature
  B->>API: POST /checkout/verify
  API->>C: confirmPayment() [idempotent]
  C->>DB: Payment PAID, Membership CONFIRMED, Member ACTIVE, Outbox
  RZ-->>API: webhook payment.captured (any order)
  API->>C: confirmPayment() → already PAID, no-op
  API-->>B: PAID + receipt
  W->>DB: poll Outbox
  W->>WA: mf_payment_receipt, mf_welcome_member
  W->>DB: EnrollmentJob (if face consent), owner alert
```

## 5. Reminder slot & unsubscribe sequence

```mermaid
sequenceDiagram
  autonumber
  participant Cron as pg-boss cron 19:00 IST
  participant Eng as ReminderEngine
  participant DB as Postgres
  participant Send as whatsapp.send job
  participant WA as WhatsApp Cloud API
  actor M as Member
  participant WH as Webhook handler
  Cron->>Eng: planSlot(today, "19:00")
  Eng->>DB: candidates (rules × fee dates × eligibility)
  Eng->>Send: enqueue intents (idempotency keys)
  Send->>DB: re-check eligibility, INSERT MessageLog ON CONFLICT DO NOTHING
  Send->>WA: template mf_membership_expired (+Renew URL, +Unsubscribe payload)
  WA-->>M: message
  WA-->>WH: status delivered/read
  WH->>DB: MessageLog status
  M->>WA: taps Unsubscribe
  WA-->>WH: inbound button payload UNSUB.<token>
  WH->>WH: verify signature + HMAC
  WH->>DB: TX: Member LEFT, unsubscribed, CallTask, Alert, Audit, Outbox
  WH->>WA: free-form confirmation + Restart button
  Note over Cron,DB: Next slot: member not ACTIVE → no candidates
```

## 6. QR existing-customer verification

```mermaid
sequenceDiagram
  actor M as Member at reception
  participant Q as /qr/existing
  participant API as API
  participant DB as Postgres
  actor O as Owner/Staff (CRM)
  M->>Q: Scan poster, choose Existing
  Q->>API: OTP send/verify (optional)
  Q->>API: POST /qr/existing (details, selfie, month-end date)
  API->>DB: Member PENDING_VERIFICATION, VerificationRequest, Alert
  API-->>Q: reference Q-4821
  M->>O: Shows reference on phone
  O->>API: Approve (edit date if needed)
  API->>DB: Membership CONFIRMED (declared), Member ACTIVE, Outbox
  API-->>O: Done ✓
  Note over DB: Reminders eligible from next slot, enrolment job created
```

## 7. Attendance ingest (server side)

```mermaid
flowchart TD
  E[Kiosk batch event] --> D{clientEventId exists?}
  D -- yes --> DUP[DUPLICATE]
  D -- no --> EL{Member eligible & ACTIVE?}
  EL -- no --> INE[INELIGIBLE logged]
  EL -- yes --> CD{Within cooldown?}
  CD -- yes --> COOL[COOLDOWN]
  CD -- no --> INS[Insert AttendanceEvent\nupdate lastAttendanceAt]
  INS --> FS{Fee state}
  FS -- EXPIRED --> AL[Alert + CallTask EXPIRED_BUT_VISITING\n+ owner WhatsApp]
  FS -- else --> OK[CREATED]
  INS --> AB[Auto-close ABSENT_7_DAYS task]
```

## 8. Deployment pipeline

```mermaid
flowchart LR
  Dev[Push / PR] --> CI[GitHub Actions:\nlint · typecheck · unit · build]
  CI --> E2E[Playwright on PR to main]
  E2E --> Merge[Merge to main]
  Merge --> Img[Build images → GHCR\nweb, worker]
  Img --> Stg[Deploy staging\nmigrate deploy → compose up]
  Stg --> Smoke[Smoke tests + health]
  Smoke --> Approve{Manual approval}
  Approve --> Bk[Pre-deploy DB backup]
  Bk --> Prod[Deploy production]
  Prod --> Mon[Sentry + Uptime Kuma watch 30 min]
```

## 9. Roadmap (Gantt)

```mermaid
gantt
  title Max Fitness Platform — delivery plan (indicative)
  dateFormat  YYYY-MM-DD
  axisFormat  %d %b
  section Week 0 (parallel)
  Client inputs, Meta verification, Razorpay KYC, domain, VPS :p0, 2026-09-14, 7d
  Photo & video shoot, owner interview                         :p0b, 2026-09-16, 5d
  section Build
  Phase 1 Foundation                                           :p1, 2026-09-14, 7d
  Phase 1b Face POC spike                                      :p1b, 2026-09-16, 12d
  Phase 2 Landing page + legal                                 :p2, after p1, 7d
  Phase 3 Signup, selfie, payment                              :p3, after p2, 7d
  Phase 4 CRM core                                             :p4, after p3, 10d
  Client demo on staging                                       :milestone, m1, after p4, 0d
  Phase 5 QR onboarding + import                               :p5, after p4, 5d
  Phase 6 WhatsApp engine                                      :p6, after p5, 7d
  Phase 7 Attendance kiosk                                     :p7, after p6, 12d
  Phase 8 Hardening, UAT, launch                               :p8, after p7, 7d
  section Post-launch
  Member migration drive + shadow mode                         :p9, after p8, 14d
  Hypercare                                                    :p10, after p8, 30d
```
