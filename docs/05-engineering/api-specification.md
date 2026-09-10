# API Specification (v1)

Base: `https://{domain}/api/v1` · JSON unless noted · All request bodies validated by Zod schemas in `packages/shared/src/schemas` (names given as `Schema:`).

## 1. Conventions

**Success**
```json
{ "data": { ... }, "meta": { "requestId": "req_..." } }
```
**Error**
```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Enter a 10-digit mobile number.", "details": { "field": "mobile" } }, "meta": { "requestId": "req_..." } }
```

| HTTP | code examples |
|---|---|
| 400 | `VALIDATION_FAILED`, `INVALID_STATE` |
| 401 | `UNAUTHENTICATED`, `TOKEN_EXPIRED` |
| 403 | `FORBIDDEN`, `PIN_REQUIRED` |
| 404 | `NOT_FOUND` |
| 409 | `CONFLICT`, `ALREADY_PROCESSED` |
| 422 | `PAYMENT_SIGNATURE_INVALID`, `SELFIE_NO_FACE` |
| 429 | `RATE_LIMITED` (with `Retry-After`) |
| 500 | `INTERNAL` (no internals leaked) |

- Messages are user-safe and localised via `Accept-Language: hi|en`.
- `Idempotency-Key` header supported on POSTs that create money or messages (CRM payments, manual sends).
- Pagination: cursor-based `?cursor=&limit=` (max 100) → `meta.nextCursor`.
- Dates: `YYYY-MM-DD` (IST business dates); timestamps ISO-8601 UTC.
- Money: integer `amountPaise`; display strings never returned by API (except receipts).
- Mobile: request accepts `9871406350`, `+919871406350`, `09871406350`; responses return E.164; CRM responses to staff role `RECEPTION` return masked unless on member detail.

## 2. Auth schemes
| Scheme | Used by | Mechanism |
|---|---|---|
| none | public | rate limited by IP + fingerprint |
| `registrationToken` | sign-up steps | signed token (HMAC, 48 h) in body/header `X-Registration-Token` |
| `linkToken` | renew/receipt/unsubscribe links | signed token in path, member-scoped, expiring |
| `session` | CRM | httpOnly cookie `mfp_session`; CSRF: SameSite=Lax + `Origin` check on mutations |
| `kiosk` | Android kiosk | `Authorization: Bearer <deviceToken>` |
| `signature` | webhooks | HMAC over raw body |

## 3. Public endpoints

### POST `/leads`
Schema: `LeadCreate`
```json
{ "name": "Neha Gupta", "mobile": "9876543210", "goal": "LOSE_WEIGHT", "source": "WEBSITE_HERO",
  "utm": { "source": "google", "medium": "gbp" }, "consentContact": true, "turnstileToken": "..." }
```
→ `201 { data: { leadId } }` · Side effects: dedupe/merge (BR-10.3), owner alert, call task after 2 h. Rate limit 5/h per IP.

### GET `/plans?gender=MALE`
→ `{ data: { monthly: Plan, packages: Plan[], admissionPaise, currency: "INR" } }` where `Plan = { id, code, durationMonths, gender, pricePaise, perMonthPaise, savePaise, isBestValue }`. Cached 5 min, tag `plans`.

### POST `/registrations` (multipart/form-data)
Fields: `fullName`, `mobile`, `email`, `dob` (YYYY-MM-DD), `gender`, `language`, `consents` (JSON: `{ terms: true, privacy: true, whatsappUpdates: true, faceAttendance: false }`), `noticeVersion`, `selfie` (image/jpeg ≤ 2 MB), `source` (`WEBSITE|QR_NEW`), `otpToken?`.
Server: magic-byte check, face presence re-check (optional server-side), resize 720px, strip EXIF, store; create Member `PENDING_PAYMENT`, Consent rows, MediaFile.
→ `201 { data: { memberId, registrationToken, isMinor, possibleDuplicate: boolean } }`
Errors: `SELFIE_NO_FACE` (422), `VALIDATION_FAILED`, `AGE_BELOW_MINIMUM`.

### POST `/checkout/orders`
Auth: `registrationToken` **or** `linkToken` (renew)
```json
{ "planId": "pln_...", "startDate": "2026-09-11", "payAtReception": false }
```
→ online: `{ data: { paymentId, provider: "razorpay", orderId, keyId, amountPaise, currency: "INR", prefill: { name, contact, email }, membership: { startDate, endDate } } }`
→ pay at reception: `{ data: { paymentId: null, reservedUntil, membership: {...} } }`
In `DEMO_MODE`: `{ provider: "simulated", simulateUrl }`.

### POST `/checkout/verify`
```json
{ "razorpay_order_id": "order_...", "razorpay_payment_id": "pay_...", "razorpay_signature": "..." }
```
Server: `HMAC_SHA256(order_id + "|" + payment_id, key_secret) == signature` → `confirmPayment()` (idempotent).
→ `{ data: { status: "PAID" | "PENDING", memberCode, receiptNo, membership: { startDate, endDate }, receiptUrl } }`

### GET `/checkout/status?paymentId=`
Polling fallback (every 2 s up to 60 s) → `{ data: { status } }`.

### POST `/otp/send` · POST `/otp/verify`
`{ mobile, purpose }` → `{ data: { expiresInSec: 600 } }` · `{ mobile, purpose, code }` → `{ data: { otpToken } }` (15 min). Limits: 3 sends/15 min per mobile, 10/h per IP, 5 verify attempts.

### POST `/qr/lookup`
Auth: `otpToken` (when OTP enabled) · `{ "mobile": "9876543210" }` → `{ data: { candidates: [ { memberId, firstName, lastInitial, planMonths, monthEndMasked: "28 Sep" } ] } }` — imported/active members on that number (families may have several). Returns an empty list without OTP when `otpRequired=true` and no token.

### POST `/qr/existing` (multipart)
Fields: registration fields + `declaredPlanMonths` (1|3|6|12|null), `declaredEndDate` (required), `declaredAmountPaise?`, `otpToken?`.
Validation: `declaredEndDate` between today − 60 days and today + 13 months.
→ `201 { data: { referenceCode: "Q-4821", status: "PENDING_VERIFICATION", matchedExisting: boolean } }`

### POST `/qr/new`
Same as `/registrations` with `source=QR_NEW` (kept separate for analytics and rate-limit policy).

### GET `/renew/{linkToken}`
→ `{ data: { member: { firstName, gender, photoUrl }, currentEndDate, plans: [...], proposedStartDate } }` · `TOKEN_EXPIRED` 401.

### GET `/files/{mediaId}?sig=&exp=`
Signed, expiring (≤ 5 min) URLs for private images; `Cache-Control: private, max-age=60`.

### GET `/health`
`{ data: { ok: true, db: "ok", worker: { ok: true, lastBeatAt, ageSeconds }, version } }` (no secrets, no counts).

`worker.ok` is false when the newest `WorkerHeartbeat.lastBeatAt` is older than 3 minutes; top-level `ok` is false if either `db` or `worker` is down. See ADR-018.

## 4. Webhooks

### POST `/webhooks/razorpay`
- Read **raw body**; verify `X-Razorpay-Signature` = HMAC-SHA256(rawBody, `RAZORPAY_WEBHOOK_SECRET`).
- Insert `WebhookEvent(provider="razorpay", externalId=event id header or payload id)`; duplicate → 200 immediately.
- Handle `payment.captured`, `order.paid` → `confirmPayment()`; `payment.failed` → mark failed.
- Always respond 200 quickly after persisting; process in worker if heavy.

### GET `/webhooks/whatsapp`
Meta verification: if `hub.mode=subscribe` and `hub.verify_token == WHATSAPP_VERIFY_TOKEN` → return `hub.challenge` as text.

### POST `/webhooks/whatsapp`
- Verify `X-Hub-Signature-256: sha256=<hex>` = HMAC-SHA256(rawBody, `WHATSAPP_APP_SECRET`); reject otherwise.
- Persist `WebhookEvent` per entry change; enqueue `whatsapp.inbound`.
- Handled payloads:
  - `statuses[]` → update `MessageLog` by `providerMessageId` (`sent|delivered|read|failed` + error code).
  - `messages[].type == "button"` (template quick reply) → `button.payload` e.g. `UNSUB.<token>` / `RESTART.<token>`.
  - `messages[].type == "interactive"` → `interactive.button_reply.id` / `list_reply.id`.
  - `messages[].type == "text"` → keyword match (STOP/UNSUBSCRIBE/बंद/band/RESTART) else owner inbox alert.
  - Account/template updates (quality rating, template status) → Alert `WHATSAPP_QUALITY`.

## 5. CRM endpoints (session)
Server Components read via services directly; these JSON endpoints serve client components and the PWA.

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/crm/auth/login` | — | `{ mobile, pin, trustDevice }` → sets cookie; lockout per BR |
| POST | `/crm/auth/logout` | any | revoke session |
| POST | `/crm/auth/pin-check` | any | re-auth for sensitive action → short-lived elevation (5 min) |
| GET | `/crm/dashboard` | any | tiles, calls (top 5), birthdays, verify count, money (owner only), alerts count |
| GET | `/crm/members?q=&state=&status=&cursor=` | any | list rows `{ id, name, photoUrl, memberCode, feeState, daysLeft, planMonths }` |
| POST | `/crm/members` | owner, reception | desk add (multipart photo) + optional plan & payment in one call |
| GET | `/crm/members/{id}` | any | profile incl. memberships, payments, attendance month, messages (last 20), consents |
| PATCH | `/crm/members/{id}` | owner, reception | edit details |
| POST | `/crm/members/{id}/renew` | owner, reception | `{ planId, method, amountPaise?, discountPaise?, discountReason?, startDate? }` → membership + payment + receipt |
| POST | `/crm/members/{id}/left` | owner, reception | `{ reason, note? }` |
| POST | `/crm/members/{id}/reactivate` | owner | |
| POST | `/crm/members/{id}/pause-reminders` | owner, reception | `{ until: "YYYY-MM-DD" }` |
| POST | `/crm/members/{id}/guardian-consent` | owner, reception | `{ guardianName, relation }` |
| POST | `/crm/members/{id}/enroll-face` | owner, reception | creates enrolment job / flags for kiosk assisted enrolment |
| DELETE | `/crm/members/{id}` | owner + PIN | privacy erasure workflow |
| GET | `/crm/members/{id}/export` | owner + PIN | data export JSON (DPDP request) |
| GET | `/crm/fees?tab=due_week|overdue|collected_today|pending_payment` | any | lists + totals (totals owner only) |
| POST | `/crm/payments/{id}/void` | owner + PIN | `{ reason }` |
| GET | `/crm/calls?status=OPEN` | any | ordered by priority, dueDate |
| POST | `/crm/calls/{id}/outcome` | any | `{ outcome, note?, callLaterAt? }` |
| GET | `/crm/verifications?status=PENDING` | any | with matched import record |
| POST | `/crm/verifications/{id}/approve` | owner, reception | `{ approvedEndDate?, planMonths? }` |
| POST | `/crm/verifications/{id}/reject` | owner, reception | `{ reason }` |
| GET/POST/PATCH | `/crm/leads` | any | pipeline |
| GET | `/crm/attendance?date=` | any | today's list |
| POST | `/crm/attendance` | any | manual mark `{ memberId }` (Idempotency-Key) |
| DELETE | `/crm/attendance/{id}` | owner, reception | void within undo window or by owner |
| GET | `/crm/attendance/absent?days=7` | any | |
| GET | `/crm/messages?memberId=` | any | log |
| POST | `/crm/messages/birthday` | owner, reception | `{ memberIds[] }` |
| GET | `/crm/simulator/timeline` | owner (DEMO only) | projected messages next 30 days |
| POST | `/crm/simulator/advance` | owner (DEMO + non-prod only) | `{ days }` fake-clock advance & run slots |
| GET | `/crm/alerts` · POST `/crm/alerts/read` | any | |
| GET | `/crm/reports/monthly?month=2026-09` | owner | aggregates |
| GET/PATCH | `/crm/settings` | owner + PIN for PATCH | validated settings JSON |
| GET/PATCH | `/crm/settings/plans` | owner + PIN | price edits (revalidates landing) |
| GET/PATCH | `/crm/settings/reminder-rules` | owner + PIN | |
| GET/POST/PATCH | `/crm/staff` | owner + PIN | add staff, reset PIN, deactivate |
| POST | `/crm/kiosks/pairing-code` | owner | → `{ code: "482913", expiresAt }` |
| POST | `/crm/kiosks/{id}/revoke` | owner + PIN | |
| POST | `/crm/import/preview` (multipart CSV) | owner | → rows with errors |
| POST | `/crm/import/commit` | owner + PIN | `{ importId }` |
| GET | `/crm/export/members.csv` | owner + PIN | audit logged |

Permission matrix lives in `apps/web/src/lib/permissions.ts` and `crm-module-spec.md` §3.

## 6. Response examples

### GET `/crm/dashboard`
```json
{
  "data": {
    "today": "2026-09-10",
    "tiles": { "activeMembers": 214, "cameToday": 87, "dueThisWeek": { "count": 18, "expectedPaise": 2430000 }, "overdue": 11 },
    "calls": [
      { "id": "ct_1", "reason": "EXPIRED_BUT_VISITING", "member": { "id": "mem_1", "name": "Sanjay Tomar", "photoUrl": "/api/v1/files/...", "mobile": "+9198xxxxxx21", "feeState": "EXPIRED", "daysLeft": -6 } }
    ],
    "callsTotal": 5,
    "birthdays": [ { "id": "mem_7", "name": "Amit Tyagi", "photoUrl": "..." } ],
    "verifyPending": 3,
    "money": { "thisMonthPaise": 14250000, "lastMonthPaise": 13100000 },
    "alertsUnread": 3,
    "kiosk": { "online": true, "lastSeenAt": "2026-09-10T04:58:00Z" }
  }
}
```

## 7. Kiosk endpoints (Bearer device token)

### POST `/kiosk/pair` (no bearer)
`{ "code": "482913", "deviceName": "Reception phone", "appVersion": "1.0.0", "modelVersion": "fe-v1" }` → `{ data: { deviceId, deviceToken, gymName, settings: { cooldownMinutes, shadowMode, confirmBand, acceptThreshold, voice, language } } }` (token shown once; stored in Android Keystore-backed encrypted prefs).

### GET `/kiosk/sync?cursor=`
→
```json
{
  "data": {
    "serverTime": "2026-09-10T05:00:00Z",
    "members": [ { "id": "mem_1", "displayName": "संजय जी", "firstName": "Sanjay", "photoThumbUrl": "...signed...", "feeState": "EXPIRED", "daysLeft": -6, "eligible": true } ],
    "templates": [ { "id": "ft_1", "memberId": "mem_1", "modelVersion": "fe-v1", "dimensions": 512, "vector": "base64-float32" } ],
    "removedMemberIds": ["mem_9"],
    "removedTemplateIds": ["ft_3"],
    "settings": { "cooldownMinutes": 180, "shadowMode": true },
    "nextCursor": "c_..."
  }
}
```
Vectors are sent decrypted over TLS only to paired devices and stored encrypted on device. `eligible=false` members (no consent, minor without guardian consent, not ACTIVE) never receive templates.

### POST `/kiosk/attendance`
```json
{ "events": [ { "clientEventId": "uuid", "memberId": "mem_1", "method": "FACE", "capturedAtDevice": "2026-09-10T13:02:11Z", "deviceClockOffsetMs": -1200, "matchScore": 0.71, "livenessScore": 0.93, "modelVersion": "fe-v1", "confirmedByStaff": false } ] }
```
→ `{ data: { results: [ { clientEventId, status: "CREATED" | "DUPLICATE" | "COOLDOWN" | "INELIGIBLE" } ] } }` (max 200 per batch)

### GET `/kiosk/enrollment-jobs?limit=10`
→ `{ data: { jobs: [ { id, memberId, imageUrl (signed, 5 min) } ] } }` → claims jobs (`IN_PROGRESS`, claimedBy).

### POST `/kiosk/templates`
`{ "jobId?": "ej_1", "memberId": "mem_1", "sourceKind": "signup_selfie|assisted|adaptive", "modelVersion": "fe-v1", "dimensions": 512, "vector": "base64", "qualityScore": 0.82 }` → `{ data: { templateId } }` · Server caps templates per member (e.g., 8, evicting oldest adaptive).

### POST `/kiosk/lookup`
Keypad fallback: `{ "mobileLast10": "9876543210" }` → `{ data: { candidates: [ { memberId, displayName, photoThumbUrl } ] } }` (max 4; family numbers). Rate limited per device.

### POST `/kiosk/heartbeat`
`{ "battery": 100, "charging": true, "temperatureC": 36.5, "queueSize": 0, "cameraOk": true, "freeStorageMb": 12000, "appVersion": "1.0.0", "fps": 12 }` → `{ data: { serverTime, commands: [ "SYNC_NOW" | "RELOAD_SETTINGS" | "WIPE_AND_UNPAIR" ] } }`

## 8. Rate limits (defaults)
| Endpoint group | Limit |
|---|---|
| `/leads`, `/registrations`, `/qr/*` | 10/h per IP, 3/h per mobile |
| `/otp/send` | 3/15 min per mobile |
| `/crm/auth/login` | 10/15 min per IP; lockout 5 failed PINs per user |
| `/kiosk/*` | 120/min per device |
| Webhooks | not limited (signature required) |

Implementation (1.0): in-memory token buckets in the single web instance (keys hashed), plus Caddy-level request limits. If the web tier ever runs more than one instance, move buckets to Postgres or Redis.
