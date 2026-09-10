# 01 — Deep Project Analysis

**Project:** Max Fitness Platform  **Client:** Max Fitness Gym, Indirapuram, Ghaziabad  **Status:** Blueprint v1.0  **Date:** 10 Sep 2026

---

## 1. The client, as the evidence shows it

| Signal | Source | What it tells us |
|---|---|---|
| 4.8★ from 231 Google reviews, "Open", closes 10 pm | Google Business Profile (GBP) | Strong reputation already exists. The website must *borrow* this trust immediately (hero trust strip). |
| Review summary: beginner-friendly, helpful trainers, state-of-the-art equipment | Google AI review summary | Core positioning is **"serious gym that is kind to beginners"**, not "hardcore bodybuilding only". |
| 4.9★ / 262 reviews, "Established in the year 2000", "opposite Sai Mandir" | Justdial | 26 years of operation; landmark-based directions matter to local customers. |
| No website listed ("Add website") | GBP | Every Google Maps visitor today has nowhere to go except calling. A website link on GBP is the single fastest traffic win. |
| Business name on GBP is "Max Fitness GYm India🇮🇳🇮🇳" | GBP | Name with emojis and odd casing is inconsistent with the signboard and with Justdial. Google's guidelines expect the real-world name; clean it up to protect the listing. |
| Popular times peak in the evening (around 6 pm and later) | GBP | Reminder and call timing, kiosk throughput planning, staff shift planning. |
| Photos: functional zone (battle ropes, step platforms, agility cones), punching bags, treadmills, recumbent bike, strength machines, mirrors, red/blue walls, wooden floor | GBP photos | Real facility inventory for the Facilities section and a colour palette grounded in the actual space. |
| Signboard: bold red/yellow "MAX FITNESS GYM" with a bodybuilder | Justdial photo | Existing brand equity: red + yellow + strength imagery. |
| Owner is a former National Champion | Client brief | The single most differentiating story. No chain gym in Indirapuram can copy it. |
| Owner studied up to 5th standard | Client brief | CRM must be designed for low text literacy: icons, colours, photos, numbers, Hindi, voice, one action per screen. |
| Gender-based pricing (M ₹1,500 / F ₹1,200) | Client brief | The women's segment is deliberately targeted. Sign-up must capture gender, and the site should speak to women's safety and comfort (claims to be verified with owner). |

## 2. What the business actually needs (jobs to be done)

Most small gyms lose money in three quiet ways. Every module should be judged against these:

1. **Leakage at renewal.** Members drift past their end date, keep training for a few days, and nobody chases them. → Reminder engine + call list + "expired member checked in" alert.
2. **Lost enquiries.** People find the gym on Maps, cannot see prices or photos, and never call. → Website with prices, trust signals, one-tap WhatsApp and a 3-field lead form, instant owner alert.
3. **No memory.** A paper register cannot tell you who is absent for 10 days, whose birthday it is, or how much will come in this week. → Max Register home screen shows exactly these, visually.

Attendance and face recognition are valuable mainly because they *feed* 1 and 3 (absence alerts, expired-but-visiting alerts), not as an end in themselves.

## 3. The system in one picture

```
            Google Maps / Instagram / Word of mouth
                           │
                  ┌────────▼────────┐          ┌─────────────────┐
                  │  Website (web)  │◄─────────┤ QR poster at    │
                  │  lead · signup  │          │ reception (/qr) │
                  │  selfie · pay   │          └─────────────────┘
                  └────────┬────────┘
                           │  members, memberships, payments
      Razorpay ◄──────────►│
                  ┌────────▼──────────────┐     ┌──────────────────────┐
                  │ PostgreSQL (source of │◄───►│ Worker: reminders,   │──► WhatsApp Cloud API ──► Members / Owner
                  │ truth) + private files│     │ digests, call tasks  │◄── webhooks (status, Unsubscribe taps)
                  └────────▲──────────────┘     └──────────────────────┘
                           │
          ┌────────────────┼─────────────────┐
          │                                  │
 ┌────────┴─────────┐              ┌─────────┴─────────┐
 │ Max Register CRM │              │ Max Haazri kiosk  │  on-device face recognition,
 │ owner / staff    │              │ Android at desk   │  offline queue, syncs attendance
 └──────────────────┘              └───────────────────┘
```

## 4. Key architectural decisions (summary — full reasoning in TRD and module specs)

| # | Decision | Why |
|---|---|---|
| D1 | **One Next.js app** for website, sign-up, QR flow, CRM and API; a **separate Node worker** for schedules | Small team, one deployable, shared types. Worker isolates time-based jobs from web traffic. |
| D2 | **Monorepo (pnpm + Turborepo)** with `packages/core` holding all business rules | Pricing, dates and reminder logic are used by web, worker and seed; they must be identical and unit-tested. |
| D3 | **PostgreSQL + Prisma**, **pg-boss** job queue in the same database | No Redis to run or back up. Enough for thousands of jobs a day. |
| D4 | **Reminder engine evaluates rules at each send slot** instead of pre-scheduling per-member jobs | Renewal or unsubscribe automatically stops future reminders because the next evaluation simply finds nothing to send. No job cancellation bugs. |
| D5 | **On-device face recognition** in a native Kotlin kiosk app, offline-first | Works when Wi-Fi drops, fast (<1 s), keeps biometric processing on the gym's own device, no per-call cloud fees. |
| D6 | **Face engine behind an interface** with a commercial-licence gate before production | The most popular open face-recognition weights are licensed for non-commercial research only; the pipeline must allow swapping in a licensed model or SDK. |
| D7 | **Razorpay** for online payments + **cash/UPI recording in CRM** | Indian gyms take most fees at the desk. Both paths create the same `Payment` record. |
| D8 | **WhatsApp Cloud API behind a provider adapter** (Meta direct, BSP, or simulator) | Lets us demo without Meta approval and switch providers without touching business logic. |
| D9 | **Hindi-first CRM with icons, colours, member photos, and optional voice read-out** | Designed for an owner with 5th-standard schooling and busy reception staff. |
| D10 | **Multi-tenant-ready schema (`gymId` on every row)**, single-tenant deployment | Costs almost nothing now; makes this a reusable "gym OS" product for future gyms. |
| D11 | **Self-hosted on a Mumbai VPS via Docker Compose + Caddy**, nightly off-site encrypted backups with restore drills | Low monthly cost, data stays in India, predictable. Backups and firewalling are Phase 1 items, not afterthoughts. |
| D12 | **DEMO_MODE with seeded data, simulated payments and an in-app WhatsApp Message Simulator** | The client can see the whole journey, including reminders over time, before Meta and Razorpay approvals arrive. |

## 5. Gaps and conflicts found in the brief (and how this blueprint resolves them)

These are deliberate improvements. Each needs owner sign-off (see `03-client-inputs-and-open-questions.md`).

### 5.1 Sign-up form does not capture gender, but price depends on gender
Resolution: add **Gender (Male / Female)** to the sign-up form. The plan screen then shows only the relevant prices. Handling of "Other / prefer not to say" is an open question (default: owner chooses at desk).

### 5.2 Package prices for 3, 6 and 12 months are not given
Resolution: seed **placeholder prices** (clearly marked) and make all prices editable in CRM Settings. Placeholders: Male 3M ₹4,000 · 6M ₹7,500 · 12M ₹13,500; Female 3M ₹3,200 · 6M ₹6,000 · 12M ₹10,800.

### 5.3 "Three reminders every day after expiry" with no end
Sending three identical WhatsApp messages daily to someone who has not replied, indefinitely, will get the number reported and blocked. WhatsApp tracks quality and restricts numbers with high block rates, which would also kill reminders to good members.
Resolution: implement exactly the requested pattern (morning, afternoon, evening) but with a **configurable maximum number of days** (recommended default **7 days**). After that, automatic messages stop and the member moves to the owner's **call list**. The owner can change the cap in Settings, including "no limit", after seeing this warning.

### 5.4 Expiry-day gap
"One reminder a week before" + "one daily in the last three days" + "three daily after expiry" leaves the expiry day itself undefined. Resolution: send one "ends today" message on the end date (can be switched off).

### 5.5 Unsubscribe tapped by mistake, or a shared family phone
In many Indian families, husband and wife (or parent and child) share one mobile number. A reply of "STOP" would be ambiguous. Resolution: every reminder's Unsubscribe button carries a **signed payload identifying the exact member and membership**. After tapping, the member gets a confirmation with a "Restart reminders" button, and the owner gets a call task ("Ask why they left"). Mobile numbers are **not unique** in the database.

### 5.6 Existing customers self-declaring their month-end date via QR
Anyone could type a later date. Resolution: QR submissions from existing customers go to a **Verification queue**. The owner sees the selfie, name and declared date side-by-side and approves in one tap (or edits the date). Reminders start only after approval. Recommended: import the paper register first (CSV template provided) so most existing members just confirm pre-filled details.

### 5.7 Selfie from a phone vs. kiosk camera
A single phone selfie is a weak enrolment for face recognition (different camera, angle and lighting). Resolution: the sign-up selfie bootstraps recognition; the kiosk **adds higher-quality templates** the first time the member is confirmed at reception, and improves them over the first few visits.

### 5.8 Face data is sensitive personal data under India's DPDP framework
DPDP Rules were notified in November 2025 with remaining obligations phasing in by May 2027. Building compliant now is cheaper than retrofitting. Resolution: separate, explicit, un-ticked consent for face attendance (with manual attendance as the alternative), standalone privacy notice in Hindi and English, deletion of face templates when a member leaves, and **no face recognition for members under 18** unless verifiable parental consent is recorded at the desk.

### 5.9 Payment gateway activation needs policy pages
Payment gateways in India review the website before activating live payments. Resolution: Terms, Privacy, Refund & Cancellation and Contact pages are part of Phase 2, not the end.

### 5.10 "Pay at reception"
People scanning the QR are standing at the desk. Forcing online payment adds friction. Resolution: QR new-customer flow offers **Pay online** or **Pay at reception**; staff records the cash/UPI payment in CRM, which activates the membership.

### 5.11 Expired members still walking in
No turnstile exists, so recognition cannot block entry. Resolution: kiosk greets politely and says "please meet reception" (never announces fees publicly), and the owner gets an instant **"expired member checked in"** alert — the highest-value alert in the system.

## 6. Scale assumptions

| Metric | Assumption | Design headroom |
|---|---|---|
| Active members | 150–400 | 2,000 |
| Check-ins per day | 100–300, evening peak ~40/hour | 150/hour on one kiosk |
| New sign-ups per month | 15–40 | 500 |
| WhatsApp messages per month | 300–800 | 20,000 |
| CRM users | 1 owner + 1–3 staff | 20 |
| Website visitors per month | 1,000–5,000 | 100,000 (static-cached landing page) |

A single 4 vCPU / 8 GB VPS is comfortably sufficient.

## 7. Top risks (full register in `04-risk-register.md`)

1. Face recognition accuracy in real lighting, and model licensing → early POC spike, shadow mode, licensed engine before go-live.
2. Meta Business verification / template approval delays → start in week 0, simulator for demos, BSP fallback.
3. Owner adoption of CRM → co-design sessions, Hindi voice guide, 3 core tasks only on home screen, training video.
4. Poor data migration from the paper register → CSV import + QR confirm drive + verification queue.
5. Razorpay activation delays → policy pages early; cash recording works from day one.

## 8. Success metrics (first 90 days after launch)

| KPI | Target |
|---|---|
| Existing members migrated with verified end date | ≥ 90% within 30 days |
| Renewal rate of members reaching expiry | +15 percentage points vs. owner's baseline estimate |
| Website lead → joined conversion | ≥ 20% |
| Online sign-up → paid (online or desk) | ≥ 60% |
| Kiosk auto-recognition rate (enrolled, consenting members) | ≥ 95%, false match ≤ 0.1% |
| Owner opens Max Register | ≥ 5 days a week |
| WhatsApp block/report signals | Quality rating stays High |

## 9. Productisation note

Every design choice above (tenant id on every row, settings-driven pricing and reminder rules, provider adapters, Hindi-first UX) makes this reusable for other neighbourhood gyms with minimal change. Treat Max Fitness as the design partner for a repeatable product.
