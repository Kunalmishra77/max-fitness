# Website Copy Deck (v1.1)

Markers: **[VERIFY]** needs owner confirmation before production · **{placeholder}** to fill · Keys map to `apps/web/messages/{en,hi}.json`.

> v1.1, 2026-09-11: facts checked against the gym's Google Business Profile and its reviews (ADR-031). The "national champion" claim was removed because no source confirms it; the owner section replaces the champion story. Unverified promises (free first session, 2-hour call-back) were taken out of live copy.

---

## Announcement bar — `promo.bar`
- EN: "First session free for new members. Walk in or book on WhatsApp." [VERIFY free trial — not in live copy until confirmed]
- HI: "नए लोगों के लिए पहला सेशन फ्री। आइए या WhatsApp पर बुक करें।"

## Navigation — `nav.*`
About · Facilities · Plans · Owner · Reviews · Contact · **Sign up**
HI: हमारे बारे में · सुविधाएँ · प्लान · मालिक · रिव्यू · संपर्क · **साइन अप**

## Hero slides — `hero.slides[]`

**Slide 1 (owner)**
- H1 EN: "Coached by the owner. Since 2000."
- Sub EN: "Ajay Kuliyal and a team of trainers plan your workouts and diet. Rated {rating} from {count} Google reviews."
- H1 HI: "मालिक की देखरेख में ट्रेनिंग। 2000 से।"
- Sub HI: "अजय कुलियाल और ट्रेनर्स की टीम आपके वर्कआउट और डाइट की योजना बनाती है। Google पर {count} रिव्यू में {rating} रेटिंग।"
- CTAs: "Sign up" / "Chat on WhatsApp"

**Slide 2 (beginners)**
- EN: "New to the gym? Start right, not sore."
- Sub: "Our trainers set up your first weeks step by step, so you learn good form from day one."
- HI: "जिम में नए हैं? सही शुरुआत कीजिए।" / "पहले हफ्तों में ट्रेनर हर कदम पर साथ रहते हैं, ताकि सही तरीका पहले दिन से सीखें।"
- CTAs: "Sign up" / "Chat on WhatsApp"

**Slide 3 (women)**
- EN: "Women's membership at ₹1,200 a month."
- Sub: "A respectful, well-run floor with trainers who guide every set." (reviews: "very female friendly", "Safe for girls")
- HI: "महिलाओं के लिए मेंबरशिप सिर्फ ₹1,200 महीना।" / "सम्मानजनक माहौल, और हर सेट पर ट्रेनर का मार्गदर्शन।"
- CTAs: "Sign up" / "Chat on WhatsApp"

Slider controls (a11y): "Pause slideshow", "Play slideshow", "Show slide {n} of 3".

## Lead form — `lead.*`
- Title: "Get a call back" / "कॉल बैक पाएँ"
- Fields: "Your name", "Mobile number", "Your goal" → options: Lose weight, Build muscle, Get fit and active, Strength training, Other
- HI goals: वजन घटाना, मसल्स बनाना, फिट और एक्टिव रहना, ताकत बढ़ाना, अन्य
- Consent line (small): "By submitting, you agree we may call or WhatsApp you about membership."
- Button: "Request a call back" / "कॉल बैक माँगें"
- Success: "Request sent. We'll call you back soon." (a response-time promise needs the owner's commitment)
- Errors: "Enter your name." · "Enter a 10-digit mobile number starting with 6, 7, 8 or 9."

## Trust strip — `trust.*`
"4.8 on Google (231 reviews)" · "4.9 on Justdial (262 reviews)" · "Since 2000" · "Beginner-friendly trainers" · "{Mon–Sat 4:30 am – 10:00 pm}" (hours line from settings)

## About — `about.*`
- H2: "A neighbourhood gym where the owner still coaches."
- P1: "Max Fitness Gym has been part of Nyay Khand since 2000. Members come for the equipment and stay for the people: trainers who notice your form, remember your name and push you just enough."
- P2: "Whether you're lifting for the first time or chasing a new personal best, the floor is set up to help you train safely and keep coming back."
- Facts: "26 years in Indirapuram" · "Beginners guided from the first session" · "{hours line from settings}"
- HI H2: "मोहल्ले का जिम, मालिक की अपनी कोचिंग के साथ।"

## Facilities — `facilities.*`
- H2: "Everything you need, nothing you don't."
- Strength zone: "Machines, free weights, benches and full mirrors for form checks."
- Cardio zone: "Treadmills and recumbent bikes for warm-ups, fat loss and endurance." (reviews: separate cardio area)
- Functional floor: "Battle ropes, step platforms and agility cones on an open wooden floor." (owner photo, 2020)
- Not listed: a boxing corner. It was in the early wireframes from a 2020 photo; the owner
  confirmed on 2026-09-25 that the gym has none, so the zone was removed everywhere.
- Also: "Personal training" (confirmed) · "Diet plans" (confirmed) · "Lockers" [VERIFY] · "Drinking water" [VERIFY] · "Parking nearby" [VERIFY] · "Air-conditioned" [VERIFY]
- Not listed: changing area (a 2025 review reports none) — add only if the owner confirms one exists now.

## How to start — `start.*`
- H2: "Starting is simple."
- 1 "Visit or call" — "Drop in opposite Sai Mandir or call 098714 06350."
- 2 "Meet the trainers" — "Walk the floor and ask anything before you pay."
- 3 "Pick your plan" — "Monthly or save with 3, 6 or 12 months."
- 4 "Start with a trainer" — "Your first workouts are planned for your level."

## Membership — `plans.*`
- H2: "Membership fees"
- Toggle: "Men" / "Women" (HI: पुरुष / महिलाएँ)
- Column heads: "Plan" · "Price" · "Per month" · "You save"
- Rows: "Monthly", "3 months", "6 months", "12 months"; best-value marker: "Best value"
- Button: "Choose" (a11y label: "Choose 3 months for ₹4,000")
- Note: "Pay online by UPI or card, or pay at reception. Prices are for gym floor access with trainer guidance." [VERIFY inclusions]

## Promo banner — `promo.banner` (editable from CRM)
- Default: "Festive offer: join for 6 months and get 2 weeks extra." [placeholder — owner decides] · Button: "Claim on WhatsApp"

## Owner — `owner.*` (replaces the champion story)
- Name: "Ajay Kuliyal" · Role: "Owner and trainer, Max Fitness Gym"
- Title (gold): "Coaching on the floor, every day." / HI "हर दिन फ्लोर पर कोचिंग।"
- Lead: "Members don't only meet Ajay at the front desk. In their Google reviews they describe a coach who plans diets and workouts, checks progress day to day and keeps them motivated, with a team of trainers alongside."
- Quote (a member's Google review, verbatim): "“Ajay sir helps me stay motivated and monitors my condition on a day to day basis.”" — Aadhar G., Google review
- At a glance: "2000 — Max Fitness Gym opens in Nyay Khand" · "{rating}★ — from {count} Google reviews" · "Team — Trainers on the floor with Ajay" · "Today — Still coaching members every day"
- CTA: "Train with Ajay"
- Portrait: owner photo still needed (shot list P10 and portrait).
- A championship or other title appears here only with the owner's proof (certificate, event, year).

## Testimonials — `reviews.*`
- H2: "What members say"
- Link: "Read all reviews on Google" (listing reviews URL)
- Items: 6 real 5★ Google reviews, display "{First name} {Initial}." + stars + exact excerpt ≤ 220 chars: Gaurav · Vineet D. · Rohit S. · Santosh B. · Akshay D. · Afzal K. (see `apps/web/src/content/landing-content.ts`).
- DEMO placeholders (non-production only, used only if no real reviews, labelled "Demo review"):
  - "Very helpful trainers. I had never been to a gym and they taught me everything patiently." — Demo A.
  - "Good equipment and the owner personally corrects form. Worth the fee." — Demo B.

## Timings & visit — `visit.*`
- H2: "Visit us"
- Address: "Krishan Plaza, Plot No. 6, Abhay Khand 1, Nyay Khand I (opposite Sai Mandir), Indirapuram, Ghaziabad 201014" [VERIFY PIN — Google shows 201020]
- Hours table: from settings (Mon–Sat 4:30 am – 10:00 pm, Sunday closed, per Google); today's row labelled "Today".
- Buttons: "Call 098714 06350" · "Chat on WhatsApp" · "Get directions"

## FAQs — `faq.*`
1. **What are the gym timings?** — "We're open {hours from settings}."
2. **How much is the membership?** — "Monthly is ₹1,500 for men and ₹1,200 for women. 3, 6 and 12-month plans cost less per month."
3. **Can I try before joining?** — "Yes, your first session is free. Just walk in or message us on WhatsApp." [VERIFY]
4. **I've never been to a gym. Is that okay?** — "Absolutely. Most of our members started as beginners. Trainers will show you the machines and plan your first weeks."
5. **Is it comfortable for women?** — "{Owner-approved answer about environment, trainers, timings}." [VERIFY — reviews call it female-friendly, but one reports no female washroom or changing room]
6. **How do I pay?** — "Online by UPI, card or netbanking when you sign up, or at reception by cash or UPI."
7. **Why do you ask for a selfie?** — "It's your member photo so our staff recognise you. If you agree, the attendance phone at reception can also mark your attendance automatically. You can say no and staff will mark it manually."
8. **What if I miss some days — can I pause?** — "{Owner policy}." [VERIFY]
9. **Is there a refund?** — "{Owner policy}. See our Refund & Cancellation policy." [VERIFY]
10. **What should I bring?** — "Water bottle, a small towel and clean indoor shoes."
11. **Is there personal training?** — "Yes. Personal training is ₹3,000 a month and includes a diet plan." (owner's note on Google)
12. **What's the minimum age?** — "{16} years. Members under 18 need a parent or guardian to sign at reception." [VERIFY]

## Final CTA — `finalCta.*`
- H2: "Come and see the floor before you join."
- Sub: "Walk in, meet the trainers, then decide."
- Buttons: "Sign up" · "Chat on WhatsApp"

## Footer — `footer.*`
"Max Fitness Gym, Krishan Plaza, Plot No. 6, Abhay Khand 1, Nyay Khand I (opposite Sai Mandir), Indirapuram, Ghaziabad 201014 · 098714 06350" · "Privacy policy" · "Terms of membership" · "Refund & cancellation" · "Contact" · "© {year} Max Fitness Gym"

## Mobile sticky bar
"Call" · "WhatsApp" · "Sign up"

## WhatsApp click-to-chat prefill
"Hi Max Fitness Gym, I found you on your website. I'd like to know about membership."

---

## Sign-up flow — `signup.*`
- Title: "Sign up" · Stepper: "Step {n} of 3: {Your details | Choose your plan | Payment}"
- Labels: "Full name" · "Mobile number" · "Email" · "Date of birth" · "Gender" (Male / Female) · "Selfie"
- Selfie tile: "Take selfie" · helper "Used as your member photo" · after capture "Retake"
- Camera explainer: "We'll open your camera to take your member photo. Your browser will ask for permission next." Button "Open camera"
- Guidance: "Face the light. Remove caps and sunglasses." · Detected: "Face found" · Not detected: "Move your face inside the oval."
- Capture button: "Take photo" · Preview: "Use this photo" / "Retake"
- Denied: "Camera access is blocked. Allow the camera in your browser settings, or take a photo with your phone camera instead." Buttons: "Try again" · "Use phone camera"
- In-app browser: "Camera may not work inside Instagram or WhatsApp. Open this page in Chrome for the best experience." Button "Copy link"
- Consents:
  - "I agree to the {Terms of membership} and {Privacy policy}." (required)
  - "Send my membership updates, receipts and reminders on WhatsApp." (required for reminders; if unticked show: "You won't get renewal reminders.")
  - "Use my face for automatic attendance at reception. (Optional. Staff can mark attendance manually instead.)"
- Under-18 note: "You're under 18. You can sign up, but a parent or guardian must sign at reception before your first workout."
- Button: "Continue to plans"
- Plan step: "Monthly membership" · "Save with a package" · "Start date" · "Ends on {date}" · Button "Continue to payment"
- Payment step: "Pay {amount}" · "Pay at reception" · helper "We'll hold your plan for 48 hours."
- Processing: "Confirming your payment…"
- Success H1: "You're a member, {first name}." · "Member code {code}" · "{plan}, {start} to {end}" · "Paid {amount}, receipt {receiptNo}" · Buttons "Download receipt" · "Get directions" · "On your first visit, bring water, a small towel and clean indoor shoes." · "We've sent this to your WhatsApp."
- Pay at reception success: "Your plan is reserved, {first name}. Pay at reception within 48 hours to start."
- Failure: "Payment didn't go through. No money was taken, or if it was, it will be refunded automatically by your bank." [verify wording against Razorpay refund behaviour] Buttons "Try again" · "Pay at reception"

## QR flow — `qr.*`
- Welcome: "Welcome to Max Fitness Gym" / "मैक्स फिटनेस जिम में स्वागत है"
- Choice 1: "I'm already a member" / "मैं पहले से मेंबर हूँ"
- Choice 2: "I want to join" / "मुझे जॉइन करना है"
- Month-end question: "What is your month-end date?" / "आपकी फीस किस तारीख तक जमा है?" helper: "The last date your current fees cover. Check your receipt or ask reception." / "आपकी मौजूदा फीस जिस आखिरी तारीख तक है। रसीद देखें या रिसेप्शन से पूछें।"
- Plan question: "Which plan are you on?" options "1 month, 3 months, 6 months, 12 months, Not sure"
- Submitted: "Thanks, {first name}. Please show this screen at reception." · reference "{code}"
- New customer ending: "Pay online now" · "Pay at reception"

## Renew page — `renew.*`
- H1: "Renew your membership, {first name}"
- Sub: "Current plan ends on {date}. Your new plan starts on {newStart}."
- Button: "Pay {amount}"
- Expired link: "This renewal link has expired. Message us on WhatsApp and we'll send a new one."

## Unsubscribe (web fallback) — `unsub.*`
- "Stop membership reminders for {first name}?" Buttons "Yes, unsubscribe" · "No, keep reminders"
- Done: "You're unsubscribed. You won't get membership reminders. Changed your mind? Tap Restart reminders."

## Legal pages (drafts produced in Phase 2, reviewed by client)
- Privacy policy (DPDP-aligned; see `docs/07-security-compliance/privacy-and-dpdp-compliance.md`)
- Terms of membership (conduct, health declaration, liability, lockers, age)
- Refund & cancellation (per owner answer B6)
- Contact (NAP, hours, grievance contact)
