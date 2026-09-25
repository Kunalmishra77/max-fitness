# Landing Page, Sign-up & QR Wireframes

Section order is final. Copy for every section is in `docs/04-content/website-copy-deck.md`. IDs map to PRD `LP-xx`.

## Page order
| # | Section | Background | PRD | Anchor |
|---|---|---|---|---|
| 0 | Announcement bar (promo, optional) | Signboard Red | LP-02 | — |
| 1 | Navigation | Transparent over hero → Plate Navy on scroll | LP-01 | — |
| 2 | Hero video slider + lead form | Video | LP-03/04 | `#top` |
| 3 | Trust strip | Plate Navy | LP-05 | — |
| 4 | About the gym | Chalk | LP-06 | `#about` |
| 5 | Facilities by zone | Plate Navy | LP-07 | `#facilities` |
| 6 | How to start (4 steps) | Chalk | LP-08 | — |
| 7 | Membership fee board | Plate Navy | LP-09 | `#plans` |
| 8 | Promo banner | Signboard Red | LP-11 | — |
| 9 | Champion story (medal plaque) | Plate Navy + gold | LP-10 | `#champion` |
| 10 | Testimonials | Chalk | LP-12 | `#reviews` |
| 11 | Gallery | Plate Navy | LP-13 | `#gallery` |
| 12 | Timings & visit info | Chalk | LP-19 | — |
| 13 | FAQs | Chalk | LP-17 | `#faq` |
| 14 | Final CTA with Sign up | Plate Navy | LP-18 | — |
| 15 | Contact + map | Chalk | LP-19 | `#contact` |
| 16 | Footer | Plate Navy | LP-20 | — |
| — | Mobile sticky bar, WhatsApp float | — | LP-21 | — |

Optional (hidden until content exists): Transformations (after 10), Trainers (after 9), BMI calculator (after 13).

---

## 1–2. Navigation + Hero (desktop ≥ 1024px)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ [MAX logo]   About  Facilities  Plans  Champion  Reviews  Contact   ☎  [Sign up] │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  (full-bleed video, scrim bottom-left)                                           │
│                                                            ┌──────────────────┐  │
│  Train where a national                                    │ Get a call back  │  │
│  champion runs the floor.                                  │                  │
│                                                            │ Name  [________] │  │
│  Indirapuram's strength gym since 2000 —                   │ Mobile +91[____] │  │
│  serious equipment, patient trainers.                      │ Goal  [Weight ▾] │  │
│                                                            │                  │  │
│  [ Sign up ]  [ Book a free trial ]                        │ [Request a call  │  │
│                                                            │       back]      │  │
│  ▮▮▯ ← rep-tally slide indicator      ❚❚ pause             │ We reply on      │  │
│                                                            │ WhatsApp too.    │  │
│                                                            └──────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────┘
│ ★4.8 Google (231) │ ★4.9 Justdial (262) │ Since 2000 │ National Champion │ Open till 10 pm │
```
- Text block spans columns 1–7; form panel columns 9–12, vertically centred.
- Slide auto-advance 7 s; each slide swaps headline, sub-copy and the second CTA.

### Hero (mobile 360–767px)
```
┌──────────────────────────────┐
│ [MAX]            ☰  [Sign up]│
├──────────────────────────────┤
│  (portrait video 9:16 crop)  │
│                              │
│  Train where a national      │
│  champion runs the floor.    │
│  Since 2000, Indirapuram    │
│  [ Sign up          ]        │
│  [ Book a free trial ]       │
│  ▮▮▯                    ❚❚   │
├──────────────────────────────┤
│ Get a call back              │
│ Name   [________________]    │
│ Mobile +91 [____________]    │
│ Goal   [Weight loss     ▾]   │
│ [ Request a call back     ]  │
├──────────────────────────────┤
│ ★4.8 Google, ★4.9 Justdial  │  (horizontal scroll strip)
└──────────────────────────────┘
```

## 4. About (Chalk)
```
┌──────────────────────────────────────────────────────────────┐
│ [large photo: floor wide shot]   A neighbourhood gym with a   │
│  cols 1–6                        champion's standards.        │
│                                  2 short paragraphs            │
│ [small photo: trainer + member]  Three plain facts:           │
│                                  26 years in Indirapuram      │
│                                  Beginners guided from day 1  │
│                                  Open till 10 pm              │
└──────────────────────────────────────────────────────────────┘
```

## 5. Facilities by zone (Plate Navy)
Not identical cards — each zone is a photo + a short list, laid out as an asymmetric grid reflecting the actual floor.
```
┌───────────────────────────────┬───────────────────────────┐
│ [photo] Strength zone          │ [photo] Cardio zone        │
│ Machines, free weights,      │ Treadmills, recumbent     │
│ benches, mirrors              │ bikes                      │
├───────────────────────────────┴───────────────────────────┤
│ [photo] Functional floor                                   │
│ Battle ropes, step platforms, agility cones, open wooden   │
│ floor                                          (full width) │
├────────────────────────────────────────────────────────────┤
│ Also here: Personal training, Changing area*, Lockers*, │
│ Drinking water*, Music        (*show only if confirmed)   │
└────────────────────────────────────────────────────────────┘
```

## 6. How to start (Chalk) — real sequence, numbered
```
1 Visit or call   →   2 Free trial session   →   3 Pick your plan   →   4 Start with a trainer
```
(Arrows are visual connectors between steps, not appended to text links.)

## 7. Membership fee board (Plate Navy)
```
┌──────────────────────────────────────────────────────────────┐
│ Membership fees                    [ Men | Women ] toggle     │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Plan          Price        Per month    You save          │ │
│ │ Monthly       ₹1,500       ₹1,500       —      [Choose]   │ │
│ │ 3 months      ₹4,000       ₹1,330       ₹500   [Choose]   │ │
│ │ 6 months      ₹7,500       ₹1,250       ₹1,500 [Choose]   │ │
│ │ 12 months ◆   ₹13,500      ₹1,130       ₹4,500 [Choose]   │ │  ◆ gold "best value"
│ └──────────────────────────────────────────────────────────┘ │
│ Prices include trainer guidance on the floor. Pay online by  │
│ UPI/card or at reception.                                     │
└──────────────────────────────────────────────────────────────┘
```
Mobile: each plan becomes a stacked row with price large and "Choose" full width.

## 9. Champion story — medal plaque (Plate Navy + Medal Gold)
```
┌────────────────────────────────────────────────────────────────────────┐
│                                                                        │
│  [portrait of owner, cols 1–5, tall]    {Owner Name}                   │
│                                          National Champion             │ ← Khand, gold, huge
│                                          {Discipline}, {Year}          │
│                                                                        │
│                                          "{Short quote from owner}"    │
│                                                                        │
│                                          Timeline (verified facts):    │
│                                          {Year} Started training…      │
│                                          {Year} National title…        │
│                                          2000  Opened Max Fitness Gym  │
│                                          Today  Coaching Indirapuram   │
│                                                                        │
│  [certificate photo]  [medal photo]      [ Train with {Name} ]         │
└────────────────────────────────────────────────────────────────────────┘
```

## 10. Testimonials (Chalk)
Horizontal row (scroll-snap on mobile) of real Google reviews: stars (Khand), 2–4 line excerpt, "Priya S." , "Google review". A plain link "Read all 231 reviews on Google".

## 12. Timings & visit info (Chalk)
Two columns: hours table (today highlighted), and "Finding us": Krishan Plaza, Plot No. 6, Nyay Khand 1 — opposite Sai Mandir; buttons: Get directions, Call, Chat on WhatsApp.

## 14. Final CTA (Plate Navy)
```
Your first session is on us.            [ Sign up ]  [ Chat on WhatsApp ]
Walk in, meet the trainers, then decide.
```

## 16. Footer
Logo, address, phone, hours, quick links, Privacy, Terms, Refund & cancellation, social icons, "© 2026 Max Fitness Gym".

---

## Sign-up modal — 3 steps

### Step 1, Your details
```
┌──────────────────────────────────────┐
│ Sign up                        ✕     │
│ Step 1 of 3: Your details           │
│ Full name   [______________________] │
│ Mobile      +91 [__________________] │
│ Email       [______________________] │
│ Date of birth  [DD ▾] [Month ▾] [YYYY ▾] │
│ Gender      [   Male   ][  Female  ] │
│ Selfie      ┌──────────┐             │
│             │  📷       │ Take selfie │
│             └──────────┘ Used as your │
│                          member photo │
│ ☐ I agree to the Terms and Privacy    │
│ ☐ Send membership updates on WhatsApp │
│ ☐ Use my face for automatic attendance│
│   (optional — staff can mark it       │
│   manually instead)                    │
│ [        Continue to plans        ]  │
└──────────────────────────────────────┘
```

### Selfie capture sheet
```
┌──────────────────────────────┐
│ Take a selfie            ✕   │
│ ┌──────────────────────────┐ │
│ │   live camera preview    │ │
│ │       (   oval   )       │ │
│ │                          │ │
│ └──────────────────────────┘ │
│ Face the light. Remove caps  │
│ and sunglasses.              │
│ ✓ Face found                 │
│ [       Capture        ]     │
└──────────────────────────────┘
Before permission: "We need your camera to take your member photo. Your browser will ask for permission next." [Allow camera]
Denied: "Camera is blocked. Tap the lock icon in the address bar → Allow camera, or upload a photo instead." [Try again] [Use phone camera app]
```

### Step 2, Choose your plan
```
Monthly membership
  ┌─────────────────────────────┐
  │ Monthly   ₹1,500 / month    │ ← price for selected gender, large
  │ (Women ₹1,200 / month)      │ ← small reference line
  │ [ Choose monthly ]          │
  └─────────────────────────────┘
Save with a package
  ( ) 3 months   ₹4,000   save ₹500
  ( ) 6 months   ₹7,500   save ₹1,500
  ( ) 12 months  ₹13,500  save ₹4,500  ◆ best value
Start date  [Today ▾]   Ends on 9 Oct 2026
[ Continue to payment ]
```

### Step 3, Payment
```
Summary: [photo] Rohit Sharma, 3 months, 10 Sep – 9 Dec 2026
Amount  ₹4,000
[ Pay ₹4,000 ]            (opens Razorpay)
or  Pay at reception      (reserves your plan for 48 hours)
Secure payments by Razorpay, UPI, Cards, Netbanking
```

### Confirmation
```
        ✓  (drawn tick)
  You're a member, Rohit.
  Member code MF-0231
  3 months, 10 Sep – 9 Dec 2026
  Paid ₹4,000, Receipt MF/2026-27/000231
  [Download receipt] [Get directions]
  On your first visit: bring water, a small towel and indoor shoes.
  We've sent this to your WhatsApp.
```

---

## QR flow (`/qr`)
```
┌──────────────────────────────┐
│ [MAX logo]                   │
│ Welcome to Max Fitness Gym   │
│ मैक्स फिटनेस जिम में स्वागत है │
│                              │
│ ┌──────────────────────────┐ │
│ │ 👤 I'm already a member   │ │
│ │ मैं पहले से मेंबर हूँ       │ │
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ ＋ I want to join          │ │
│ │ मुझे जॉइन करना है          │ │
│ └──────────────────────────┘ │
│ EN | हिंदी                    │
└──────────────────────────────┘
```
Existing-customer form (one question per screen on mobile, progress bar):
1. Mobile number (+ OTP) → 2. Name → 3. Gender → 4. Date of birth → 5. Selfie → 6. Which plan are you on? (1 / 3 / 6 / 12 / Not sure) → 7. **What is your month-end date? / आपकी फीस किस तारीख तक जमा है?** (calendar, required) → 8. Last amount paid (optional) → 9. Consents → Submit → "Please show this screen at reception" with a large reference code.
