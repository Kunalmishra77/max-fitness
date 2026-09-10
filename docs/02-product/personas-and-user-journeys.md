# Personas & User Journeys

## 1. Personas

### P1 — The Owner ("Gym Malik")
- Former National Champion; runs the gym since 2000; on the floor most of the day.
- Schooling to 5th standard. Reads Hindi slowly, recognises numbers, faces, colours and icons instantly. Uses WhatsApp, YouTube and phone calls fluently.
- Goals: fees collected on time, members keep coming, know who to call, look professional.
- Frustrations: registers, remembering dates, awkward fee conversations, "apps with too many options".
- Design implication: **one screen tells him what to do today**; photos over names; colour over words; voice button; WhatsApp digest so value arrives even if he never opens the CRM.

### P2 — Reception staff
- 20–30 yrs, comfortable with smartphones, handles walk-ins, fees, kiosk issues, QR help.
- Goals: add a member fast, take cash, answer "till when is my fee paid?".
- Design implication: fast search, add-member ≤ 90 s, no destructive actions without owner.

### P3 — Rohit, working professional (27), Shakti Khand
- Finds "gym near me" on Maps after 8 pm; compares prices on his phone; hates calling.
- Needs: prices visible, evening hours, photos of equipment, sign up online, pay by UPI.

### P4 — Neha, homemaker & part-time tutor (36), Nyay Khand
- Wants a safe, respectful environment; prefers afternoon; price-conscious; nervous about "hardcore" gyms.
- Needs: women's price clearly shown, reassurance (trainers, environment), WhatsApp enquiry rather than a form.

### P5 — Aman, college student (19)
- Beginner, Instagram-driven, wants guidance and a cheap monthly start.
- Needs: "new to gym?" reassurance, monthly plan, free trial.

### P6 — Existing member, Sanjay (42)
- Member for 4 years; pays cash monthly; doesn't want to "download apps".
- Needs: scan QR once, walk in, get a polite reminder, renew in one tap or at the desk.

## 2. Journey maps

### J1 — Prospect: Maps search → paid member (online)
| Step | Touchpoint | User action | System | Emotion / risk | Design response |
|---|---|---|---|---|---|
| 1 | Google Maps | Taps "Website" on GBP | Landing loads (poster first) | Impatient | LCP ≤ 2.5 s |
| 2 | Hero | Watches 1 slide, sees ₹ prices link | — | "Is it for me?" | Trust strip + beginner slide |
| 3 | Plans | Toggles Female, sees ₹1,200 | Prices from DB | Price check | Clear per-month and savings |
| 4 | Sign up | Taps "Choose 3 months" | Opens modal, plan preselected | Commitment anxiety | Short form, progress "Step 1 of 3" |
| 5 | Selfie | Taps selfie tile | Explainer → permission → preview | Privacy worry | "Used as your member photo" + optional face-attendance toggle |
| 6 | Submit | — | Member `PENDING_PAYMENT`, token | — | Instant move to plan screen |
| 7 | Plan | Confirms 3M, start tomorrow | End date computed | — | Summary card |
| 8 | Pay | UPI in Razorpay | Order → capture → webhook | Payment fear | Razorpay trusted UI, amount repeated |
| 9 | Confirmation | Sees tick, receipt | WhatsApp receipt + welcome | Relief | "What to bring on day 1", directions |
| 10 | First visit | Walks to reception | Staff confirms, kiosk enrols better face templates | Feels expected | Name greeting next time |

### J2 — Prospect: lead form → walk-in
Lead form (3 fields) → owner WhatsApp alert "New enquiry: Neha, 98xxxx, goal: weight loss" → call task `NEW_LEAD` → staff calls, books trial → Lead `TRIAL_BOOKED` → visit → joins at desk (CRM Add member) → lead auto-converts.

### J3 — Existing member migration via QR
| Step | Action | System |
|---|---|---|
| 1 | Staff points to standee: "Please scan once" | `/qr?src=reception` |
| 2 | Chooses **Existing customer** | |
| 3 | Enters mobile (OTP) | If imported record found → prefilled |
| 4 | Confirms details, takes selfie | |
| 5 | Answers **"What is your month-end date?"** | Required field with calendar |
| 6 | Submits | `VerificationRequest PENDING`; owner/staff alert |
| 7 | Staff opens Verify, compares with register, taps **सही है (Approve)** | Membership created, reminders enabled, kiosk enrol job |
| 8 | Member walks to kiosk once for enrolment frames | Face templates improved |

### J4 — Renewal via WhatsApp
Day −7 reminder → member ignores → Day −3, −2, −1 reminders → Day −1 member taps **Renew now** → `/renew/[token]` shows plan choices with their gender prices → pays UPI → webhook → new membership (starts old end + 1) → receipt → **no further reminders** (next slot evaluation finds a newer membership).

### J5 — Non-renewal → unsubscribe
Day +1: 3 reminders (09:30, 14:00, 19:00) → Day +2 … → member taps **Unsubscribe** → confirmation with Restart → status `LEFT`, reminders stop permanently → owner sees "Sanjay left (unsubscribed)" + optional call "ask why".

### J6 — Non-renewal → cap → owner call
Day +3: call task `EXPIRED_NOT_RENEWED` → owner calls from Home → outcome "Will renew" (snooze 2 days) → Day +7 reminders stop (cap) → member pays cash at desk on Day +9 → renewal rule: gap > 5 days → new membership starts on payment date.

### J7 — Daily attendance
Member enters → looks at phone on stand → green screen "नमस्ते संजय जी ✓ 23 दिन बाकी" + voice → event queued → synced → CRM "Came today" +1.
Expired member → amber screen "कृपया रिसेप्शन पर मिलें" → owner alert on phone "Sanjay (fees due 6 days) just came in" → owner talks at desk → records cash.

### J8 — Owner's morning
08:30 WhatsApp digest: "आज: 4 फीस आज खत्म, 6 फीस बाकी, 2 जन्मदिन, 5 कॉल. कल ₹9,000 आया." → opens Max Register from home-screen icon → Home shows the same tiles → taps "आज के कॉल" → calls with one tap → taps outcome icons → done in 10 minutes.

### J9 — Staff adds a walk-in member at desk
CRM → big **+ मेंबर** button → take photo → name, mobile, gender icons, DOB → plan tile → payment method icon (Cash) → confirm amount → receipt sent on WhatsApp → member stands in front of kiosk for enrolment (if face consent).

## 3. Emotional principles
- Never shame a member publicly about fees (kiosk and messages stay neutral).
- Make leaving easy and respectful — it protects the WhatsApp number and the brand.
- Every automated message should read like the gym's front desk, not a bank.
