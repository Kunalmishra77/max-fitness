# PRD — Max Fitness Platform v1.0

| Field | Value |
|---|---|
| Product | Max Fitness Platform (Website, Max Register CRM, QR onboarding, Reminder engine, Max Haazri kiosk) |
| Client | Max Fitness Gym, Nyay Khand 1, Indirapuram, Ghaziabad |
| Version | 1.0 (blueprint) |
| Related | `business-rules.md`, `personas-and-user-journeys.md`, `../05-engineering/TRD.md` |

Priority: **M** = Must (launch blocker), **S** = Should (launch target), **C** = Could (post-launch).

---

## 1. Problem statement
Max Fitness Gym has 26 years of reputation and strong reviews but no website, no digital member records, no systematic renewal follow-up, and an owner who needs tools that work without reading-heavy screens. Enquiries from Google Maps are lost, renewals leak, and the owner cannot see at a glance who to call, who is absent, or what money is due.

## 2. Goals
1. Convert local search traffic into leads and paid sign-ups.
2. Increase renewal rate through timely, respectful WhatsApp reminders and a daily call list.
3. Give the owner a visual daily command centre usable with minimal literacy.
4. Automate attendance with zero effort from members.
5. Migrate existing members into verified digital records within 30 days of launch.

## 3. Non-goals (1.0)
Member app/portal, workout/diet plans, class booking, turnstile integration, marketing broadcasts, multi-branch UI, GST invoicing (unless confirmed).

## 4. Personas (detail in `personas-and-user-journeys.md`)
- **Owner ("Gym Malik")** — former national champion, 5th-standard schooling, phone-first, Hindi-first, time-poor.
- **Reception staff** — records fees and walk-ins, handles the kiosk and QR drive.
- **Prospect: working professional (24–38)** — finds gym on Maps, compares price, wants evening slot.
- **Prospect: woman (28–45)** — safety, comfort, female-friendly environment, price-sensitive.
- **Prospect: beginner/student (17–23)** — nervous about "hardcore" gyms, wants guidance.
- **Existing member** — scans QR once, then just walks in; gets reminders.

---

## 5. Functional requirements

### 5.1 Website — Landing page (LP)

| ID | Requirement | P | Acceptance criteria |
|---|---|---|---|
| LP-01 | Sticky navigation: logo, section links (About, Facilities, Plans, Champion story, Reviews, Contact), call icon, **Sign up** button | M | Visible on scroll; on mobile collapses to menu + Sign up; Sign up opens registration modal |
| LP-02 | Optional announcement bar above nav, driven by CRM promo settings | S | Hidden when no active promo; dismiss persists for session |
| LP-03 | Hero: video slider (3 slides), each with headline, sub-headline and CTAs (Sign up, Book free trial / WhatsApp) | M | Autoplay muted inline; pauses on hover/focus; progress indicators; poster image loads first; reduced-motion and Save-Data show static images |
| LP-04 | Hero lead form on right (desktop) / below hero text (mobile): Name, Mobile, Goal | M | Validates Indian mobile; creates Lead; owner gets WhatsApp alert within 1 min; success state shown inline |
| LP-05 | Trust strip: Google rating & count, Justdial rating, "Since 2000", "Led by a National Champion", today's hours | M | Numbers editable in settings; "years" computed from 2000 |
| LP-06 | About section (premium) | M | Real photos; copy from copy deck |
| LP-07 | Facilities section grouped by zones | M | Only confirmed facilities displayed (flag in content) |
| LP-08 | "How to start" 4-step section | S | Steps: Visit/Call → Free trial → Pick plan → Start |
| LP-09 | Membership section: gender toggle, Monthly + 3/6/12 month cards with effective per-month price, recommended badge on 12M, CTA per card | M | Prices from DB; CTA opens signup with plan pre-selected |
| LP-10 | Owner (Champion) story section | M | Timeline of verified facts, photos, quote, CTA |
| LP-11 | Mid-page promo banner | S | Driven by promo settings |
| LP-12 | Testimonials from real Google reviews | M | First name + initial, star rating, "Read on Google" link; demo content visibly labelled DEMO in non-production |
| LP-13 | Gallery (lightbox) | S | Lazy-loaded, AVIF/WebP |
| LP-14 | Transformations (before/after) | C | Only with written consent |
| LP-15 | Trainers | C | If team confirmed |
| LP-16 | BMI calculator lead magnet | C | Result + "Get a plan" lead CTA |
| LP-17 | FAQ accordion | M | FAQPage structured data |
| LP-18 | Final CTA band with second **Sign up** button | M | Opens same modal |
| LP-19 | Contact: address, landmark, map embed (click-to-load), hours, phone, WhatsApp, directions | M | Tap to call/WhatsApp on mobile |
| LP-20 | Footer: NAP, quick links, legal links, social | M | Privacy, Terms, Refund, Contact pages exist |
| LP-21 | Mobile sticky bottom bar: Call · WhatsApp · Sign up | M | Visible < 768px after scrolling past hero |
| LP-22 | Language toggle EN/HI | S | Persists in cookie |
| LP-23 | SEO: metadata, OG image, JSON-LD ExerciseGym, sitemap, robots | M | Lighthouse SEO ≥ 95 |
| LP-24 | Performance | M | Mobile LCP ≤ 2.5 s on 4G, CLS ≤ 0.1, INP ≤ 200 ms |
| LP-25 | Cookie/analytics consent banner | S | Analytics fire only after consent |

### 5.2 Sign-up & registration (SU)

| ID | Requirement | P | Acceptance criteria |
|---|---|---|---|
| SU-01 | Sign up opens a modal (desktop) / full-screen sheet (mobile), deep-linkable at `/join` | M | Back button closes modal; direct URL works |
| SU-02 | Fields: Full name, Mobile (+91), Email, Date of birth, **Gender**, Selfie (mandatory) | M | Inline validation; errors say how to fix |
| SU-03 | Tapping Selfie opens camera capture: permission explainer → browser permission → live preview with face guide → capture → retake/use | M | Works on Chrome Android, Safari iOS 16+, desktop Chrome/Edge; requires one face detected; image ≤ 300 KB JPEG, 720px |
| SU-04 | Camera fallback: if permission denied or in-app browser, show steps + native file capture input | M | User can still complete signup |
| SU-05 | Consents: Terms & Privacy (required); WhatsApp updates (required for reminders, clearly labelled); Face attendance (optional, un-ticked, explains manual alternative) | M | Consent records stored with version, timestamp |
| SU-06 | Optional mobile OTP verification (setting) | S | Via WhatsApp authentication template; 5 attempts; 10 min expiry |
| SU-07 | Under-18 DOB → shows guardian message; online payment allowed, face attendance disabled until guardian consent at desk | M | Flag on member |
| SU-08 | Duplicate check: same mobile + same name → "You may already be registered" → continue or contact | S | No blocking for shared family numbers |
| SU-09 | Submit creates Member (`PENDING_PAYMENT`) and a registration token | M | Token valid 48 h |
| SU-10 | After registration, plan screen shows Monthly first (price for selected gender; both M/F shown in a small note), then 3/6/12 packages | M | Matches client flow; prices from DB |
| SU-11 | Plan screen shows start date (default today, may choose up to 15 days ahead) and computed end date | S | Uses business-rules date math |
| SU-12 | Abandoned registration (no payment in 24 h) → call task + lead in CRM | M | |

### 5.3 Payments (PAY)

| ID | Requirement | P | Acceptance criteria |
|---|---|---|---|
| PAY-01 | Payment page shows summary: name, photo, plan, dates, amount | M | |
| PAY-02 | Razorpay Checkout (UPI, cards, netbanking, wallets) via server-created order | M | Amount always computed server-side |
| PAY-03 | Server verifies checkout signature; webhook `payment.captured` / `order.paid` is final source of truth | M | Duplicate webhooks do not double-activate |
| PAY-04 | "Pay at reception" alternative | M | Member stays `PENDING_PAYMENT`, staff sees it in Fees > Pending |
| PAY-05 | Confirmation screen: success tick, member code, plan, valid from–to, amount, receipt number, receipt PDF, directions, what to bring | M | Also sent on WhatsApp |
| PAY-06 | Failure screen with retry and pay-at-reception | M | Failed attempt logged |
| PAY-07 | Renewal via `/renew/[token]` prefilled from WhatsApp button | M | Token signed, 30-day validity, single member |
| PAY-08 | CRM desk payment recording: Cash / UPI (direct to gym) / Card, with receipt | M | Staff role allowed; deletion owner-only with reason |
| PAY-09 | Receipt numbering by Indian financial year: `MF/2026-27/000123` | M | Gapless per FY |
| PAY-10 | Refund recording (manual, owner-only) | C | |

### 5.4 QR onboarding (QR)

| ID | Requirement | P | Acceptance criteria |
|---|---|---|---|
| QR-01 | Poster QR opens `/qr?src=reception` showing two large choices: **Existing customer** / **New customer** (bilingual) | M | Loads < 2 s on 4G |
| QR-02 | Existing: mobile (+OTP if enabled) → prefill if imported record exists | M | |
| QR-03 | Existing form: name, gender, DOB, email (optional), selfie, current plan (1/3/6/12/not sure), **"What is your month-end date?"** (required), last amount paid (optional), consents | M | Month-end date cannot be empty; future date ≤ 13 months |
| QR-04 | Existing submission → Verification queue; member sees "Reception will confirm in a moment" | M | Owner notification |
| QR-05 | New: same as SU-02..SU-05, then plan, then **Pay online** or **Pay at reception** | M | |
| QR-06 | Rate limiting and bot protection on QR endpoints | M | 10 submissions/hour per IP |

### 5.5 Max Register CRM (CRM)

| ID | Requirement | P | Acceptance criteria |
|---|---|---|---|
| CRM-01 | Login by mobile + 4–6 digit PIN; lock after 5 failures for 15 min; "remember this phone" 30 days | M | |
| CRM-02 | Roles: Owner, Reception, Trainer (view), Super Admin (vendor) | M | Permission matrix in `crm-module-spec.md` |
| CRM-03 | Home "Today": tiles for Active members, Came today, Fees due this week, Fees overdue; sections: Calls to make, Birthdays today, Alerts, Money this month | M | Loads < 1.5 s; every tile opens its list |
| CRM-04 | Every member row shows **photo**, name, colour band for fee state, days left/overdue | M | |
| CRM-05 | Member search by name, mobile digits, member code | M | Results as you type |
| CRM-06 | Member profile: photo, contact actions (Call, WhatsApp), fee state band, plan history, payments, attendance calendar, reminders log, notes | M | |
| CRM-07 | Add member at desk (photo first, then details, plan, payment) | M | ≤ 90 seconds for trained staff |
| CRM-08 | Renew in ≤ 3 taps: plan tile → payment method → confirm | M | Stops reminders immediately |
| CRM-09 | Mark member as Left with reason (icons) | M | Stops reminders; schedules face-template deletion |
| CRM-10 | Call list: reason chip, call/WhatsApp buttons, outcome buttons (Will renew, Call later, No answer, Left gym) | M | Outcome updates member and removes task |
| CRM-11 | Verification queue: selfie + details + declared month-end date; Approve / Edit date / Reject | M | Approve creates membership and enables reminders |
| CRM-12 | Birthdays today and this week; one-tap WhatsApp wish | M | |
| CRM-13 | Payment reminders view: due in 7 days, due today, overdue; expected collection amount this week | M | |
| CRM-14 | Leads pipeline: New, Called, Trial booked, Joined, Lost | S | |
| CRM-15 | Attendance: today list, manual mark, absent ≥ 7 days list, per-member month calendar | M | |
| CRM-16 | Alerts: new online payment, new lead, verification pending, **expired member checked in**, member unsubscribed, kiosk offline, WhatsApp failures | M | Badge count on bell |
| CRM-17 | Reports (visual): money this month vs last, new joins, renewals, left, busy hours, plan mix, gender split | S | |
| CRM-18 | WhatsApp log per member; pause reminders per member (e.g., travelling) with end date | M | |
| CRM-19 | Message Simulator (DEMO_MODE): timeline of messages the engine would send, with "advance time" control | M (demo) | Disabled in production |
| CRM-20 | Settings: plans & prices, reminder rules, send times, post-expiry cap, gym hours, promo banner, trust numbers, staff & PINs, kiosk pairing | M | Owner-only |
| CRM-21 | CSV import of existing register with preview and error rows | M | Template in `assets/demo-data/` |
| CRM-22 | Hindi default, English toggle, **voice read-out** button on Home and member profile | S | Uses device TTS (hi-IN) |
| CRM-23 | Undo for 10 s after renew, mark attendance, mark left | S | |
| CRM-24 | Installable PWA on owner's phone (home-screen icon) | S | |
| CRM-25 | Data export (CSV) owner-only | S | Audit logged |
| CRM-26 | Privacy requests: export a member's data, delete a member | M | Audit logged |

### 5.6 WhatsApp automation (WA)

| ID | Requirement | P | Acceptance criteria |
|---|---|---|---|
| WA-01 | Reminder 7 days before end date (1 message) | M | Default 10:00 IST |
| WA-02 | One reminder per day on each of the last 3 days before end date | M | |
| WA-03 | "Ends today" reminder on end date | S | Toggle |
| WA-04 | After expiry: 3 reminders/day (morning, afternoon, evening) up to configurable cap (default 7 days) | M | Cap editable incl. "no limit" with warning |
| WA-05 | Every reminder includes the text "If you do not want to continue your membership, please unsubscribe." and an **Unsubscribe** button, plus a **Renew now** link button | M | |
| WA-06 | Renewal (online or desk) stops all pending reminders immediately | M | Eligibility re-checked at send time |
| WA-07 | Unsubscribe → reminders stop permanently; member status → Left (reason: unsubscribed); confirmation message with Restart option; owner alert + call task | M | Idempotent |
| WA-08 | Text replies "STOP", "UNSUBSCRIBE", "बंद" treated as unsubscribe with confirmation step | S | |
| WA-09 | Quiet hours: never send before 08:00 or after 21:00 IST | M | |
| WA-10 | Payment receipt message after every payment | M | |
| WA-11 | Welcome message after first payment (timings, location link) | S | |
| WA-12 | Owner daily digest 08:30 IST: due today, overdue, birthdays, calls, yesterday's collection | S | |
| WA-13 | Owner instant alerts: new lead, online payment, expired member checked in | S | Configurable |
| WA-14 | Delivery status tracking (sent/delivered/read/failed) | M | Shown in member log |
| WA-15 | Automatic pause of all non-essential sends if number quality drops | S | Alert owner + vendor |

### 5.7 Attendance kiosk (ATT)

| ID | Requirement | P | Acceptance criteria |
|---|---|---|---|
| ATT-01 | Android app runs in locked kiosk mode, auto-starts on boot, screen stays on | M | Survives reboot and power cut |
| ATT-02 | Camera continuously detects faces; recognises enrolled consenting members on-device | M | Median time from face-in-frame to greeting ≤ 1.2 s |
| ATT-03 | Marks attendance with cooldown (default 3 h) | M | No duplicates within cooldown |
| ATT-04 | Greeting screen with photo, name, days left; Hindi voice greeting | M | |
| ATT-05 | Expired member: discreet "Please meet reception" + CRM alert | M | Fee amount never shown on kiosk |
| ATT-06 | Low-confidence match → "Are you {name}?" Yes/No | M | |
| ATT-07 | Unknown face → keypad fallback (mobile number) + QR to join | M | |
| ATT-08 | Works offline; queues events; syncs within 60 s of connectivity | M | Zero loss across 24 h offline test |
| ATT-09 | Enrolment: from signup/QR selfie automatically; staff-assisted multi-frame enrolment on kiosk | M | |
| ATT-10 | Adaptive template update after confident matches (bounded) | S | |
| ATT-11 | Passive liveness check | S | Blocks printed photo / phone screen in tests |
| ATT-12 | Device pairing via 6-digit code from CRM; token revocable | M | |
| ATT-13 | Heartbeat every 5 min: battery, temperature, app version, queue size | M | CRM alert if offline > 30 min in gym hours |
| ATT-14 | Hidden admin exit (long-press + owner PIN) | M | |
| ATT-15 | Face templates stored encrypted on device; wiped on unpair | M | |
| ATT-16 | Members under 18 or without face consent never matched | M | Excluded from gallery |
| ATT-17 | Shadow mode setting for first 2 weeks | M | Staff confirms each match |

---

## 6. Non-functional requirements (summary — full list in TRD §6)
- Availability 99.5% monthly for web/CRM; kiosk independent of server uptime.
- Security: OWASP ASVS L2 targets for auth, session, input, files; webhooks signature-verified.
- Privacy: DPDP-aligned notices, consent records, data-rights workflows, retention schedule.
- Accessibility: WCAG 2.2 AA for public site; CRM contrast ≥ 7:1 for primary text.
- Localisation: Hindi and English; Indian number formatting (₹1,50,000).
- Browser support: last 2 versions of Chrome, Safari, Edge, Samsung Internet; Android 10+ for kiosk (target Android 13+ device).

## 7. Analytics events
`lead_submitted`, `signup_started`, `selfie_captured`, `selfie_failed{reason}`, `signup_submitted`, `plan_selected{plan}`, `payment_started`, `payment_succeeded`, `payment_failed`, `pay_at_reception_chosen`, `qr_existing_started`, `qr_existing_submitted`, `qr_new_submitted`, `whatsapp_click`, `call_click`, `renew_link_opened`, `renew_paid`, `unsubscribe_tapped`, `kiosk_match{confidence_band}`, `kiosk_unknown`.

## 8. Release criteria
All **M** requirements pass UAT (`docs/08-quality/uat-checklist.md`); security checklist complete; backups verified by a restore; WhatsApp templates approved; Razorpay live; kiosk shadow-mode accuracy ≥ 95%; owner completes the 5 core CRM tasks unaided.
