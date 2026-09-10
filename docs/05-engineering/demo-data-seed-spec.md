# Demo Data & Seed Specification

Goal: the staging app looks like a real, busy Indirapuram gym on **any day** you open it. All dates are generated **relative to the seed run date** (or the fake clock), so tiles are never empty.

Inputs: `assets/demo-data/members_demo.csv` (220 realistic people with scenarios) · Script: `packages/db/seed/index.ts` · Deterministic RNG seed `20260910`.

## 1. Safety
- Mobile numbers in the CSV use the pattern `+91 90000 1xxxx` / `+91 90000 2xxxx` and emails `@example.com` (reserved domain). Treat them as fake but **never** send real WhatsApp to them: seed sets `DEMO_MODE` expectation and the provider refuses non-allowlisted numbers in demo.
- Staff seed: Owner "Demo Owner" mobile `9000000001` PIN `2468`; Reception "Demo Staff" `9000000002` PIN `1357` (staging only; production seed prompts for real values).
- Every demo testimonial and photo is labelled DEMO outside production.

## 2. Gym & config
- Gym: Max Fitness Gym, slug `max-fitness-indirapuram`, address from README, lat/long placeholder (confirm).
- Plans: 8 rows per business-rules BR-2.2.
- Reminder rules: BR-5.1 defaults.
- Settings: hours (placeholder), quiet hours, caps, trust numbers (4.8/231, 4.9/262), promo banner sample, `features.otpRequired=false`, `kioskShadowMode=true`.

## 3. Scenario mapping (column `scenario` in CSV)
Let `T` = today (IST). `M` = plan months from CSV.

| Scenario | Count | Member status | Latest membership | Extras |
|---|---|---|---|---|
| `ACTIVE_HEALTHY` | 120 | ACTIVE | end = T + rand(8..170) | attendance history |
| `DUE_7` | 6 | ACTIVE | end = T+7 | |
| `DUE_3` | 5 | ACTIVE | end = T+3 | |
| `DUE_2` | 4 | ACTIVE | end = T+2 | |
| `DUE_1` | 4 | ACTIVE | end = T+1 | reminders already sent at T-7, T-3, T-2 (MessageLog) |
| `DUE_TODAY` | 4 | ACTIVE | end = T | |
| `EXPIRED_1_3` | 8 | ACTIVE | end = T − rand(1..3) | post-expiry messages logged; 2 have call tasks |
| `EXPIRED_4_7` | 6 | ACTIVE | end = T − rand(4..7) | call tasks EXPIRED_NOT_RENEWED |
| `EXPIRED_BUT_VISITING` | 3 | ACTIVE | end = T − rand(2..6) | attendance today → alert + priority task |
| `EXPIRED_8_40` | 8 | ACTIVE | end = T − rand(8..40) | reminders stopped by cap |
| `LEFT_UNSUBSCRIBED` | 6 | LEFT | ended 5–30 days ago | inbound UNSUB button event, call task UNSUBSCRIBED (some done) |
| `LEFT_OWNER` | 6 | LEFT | ended 30–200 days ago | reasons mix |
| `RENEWED_EARLY` | 6 | ACTIVE | current end = T+2 **and** upcoming membership T+3…; | proves reminders stop |
| `PENDING_VERIFICATION` | 7 | PENDING_VERIFICATION | declared end T−5..T+60 | 3 match imported records |
| `PENDING_PAYMENT` | 5 | PENDING_PAYMENT | pending membership, created 1–3 days ago | call tasks SIGNUP_NOT_PAID |
| `BIRTHDAY_TODAY` | 3 | ACTIVE | end = T + rand(10..90) | dob month/day = T |
| `BIRTHDAY_WEEK` | 4 | ACTIVE | | dob within next 6 days |
| `ABSENT_10` | 6 | ACTIVE | end ≥ T+15 | last attendance T−10..T−20 → task ABSENT_7_DAYS |
| `MINOR_GUARDIAN_PENDING` | 2 | ACTIVE | | age 16–17, faceConsent false |
| `SHARED_NUMBER_PAIR` | 4 (2 pairs) | ACTIVE | one due soon, one healthy | same mobile |
| `PAUSED_REMINDERS` | 3 | ACTIVE | end = T+2 | remindersPausedUntil = T+10 |
Totals ≈ 220; adjust `ACTIVE_HEALTHY` so sum matches CSV rows.

Birthday scenario DOB in CSV stores only the **year**; seed sets month/day relative to T.

## 4. Memberships & payments history
- For ACTIVE/LEFT members, generate a contiguous chain back to `joined_year` (CSV) with plan months from CSV (70% same plan repeated, 30% varied), prices = current prices minus 0–10% (older years cheaper).
- Payments: method mix Cash 45%, UPI direct 35%, Razorpay 15%, Card 5%; receipts sequential by FY.
- Current-month collections should total roughly ₹1.2–1.6 lakh.

## 5. Attendance
- Last 60 days for ACTIVE members with fee state not EXPIRED > 7 days.
- Visit probability per member by persona: regulars 5–6×/week (35%), moderates 3–4× (45%), irregulars 1–2× (20%).
- Time-of-day distribution: 05:30–09:30 (40%), 10:00–16:00 (15%), 17:30–21:30 (45%) with peak 18:30–20:00; Sundays 50% volume, morning only.
- Method: FACE 80% (members with faceConsent), MANUAL 15%, KEYPAD 5%; match scores ~N(0.72, 0.05).
- Today: ~85 check-ins distributed up to the current time of seed run.

## 6. Leads
- 25 leads last 30 days: status mix NEW 5, CONTACTED 6, TRIAL_BOOKED 4, VISITED 3, CONVERTED 4 (linked), LOST 3; sources GBP 40%, website 30%, Instagram 15%, walk-in 15%; goals mix.

## 7. Messages
- MessageLog consistent with scenarios and rules (statuses: 70% READ, 20% DELIVERED, 8% SENT, 2% FAILED).
- 30 receipts, 10 welcomes, 7 verification approvals, 20 owner digests.

## 8. Alerts & tasks
- 6 unread alerts across types; call tasks per scenarios; 10 DONE tasks from past week with outcomes.

## 9. Kiosk
- One `KioskDevice` "Reception phone" ACTIVE, lastSeen 2 minutes ago, heartbeat sample.
- No face templates in seed (vectors are model-specific); simulator kiosk page `/crm/attendance?demo=kiosk` can mark "FACE" attendance for demos.

## 10. Photos
- Use generated neutral avatar placeholders (initials on colour matching gender-neutral palette) — **no stock photos of real people**; production uses real selfies.

## 11. Commands
```
pnpm db:reset         # drop, migrate, seed
pnpm db:seed          # idempotent: wipes demo gym data then recreates
SEED_TODAY=2026-09-10 pnpm db:seed   # reproducible screenshots
```
