# Content Strategy & Local SEO

## 1. Positioning
**"Indirapuram's owner-coached gym since 2000 — patient with beginners."**

> Revised 2026-09-11 after researching the Google Business Profile (ADR-031). The earlier "champion-led" positioning relied on a national title that no source confirms; restore it only with the owner's proof.

Three pillars (every page, post and message should support at least one):
1. **Owner-led coaching** — owner Ajay Kuliyal coaches members himself with a team of trainers; diet plans and personal training (₹3,000/month, per the owner's Google note).
2. **Beginner-friendly guidance** — the most repeated theme in 231 Google reviews (4.8★): helpful, humble trainers and a welcoming floor.
3. **Neighbourhood value** — honest prices shown upfront, women's pricing, open 4:30 am–10 pm Mon–Sat, opposite Sai Mandir.

## 2. Voice
- Plain, warm, confident. Short sentences. Talks like a good trainer, not an ad.
- English site with Hindi toggle; Hindi is natural spoken Hindi (not formal शुद्ध हिंदी) — e.g., "फीस", "मेंबर", "जॉइन करें".
- Never body-shame, never promise specific kg results, never "no pain no gain".
- Claims must be verifiable (see §6).

| Do | Don't |
|---|---|
| "Our trainers set up your first weeks step by step." | "Transform your body in 30 days!!!" |
| "₹1,500 a month. No hidden charges." | "Unbeatable prices, hurry!" |
| "If you don't want to continue, you can unsubscribe." | "Last chance before we cancel you" |

## 3. Keyword map (validate volumes in a keyword tool before launch)

| Intent | Primary keywords | Target |
|---|---|---|
| Local, high intent | gym in Indirapuram; gym near Nyay Khand; gym in Nyay Khand 1 Indirapuram; best gym in Indirapuram | Home title/H1/intro, GBP |
| Price | gym fees in Indirapuram; monthly gym fee Ghaziabad; gym membership price Indirapuram | Plans section, FAQ |
| Segment | ladies gym Indirapuram; gym for women in Indirapuram; gym for beginners Ghaziabad | Hero slide 3, FAQ |
| Trust | personal trainer Indirapuram; gym with diet plan Ghaziabad; owner-run gym Nyay Khand | Owner section, facilities |
| Hindi | इंदिरापुरम में जिम; जिम फीस इंदिरापुरम | Hindi version |
| Landmarks | gym near Sai Mandir Nyay Khand; gym near Abhay Khand (Google lists "Abhay Khand 1, Nyay Khand I") | Contact/visit copy |

On-page (revised 2026-09-11, ADR-031):
- `<title>`: "Max Fitness Gym, Indirapuram | Owner-coached gym in Nyay Khand 1"
- Meta description: "Gym in Nyay Khand 1, Indirapuram since 2000. Owner-led coaching and beginner-friendly trainers, rated 4.8 on Google. Open 4:30 am–10 pm. Monthly from ₹1,200."
- One H1 (hero headline), logical H2 per section.
- Image alt text describes the real scene ("Member training with battle ropes on the functional floor at Max Fitness Gym").

## 4. Structured data
- `ExerciseGym` JSON-LD: name, address (Krishan Plaza, Plot No. 6, Abhay Khand 1, Nyay Khand I, Indirapuram, Ghaziabad, UP 201014 — Google lists 201020, owner to confirm), geo **28.633763, 77.350075** (GBP pin, verified 2026-09-11), hasMap, telephone, openingHoursSpecification, url, priceRange ("₹₹"), sameAs (Google Maps listing `?cid=10796321720318476385`, Justdial). Instagram when the gym's own account is confirmed. Image when real photos exist.
- `FAQPage` for the FAQ section.
- `Person` for the owner only with verified facts; no `award` unless the owner provides proof of a title.
- **Do not** add `aggregateRating` from Google/Justdial reviews to your own LocalBusiness markup — self-serving review markup isn't eligible for rich results and can be treated as spam.

## 5. Google Business Profile (quick wins, week 1)
1. Add website URL with UTM: `?utm_source=google&utm_medium=gbp&utm_campaign=profile`.
2. Align the business name to the real signboard name (e.g., "Max Fitness Gym") — remove emojis and odd capitalisation; GBP guidelines expect the real-world name and edits otherwise risk suspension.
3. Consistent NAP everywhere (site footer, Justdial, Instagram): exact same address string and phone.
4. Primary category "Gym"; secondary categories only if true (e.g., "Personal trainer"). Not
   "Boxing gym" — the gym has none (2026-09-25).
5. Fill hours incl. special hours for festivals; add attributes (women-friendly etc. only if true).
6. Upload the new professional photo set (20+), cover photo, logo, 3 short videos.
7. Products/Services: list the 4 plans with prices.
8. Weekly GBP post: tip, offer, member milestone (with consent).
9. Reply to every review within 48 h (template bank in §8).
10. Add booking/"Sign up" link to `/join?utm_source=google&utm_medium=gbp&utm_campaign=book`.

## 6. Claims verification register
| Claim | Evidence required | Status |
|---|---|---|
| Since 2000 | Owner confirmation (Justdial listing states 2000) | Pending |
| National Champion | Certificate photo, event name, year, federation | Pending |
| 4.8★ / 231 Google | Screenshot, update monthly | Captured 10 Sep 2026 |
| 4.9★ / 262 Justdial | Screenshot, update monthly | Captured 10 Sep 2026 |
| Open till 10 pm | GBP + owner | Pending full schedule |
| Female trainer / ladies timing | Owner | Pending |
| AC, lockers, showers, parking | Photos/owner | Pending |

## 7. Review generation (policy-safe)
- Ask every member at day 14 and at renewal via staff or a single WhatsApp utility message after a positive interaction (owner-triggered, not automated to everyone).
- Link directly to the GBP review form.
- **Never** offer discounts or gifts for reviews and never ask only happy members (review gating) — both violate Google's policies.

## 8. Review reply bank (examples)
- 5★: "Thank you, {name}! Great to have you training with us. See you on the floor. — Team Max Fitness"
- 3★: "Thanks for the honest feedback, {name}. We'd like to fix this — please call us on 098714 06350."
- 1★: "We're sorry to hear this, {name}. Please call {owner} directly on 098714 06350 so we can understand and make it right."

## 9. Social content (Instagram / Facebook / YouTube Shorts)
Cadence: 4 posts/week, 3 Reels/week, daily stories.

| Pillar | Formats | Example |
|---|---|---|
| Champion | Reel, carousel | "Champion's cue of the week" — owner shows one form fix in 20 s |
| Beginner guidance | Reel | "Your first week at Max: day 1 to day 7" |
| Member stories | Carousel (consent) | "Neha, 6 months, stronger back and better sleep" (no kg promises) |
| Floor life | Stories | Evening rush, new equipment, festival greetings |
| Offers | Static + story | Seasonal offer tied to promo banner |
| Community | Reel | Birthday shout-outs (with consent), member of the month |

Every post: location tag "Indirapuram", CTA "Sign up — link in bio" to `/join?utm_source=instagram`.

## 10. Measurement
- Plausible (or GA4 with consent) for pageviews and events in PRD §7.
- UTM discipline for every link (GBP, Instagram, WhatsApp, QR poster: `utm_source=qr&utm_medium=poster`).
- Monthly one-page report to owner (in Hindi, visual): visitors, enquiries, sign-ups, renewals, reviews gained.
