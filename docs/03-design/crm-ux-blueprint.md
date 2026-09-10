# Max Register — CRM UX Blueprint (for an owner with 5th-standard schooling)

## 1. Design principles

| # | Principle | In practice |
|---|---|---|
| U1 | **Faces before names** | Every member row, task and alert shows the member's photo first. The owner knows his members by face. |
| U2 | **Colour means one thing everywhere** | Green = fees paid. Amber = fees due soon. Red = fees overdue / urgent. Grey = left. Blue = information. Pink = birthday. Never reuse these colours decoratively. |
| U3 | **Numbers and icons over sentences** | "12 दिन बाकी" not "Membership valid until 22/09/2026". Money as "₹1,500". |
| U4 | **One screen, one job** | Home answers "what should I do today?". Each tile opens one list. Each list row has one main button. |
| U5 | **Big, forgiving touch targets** | Minimum 56px; primary actions 64px full-width; 16px spacing between tappables. |
| U6 | **Hindi first, voice available** | Hindi UI default with English toggle; a 🔊 "सुनें" button reads the screen summary aloud using the phone's Hindi voice. |
| U7 | **Undo instead of "Are you sure?"** | Renew, attendance, mark left show a 10-second "वापस लें (Undo)" bar. Only money deletion asks for Owner PIN. |
| U8 | **No hidden menus for daily work** | Bottom tab bar with 5 icons always visible. No hamburger for core tasks. |
| U9 | **Same word from button to result** | Button "रिन्यू करें" → toast "रिन्यू हो गया". Button "फीस लें" → "फीस मिल गई". |
| U10 | **Mistake-proof inputs** | Pickers, tiles and toggles instead of typing. Mobile numbers via numeric keypad. Dates as "आज / कल / चुनें". |
| U11 | **Confirm with sensory feedback** | Big green tick animation + short vibration on success. |
| U12 | **Light theme, very high contrast** | White background, Ink text, primary text contrast ≥ 7:1. Readable in bright reception light. |

## 2. Navigation

Bottom tab bar (icons with short labels, Hindi default):

| Icon | Hindi | English | Screen |
|---|---|---|---|
| 🏠 house | होम | Home | Today dashboard |
| 👥 people | मेंबर | Members | List + search + add |
| ₹ rupee | फीस | Fees | Due, overdue, collected |
| ✅ check-calendar | हाज़िरी | Attendance | Today, absent list |
| ••• more | और | More | Calls, Verify, Enquiries, WhatsApp, Reports, Settings |

A floating **＋** button (64px, Signboard Red) on Home and Members: "नया मेंबर / Add member".

Icons: Lucide set, each drawn inside a coloured circle matching its meaning (U2). Emoji shown above only describe the concept.

## 3. Home — "आज" (Today)

```
┌────────────────────────────────────┐
│ नमस्ते 🙏   गुरुवार, 10 सितंबर   🔊 🔔3│
├────────────────────────────────────┤
│ ┌───────────────┐ ┌───────────────┐│
│ │ 👥            │ │ ✅            ││
│ │ 214           │ │ 87            ││
│ │ कुल मेंबर      │ │ आज आए          ││
│ └───────────────┘ └───────────────┘│
│ ┌───────────────┐ ┌───────────────┐│
│ │ 🟠            │ │ 🔴            ││
│ │ 18            │ │ 11            ││
│ │ इस हफ्ते फीस    │ │ फीस बाकी       ││
│ │ ₹24,300 आएगा   │ │               ││
│ └───────────────┘ └───────────────┘│
├────────────────────────────────────┤
│ 📞 आज के कॉल (5)            सब देखें │
│ [photo] संजय तोमर   🔴 आया, फीस बाकी  │
│         [ 📞 कॉल ]  [ 💬 WhatsApp ]  │
│ [photo] नेहा गुप्ता  🟠 फॉर्म भरा, पैसे नहीं│
│         [ 📞 कॉल ]  [ 💬 WhatsApp ]  │
├────────────────────────────────────┤
│ 🎂 आज जन्मदिन (2)                   │
│ [photo] अमित  [photo] प्रिया  [ विश भेजें ]│
├────────────────────────────────────┤
│ ✋ जाँचना है (3)  QR से आए पुराने मेंबर  │
├────────────────────────────────────┤
│ ₹ इस महीने  ₹1,42,500               │
│ ▇▇▇▇▇▇▇▇▇▇▇░░  पिछला महीना ₹1,31,000 │
├────────────────────────────────────┤
│ 🏠होम  👥मेंबर  ₹फीस  ✅हाज़िरी  •••और │
└────────────────────────────────────┘
```

Tile behaviour:
- **कुल मेंबर** → Members filtered `ACTIVE`.
- **आज आए** → Attendance today.
- **इस हफ्ते फीस** (amber) → Fees: due in 0–7 days, sorted by date; shows expected ₹.
- **फीस बाकी** (red) → Fees: expired, sorted by most overdue.

Order of Home sections is fixed: Tiles → Calls → Birthdays → Verify → Money. Sections with zero items collapse to one line ("आज कोई कॉल नहीं ✓").

Voice (🔊) reads: "आज 5 कॉल हैं। 18 लोगों की फीस इस हफ्ते है। 11 लोगों की फीस बाकी है। 2 जन्मदिन हैं।"

## 4. Member row (used everywhere)

```
┌──────────────────────────────────────────────┐
│▌[photo 48px] राहुल शर्मा             12 दिन बाकी │  ▌ = 6px colour band (fee state)
│▌             MF-0112  3 महीने          ›       │
└──────────────────────────────────────────────┘
```
Expired: "6 दिन से बाकी" in red. Left: grey band, "जिम छोड़ दिया".

## 5. Member profile

```
┌────────────────────────────────────┐
│ ‹                                🔊 │
│        [ photo 120px ]              │
│         राहुल शर्मा                   │
│         MF-0112                     │
│ ┌────────────────────────────────┐ │
│ │ 🟢 फीस जमा है — 22 सितंबर तक      │ │  full-width colour card
│ │    12 दिन बाकी                   │ │
│ └────────────────────────────────┘ │
│ [📞 कॉल] [💬 WhatsApp] [₹ फीस लें]   │  three 64px buttons
├────────────────────────────────────┤
│ हाज़िरी — सितंबर                     │
│ ● ● ○ ● ● ● ○ ● ● ○ ...  (calendar dots)│
│ इस महीने 14 दिन आए                   │
├────────────────────────────────────┤
│ प्लान और पैसे                        │
│ 3 महीने  23 Jun – 22 Sep  ₹4,000 कैश │
│ 1 महीना  23 May – 22 Jun  ₹1,500 UPI │
├────────────────────────────────────┤
│ WhatsApp मैसेज  (last 5, ✓✓ status)   │
│ [ ⏸ रिमाइंडर रोकें ]                  │
├────────────────────────────────────┤
│ और: जानकारी बदलें · चेहरा जोड़ें ·      │
│     जिम छोड़ दिया · नोट लिखें          │
└────────────────────────────────────┘
```

## 6. Renew / take fees — 3 taps

**Tap 1 — plan tiles** (prices for member's gender, last plan pre-highlighted)
```
┌──────────┐ ┌──────────┐
│ 1 महीना   │ │ 3 महीने   │
│ ₹1,500   │ │ ₹4,000   │
└──────────┘ └──────────┘
┌──────────┐ ┌──────────┐
│ 6 महीने   │ │ 12 महीने  │
│ ₹7,500   │ │ ₹13,500  │
└──────────┘ └──────────┘
नया प्लान: 23 सितंबर से 22 दिसंबर तक
```
**Tap 2 — how paid**: three big icon tiles: 💵 कैश, 📱 UPI, 💳 कार्ड. (Optional "छूट / discount" small link with owner permission.)
**Tap 3 — confirm**: "₹4,000 कैश मिला?" [✓ हाँ, मिल गया] → green tick → "रिन्यू हो गया" + "रसीद WhatsApp पर भेज दी" + Undo bar 10 s.

## 7. Add member (desk)

1. 📷 Photo first (camera) — "चेहरा कैमरे में रखें"
2. Name (typed by staff; voice typing allowed)
3. Mobile (numeric keypad)
4. Gender — two big tiles with icons
5. DOB — Day / Month / Year wheels
6. Consent screen (read aloud button): WhatsApp ✓, Face attendance ✓/✗
7. Plan tiles → payment method → confirm (same as Renew)

Progress dots at top; each step one question.

## 8. Calls to make — "आज के कॉल"

```
[photo] संजय तोमर               🔴 आया, फीस बाकी (6 दिन)
[ 📞 कॉल करें ]   [ 💬 WhatsApp ]
After call → outcome tiles:
[ 👍 आएगा/रिन्यू करेगा ] [ ⏰ बाद में ] [ 📵 फोन नहीं उठाया ] [ 👋 जिम छोड़ दिया ]
```
Reason chips (colour + icon): 🔴 आया पर फीस बाकी · 🟠 फॉर्म भरा, पैसे नहीं · 🔵 नई पूछताछ · 🔴 फीस खत्म, रिन्यू नहीं · 🟣 7 दिन से नहीं आए · ⚪ अनसब्सक्राइब किया

After tapping 📞, the app returns to the same task when the call ends and shows the outcome tiles.

## 9. Verify — "जाँचें" (QR existing customers)

```
┌────────────────────────────────────┐
│ [selfie 120px]   सुरेश यादव          │
│                  98xxxx4521         │
│ प्लान: 3 महीने                        │
│ फीस इस तारीख तक जमा बताई:              │
│   ┌──────────────────────┐          │
│   │  30 सितंबर 2026        │  big     │
│   └──────────────────────┘          │
│ आखिरी फीस: ₹4,000                    │
│ [ ✓ सही है ]  [ ✎ तारीख बदलें ]  [ ✗ गलत है ] │
└────────────────────────────────────┘
```
If an imported record matches: side-by-side "रजिस्टर में: 28 सितंबर" vs "मेंबर ने बताया: 30 सितंबर" with the register date pre-selected.

## 10. Fees — "फीस"
Three segmented tabs with counts and totals: **इस हफ्ते (18, ₹24,300)** · **बाकी (11)** · **आज मिली (₹9,000)**. Each row: photo, name, date, [₹ फीस लें] button.

## 11. Attendance — "हाज़िरी"
- Today: big count, list with time and method icon (📷 face, ✋ manual).
- Tab "नहीं आ रहे": members active & paid but absent ≥ 7 days, with 📞 buttons.
- Manual mark: search → tap member → "हाज़िरी लगाएँ" → Undo bar.
- Kiosk status card: 🟢 "हाज़िरी फ़ोन चालू" / 🔴 "हाज़िरी फ़ोन बंद — 40 मिनट से".

## 12. Alerts — 🔔
Plain sentence + photo + one button:
- 🔴 "संजय अभी जिम आए, फीस 6 दिन से बाकी" [कॉल]
- 🟢 "रोहित ने ऑनलाइन ₹4,000 दिए" [देखें]
- 🔵 "नई पूछताछ: नेहा, वजन घटाना" [कॉल]
- ⚪ "सुरेश ने रिमाइंडर बंद किए — जिम छोड़ दिया" [कॉल]
- 🟠 "3 पुराने मेंबर जाँचने हैं" [जाँचें]

## 13. Reports — "हिसाब" (simple)
Cards with one number and one tiny bar each: इस महीने की कमाई · नए मेंबर · रिन्यू हुए · जिम छोड़ा · सबसे भीड़ का समय (hour bars) · आदमी/औरत · प्लान मिक्स. No tables for the owner; CSV export for the vendor/accountant.

## 14. Settings (owner only, PIN re-entry)
Prices (tile per plan with ₹ stepper), reminder times, post-expiry days (slider 1–30 with warning text), gym hours, promo banner, trust numbers, staff (add, PIN reset, permissions), attendance phone (pair/unpair), language, voice on/off.

## 15. Empty, loading, error states
- Empty: icon + one line + one button. "आज कोई जन्मदिन नहीं" (no button); "अभी कोई मेंबर नहीं" [＋ नया मेंबर].
- Loading: skeleton rows with photo circles (no spinners longer than 300 ms without skeleton).
- Offline: amber bar "इंटरनेट नहीं है — बदलाव बाद में सेव होंगे" (read-only in 1.0 except attendance mark queued).
- Error: "सेव नहीं हुआ। इंटरनेट देखें और फिर से दबाएँ।" [फिर से कोशिश]

## 16. Staff vs owner view
Staff sees the same screens minus: Reports money totals, Settings, payment deletion, data export, member delete. Hidden, not disabled (less clutter).

## 17. Co-design & validation plan
1. Paper/Figma prototype of Home, Member row, Renew, Calls, Verify — test with owner in Hindi before build (Sprint 4 start).
2. Five task test (success = unaided in < 2 min each): find a member's fee date; renew with cash; call the first person on the list and record outcome; approve a QR submission; see who came today.
3. Record observations; iterate icons/words; repeat after 1 week of real use.

## 18. Owner PWA
Installable to home screen with the Max logo; opens directly to Home; stays signed in 30 days on trusted device; notification permission for alerts (web push) as a complement to WhatsApp alerts.
