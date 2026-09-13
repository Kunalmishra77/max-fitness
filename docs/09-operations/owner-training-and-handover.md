# Owner Training & Handover

## 1. Training approach
- Language: Hindi, spoken, with screen recording. No manuals to read.
- Format: 3 in-person sessions of 30 minutes on the owner's own phone + 1 staff session + recorded video + laminated A4 guide with icons.
- Method: "I do, we do, you do" — show, do together, owner does alone while we watch silently.
- Success: owner completes the 5 UAT tasks unaided, twice, on different days.

## 2. Session plan
| Session | Content | Practice |
|---|---|---|
| 1 — "आज का काम" | Open app from home screen, Home tiles meaning (colours), voice button, calls list, call + outcome | Clear 5 demo calls |
| 2 — "फीस" | Find member (search by name/number), profile colour card, renew in 3 taps, undo, add new member at desk | Renew 3, add 1 |
| 3 — "जाँच और हाज़िरी" | Verify QR submissions, today's attendance, who's not coming, alerts bell, what WhatsApp digest means | Approve 3, mark 2 manual |
| Staff — reception | All of the above minus money reports; QR drive script; kiosk first aid; privacy basics | Role play |

## 3. Laminated guide (content)
Front: Home screen picture with arrows: 🟢 फीस जमा · 🟠 जल्द फीस · 🔴 फीस बाकी · 📞 आज के कॉल · 🎂 जन्मदिन · ✋ जाँचना है.
Back: 3-step pictures for "फीस लें" and "कॉल करें → बटन दबाएँ"; "हाज़िरी फ़ोन बंद हो तो: 1) चार्जिंग देखें 2) फोन बंद-चालू करें 3) स्टाफ से हाज़िरी लगवाएँ 4) {vendor number} पर WhatsApp करें".

## 4. Reception scripts
**QR drive (Hindi):** "सर/मैडम, हम डिजिटल रजिस्टर बना रहे हैं। एक बार ये QR स्कैन कर लीजिए, 1 मिनट लगेगा — फिर फीस खत्म होने से पहले WhatsApp पर याद दिला दिया जाएगा, और हाज़िरी भी अपने-आप लगेगी।"
**Face consent question:** "क्या आप चाहते हैं कि फोन आपका चेहरा पहचानकर हाज़िरी लगाए? नहीं चाहते तो कोई बात नहीं, हम हाथ से लगा देंगे।"
**Expired member at kiosk:** "नमस्ते! आपकी फीस {date} को खत्म हो गई थी — अभी रिन्यू कर दें? कैश या UPI?"

## 5. Handover package
- Admin access: Owner account; vendor super-admin (with audit) documented.
- Accounts owned by gym: domain, WhatsApp Business Account, Meta Business Manager, Razorpay, Google Business Profile; vendor added as partner/developer.
- Credentials delivered in a password manager share, not WhatsApp text.
- Documents: this blueprint, UAT sign-off, runbook, support SLA, processor agreement.
- Support terms: channel (WhatsApp group), hours, response times by severity (testing-strategy §9), monthly report.

## 6. 30-day hypercare
- Week 1: daily 10-minute check-in call; review calls cleared, messages, kiosk accuracy.
- Weeks 2–4: twice weekly; tune reminder cap, alerts, words/icons that confused the owner.
- Day 30 report: KPIs vs PRD targets, issues fixed, backlog for 1.1.


## 7. Demo script (appendix — 2026-09-12)

Run `pnpm db:seed` first: it rebuilds clean demo data (about 215 members, real fee states, this month's collections) and removes anything left by testing. Start the app with `pnpm dev` and the worker with `pnpm --filter @mfp/worker dev`.

Payments are in **demo mode** (ADR-037): the pay button opens an in-app dialog instead of Razorpay. No money moves. Real Razorpay keys go in at delivery.

| # | Do this | Expect |
|---|---|---|
| 1 | Open `/` on a phone-sized window | Landing page, hero, fee board; English with a हिंदी toggle |
| 2 | Tap **Sign up** | The sign-up sheet opens over the page; the page stays behind it |
| 3 | Fill name, mobile, date of birth, Male/Female; tap **Take selfie** → **Open camera** | Camera explainer first, then the oval guide and "Face found" |
| 4 | Take the photo → **Use this photo**, tick the Terms box, **Continue to plans** | Step 2 in the same sheet, with the plan chosen on the landing page already selected |
| 5 | **Continue to payment** → **Pay ₹…** → **Simulate success** | Confirmation: member code, dates, receipt number, WhatsApp line |
| 6 | Tap **Download receipt** | The receipt page: gym details, receipt number, amount in words |
| 7 | Open `/crm` and log in as **9000000001 / 2468** | Max Register Home in Hindi: tiles, आज के कॉल, जन्मदिन, इस महीने का हिसाब |
| 8 | Tap **फीस बाकी** | The members whose fees are overdue, red band and "X दिन से बाकी" |
| 9 | Open a member → **₹ फीस लें** | Plan tiles for their gender with the new dates |
| 10 | Plan → **कैश** → **हाँ, मिल गया** | "रिन्यू हो गया", receipt number and member code |
| 11 | Log out, log in as reception **9000000002 / 1357** | The same Home **without** the money section (money is owner-only) |

Not built yet, so do not open them in a demo: add member at the desk, call outcomes, verification queue, attendance marking, leads, reports and settings. Those tabs show a plain "coming soon" screen.
