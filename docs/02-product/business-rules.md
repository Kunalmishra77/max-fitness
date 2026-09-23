# Business Rules (authoritative)

All rules here are implemented in `packages/core` as pure functions with unit tests. Values marked ⚙ are **settings** stored in `Gym.settings` and editable by the owner. Defaults shown.

---

## BR-1 Time & calendar
- BR-1.1 Business timezone is **Asia/Kolkata (IST, UTC+5:30, no DST)**.
- BR-1.2 Business dates (`startDate`, `endDate`, `dob`, attendance "day") are calendar dates in IST, stored as SQL `DATE`.
- BR-1.3 "Today" = current IST date from the injected clock.
- BR-1.4 Indian financial year runs 1 April – 31 March; label `2026-27`.

## BR-2 Plans & pricing
- BR-2.1 A plan = `durationMonths ∈ {1,3,6,12}` × `gender ∈ {MALE, FEMALE}` with `pricePaise`.
- BR-2.2 Default prices ⚙:

| Plan | Male | Female | Status |
|---|---|---|---|
| Monthly (1M) | ₹1,500 | ₹1,200 | Confirmed by client |
| 3 months | ₹4,000 | ₹3,200 | **Placeholder** |
| 6 months | ₹7,500 | ₹6,000 | **Placeholder** |
| 12 months | ₹13,500 | ₹10,800 | **Placeholder** |

- BR-2.3 "Effective per month" shown on cards = `floor(pricePaise / durationMonths)` rounded to nearest ₹10 for display.
- BR-2.4 "You save" = `(monthlyPrice × months) − planPrice`, shown only when > 0.
- BR-2.5 Gender `OTHER` ⚙ `otherGenderPricing = "ASK_AT_DESK"` → online flow shows Male prices with note "Final price confirmed at reception".
- BR-2.6 Admission fee ⚙ default ₹0. If > 0, added as a separate line on first membership only.
- BR-2.7 Discounts are desk-only (owner/reception with permission), recorded as `discountPaise` with reason. Online price is never discounted client-side.
- BR-2.8 Price at purchase is **copied** onto the Membership (`pricePaise`); later price changes never alter past memberships.

## BR-3 Membership dates
- BR-3.1 `endDate = addMonths(startDate, durationMonths) − 1 day`, where `addMonths` clamps to month end.
  - 10 Sep 2026 + 1M → 9 Oct 2026
  - 31 Jan 2027 + 1M → 28 Feb 2027 − 1 day = 27 Feb 2027
  - 29 Feb 2028 + 12M → 28 Feb 2029 − 1 = 27 Feb 2029
- BR-3.2 Membership is valid **through** `endDate` inclusive.
- BR-3.3 Online sign-up start date defaults to today; user may pick up to ⚙ 15 days ahead.
- BR-3.4 **Renewal start** ⚙ `renewalGraceDays = 5`:
  - If renewing while current membership active or within `renewalGraceDays` after `endDate` → `startDate = previous endDate + 1`.
  - Else → `startDate = payment date`.
- BR-3.5 Only one membership may cover any given date per member (no overlap). A renewal bought early becomes an *upcoming* membership.
- BR-3.6 Existing-customer import/QR: if only `monthEndDate` is known, create membership with `endDate = monthEndDate`, `startDate = endDate − months + 1 day` if plan known, else `startDate = null`, `source = QR_EXISTING`, `pricePaise = declared amount or 0`.

## BR-4 Member status & fee state
- BR-4.1 Stored lifecycle `Member.status`:

| Status | Meaning | Gets reminders? | In kiosk gallery? |
|---|---|---|---|
| `PENDING_PAYMENT` | Registered, not paid | No (gets 1 "complete payment" nudge ⚙ off by default) | No |
| `PENDING_VERIFICATION` | QR existing-customer submission awaiting owner | No | No |
| `ACTIVE` | A member of the gym (paid now or lapsed but not left) | Yes, per fee state | Yes if face consent |
| `LEFT` | Left the gym (unsubscribe, owner action, or long lapse) | Never | No |
| `BLOCKED` | Banned by owner | Never | No |

- BR-4.2 Derived **fee state** (computed, never stored) from the membership covering today or the latest ended one:

| Fee state | Rule | Colour |
|---|---|---|
| `PAID` | daysLeft > 7 | Green |
| `DUE_SOON` | 0 ≤ daysLeft ≤ 7 | Amber |
| `EXPIRED` | today > endDate | Red |
| `NONE` | no confirmed membership | Grey |

  `daysLeft = endDate − today` (0 means ends today). If an upcoming membership starts the day after, use its end date.
- BR-4.3 ⚙ `autoLeftAfterDays = 60`: an `ACTIVE` member `EXPIRED` for 60 days with no payment becomes `LEFT` (reason `LAPSED`) by the nightly job, after a call task was created at least once.
- BR-4.4 A `LEFT` member who pays again returns to `ACTIVE`; unsubscribe flag is cleared **only** if they re-consent to WhatsApp updates during that payment.

## BR-5 Reminder rules (WhatsApp)
- BR-5.1 Default rules ⚙ (table `ReminderRule`):

| Code | Day relative to endDate | Slots (IST) | Template |
|---|---|---|---|
| `PRE_7` | −7 | 10:00 | `mf_renewal_due` |
| `PRE_3` | −3 | 10:00 | `mf_renewal_due` |
| `PRE_2` | −2 | 10:00 | `mf_renewal_due` |
| `PRE_1` | −1 | 10:00 | `mf_renewal_due` |
| `DUE_TODAY` | 0 | 10:00 | `mf_renewal_due_today` |
| `POST` | +1 … +`postExpiryMaxDays` | 19:00 | `mf_membership_expired` |

- BR-5.2 ⚙ `postExpiryMaxDays = 7` (range 1–60 or `null` = no limit, which shows a warning).
- BR-5.3 Eligibility, checked **at send time**:
  1. `member.status = ACTIVE`
  2. `member.whatsappOptIn = true` and `member.remindersUnsubscribedAt IS NULL`
  3. `member.remindersPausedUntil IS NULL OR < today`
  4. Target membership is still the member's latest confirmed membership (no newer/upcoming membership exists) → renewal stops reminders.
  5. Current IST time within quiet-hours window ⚙ 08:00–21:00.
  6. No `MessageLog` row with the same idempotency key.
- BR-5.4 Idempotency key: `rem:{memberId}:{membershipId}:{ruleCode}:{yyyy-mm-dd}:{slot}`.
- BR-5.5 If the engine was down during a slot, catch-up runs on restart for **the same day only**; missed days are not back-filled.
- BR-5.6 One WhatsApp number shared by several members → each member gets their own reminder, personalised by name.
- BR-5.7 After `postExpiryMaxDays`, automatic reminders stop and a call task `EXPIRED_NOT_RENEWED` is created (if not already open).

## BR-6 Unsubscribe
- BR-6.1 Triggered by: Unsubscribe quick-reply button (payload carries signed `memberId`), or text reply `STOP | UNSUBSCRIBE | बंद | band` (then confirmation buttons for each member on that number).
- BR-6.2 Effects (single transaction): `remindersUnsubscribedAt = now`, `status = LEFT`, `leftReason = WHATSAPP_UNSUBSCRIBE`, `leftAt = today`; cancel queued reminder jobs; create call task `UNSUBSCRIBED` (low priority, "ask why"); owner alert; audit log.
- BR-6.3 Confirmation message (free-form within service window): "You have been unsubscribed. You won't get membership reminders. Tap Restart if this was a mistake." Button: Restart reminders.
- BR-6.4 Restart within 7 days reverses BR-6.2 (status back to `ACTIVE`, unsubscribed cleared) and logs it. After 7 days only the owner can reactivate.
- BR-6.5 Transactional messages the member explicitly triggers later (e.g., a payment receipt after re-joining) are still sent.
- BR-6.6 Face templates of `LEFT` members are deleted after ⚙ `faceDeleteAfterLeftDays = 30` (grace for mistakes).

## BR-7 Call tasks (the "Calls to make" list)
Generated nightly at 06:00 IST and on events. At most one **open** task per (member, reason).

| Reason | Created when | Priority |
|---|---|---|
| `EXPIRED_BUT_VISITING` | Kiosk/manual check-in while fee state `EXPIRED` | 1 (highest) |
| `SIGNUP_NOT_PAID` | `PENDING_PAYMENT` for > 24 h | 2 |
| `NEW_LEAD` | Lead created, not contacted in 2 h (gym hours) | 2 |
| `EXPIRED_NOT_RENEWED` | Day +3 after expiry, and again when reminder cap reached | 3 |
| `DUE_SOON_NO_RESPONSE` | Day −1 and no renewal and reminders delivered | 4 |
| `ABSENT_7_DAYS` | `ACTIVE` + `PAID` and no attendance for ⚙ 7 days (only once per absence streak) | 5 |
| `UNSUBSCRIBED` | BR-6 | 6 |
| `VERIFICATION_PENDING` | QR existing submission older than 2 h | 2 |

- Outcomes: `WILL_RENEW` (snooze 2 days), `CALL_LATER` (pick: later today / tomorrow), `NO_ANSWER` (auto-retry next day, max 3), `LEFT_GYM` (→ BR-4 LEFT), `WRONG_NUMBER`, `DONE`.
- Tasks auto-close when the underlying condition clears (e.g., member renewed).

## BR-8 Birthdays
- BR-8.1 Birthday today when `month(dob)=month(today) AND day(dob)=day(today)`; members born 29 Feb celebrate 28 Feb in non-leap years.
- BR-8.2 Only `ACTIVE` members appear. ⚙ `autoBirthdayWish = false` (owner taps Send).

## BR-9 Attendance
- BR-9.1 One attendance event per member per ⚙ `checkInCooldownMinutes = 180`.
- BR-9.2 Attendance "day" = IST date of `capturedAt` (device time corrected by server offset at sync).
- BR-9.3 Kiosk shows: fee state `PAID` → green welcome; `DUE_SOON` → welcome + "{n} days left"; `EXPIRED` → "Please meet reception" + alert BR-7 `EXPIRED_BUT_VISITING`.
- BR-9.4 Manual attendance by staff is always allowed and marked `method = MANUAL` with `recordedBy`.
- BR-9.5 Members with no face consent, under 18 without guardian consent, or not `ACTIVE` are excluded from the kiosk gallery.

## BR-10 Leads
- BR-10.1 Lead statuses: `NEW → CONTACTED → TRIAL_BOOKED → VISITED → CONVERTED | LOST`.
- BR-10.2 A lead converts automatically when a member registers with the same mobile within 60 days.
- BR-10.3 Duplicate leads (same mobile within 7 days) merge; the newest source is appended.

## BR-11 Payments & receipts
- BR-11.1 Membership becomes `CONFIRMED` only when a `Payment` with `status = PAID` covers its full amount (partial payments ⚙ disabled in 1.0).
- BR-11.2 Receipt numbers are sequential per financial year: `MF/{FY}/{6-digit}` from a locked counter row.
- BR-11.3 Online amount is recomputed server-side from plan + settings at order creation; client values ignored.
- BR-11.4 Deleting a desk payment requires Owner PIN + reason; it voids (never hard-deletes) and reverts the membership to `PENDING_PAYMENT`.

## BR-12 Age & consent
- BR-12.1 Age = full years on today's IST date.
- BR-12.2 Minimum age ⚙ 16. Under 18: `isMinor = true`, face attendance disabled until `PARENTAL` consent recorded by staff.
- BR-12.3 Consent versions are recorded; when the privacy notice version changes, existing members are asked to re-accept at next kiosk visit or renewal.

## BR-13 Verification (QR existing customers)
- BR-13.1 Approve → member `ACTIVE`, membership created per BR-3.6, reminders enabled from the next slot, kiosk enrolment job created.
- BR-13.2 Edit date → same as approve with corrected `endDate`; original declared date retained for audit.
- BR-13.3 Reject → member deleted after 7 days unless re-submitted; reason stored.
- BR-13.4 If a submission's mobile matches an imported `ACTIVE` member, show both side-by-side and offer "Merge".
