# V4You — Meta ads brief for the gym platform

Advertising **the product** to gym owners. Max Fitness Gym is the first customer and the
proof, not the advertiser.

Replaces the earlier draft in this folder, which advertised the gym itself.

---

## 0. Three things to settle before a rupee is spent

These are not details. Each one changes what the ad can say.

### 1. The product has no name

Everything is named after the first customer: **Max Fitness Platform**, **Max Register**,
**Max Haazri**. Selling "Max Register" to Iron Paradise in Vaishali reads as somebody
else's software — because it is.

The gym-facing names can stay for Max Fitness Gym. The product needs its own. Until it has
one, this brief writes **`<PRODUCT>`**, and every place it appears needs one decision, not
ten.

### 2. There is no price

Nothing in the project records what a gym pays. So the ad must **not** quote one, and the
call to action is a conversation, not a checkout. That is the right ask at this stage
anyway: a gym owner buying software wants to see it, and you want to know what their gym is
like before you quote.

### 3. One deployment currently serves one gym

The database is built for many gyms — every table carries a gym, row-level security is on —
but the application reads **one** gym from a setting at boot. Today, ten customers means ten
deployments.

That is fine for the first ten and it decides what you may promise:

- **Can say:** "We set your gym up for you." "You are running in a few days."
- **Cannot say:** "Sign up and start in five minutes." It is not true yet, and a gym owner
  who tries it will find out first.

---

## 1. Who the ad is for

A gym owner in India running **one or two gyms, 100–600 members**, who:

- keeps members in a **register, a notebook, or a WhatsApp group**
- finds out somebody stopped coming when they stop paying
- chases renewals by scrolling his own phone, when he remembers
- has tried a gym app before and stopped, because the staff would not use it

**Not** chains, not boutique studios, not anyone with existing gym software they like.

### What actually hurts him

In order. The first one is the ad.

1. **Renewals leak.** Members' fees expire and nobody notices for a fortnight. Each one is
   real money that was already earned and then lost to forgetting.
2. **He cannot see his own gym.** Who owes money today, who stopped coming, what last month
   came to — all of it is in a book, or in his head.
3. **Enquiries vanish.** Someone calls, nobody writes it down, nobody calls back.
4. **Attendance is nobody's job.** The register gets filled in later, or not at all.

> **Lead with renewals.** It is money he has already earned and is losing, which is a
> sharper feeling than money he might earn. Everything else is the second conversation.

---

## 2. What the product actually does

Verified against the running system on 2026-10-27. **Do not add to this list.** Anything
claimed and then not demonstrable in the first demo call costs more than it won.

### Renewals and WhatsApp — the headline

- Reminders on Meta's official WhatsApp API, on approved templates: **7, 3, 2 and 1 days
  before** expiry, **on the day**, and for up to **7 days after**.
- Every rule is checked again **at the moment of sending** — a member who renewed an hour
  ago is not chased, and neither is one who asked to stop.
- **Quiet hours** (8 am–9 pm) and a **cap per number per day**, so a family sharing a phone
  is not buried.
- **Unsubscribe and restart** handled by the member, in the message.
- Receipts, welcomes and birthday wishes, all on approved templates.
- A **daily call list** of whoever the messages did not reach, with the reason each person is
  on it and what was said last time.

### The owner's screen — Max Register

- **Today**: members, who came in today, fees due this week, fees overdue, the month's
  money against last month, and the queues waiting on him.
- **Members**: search by name, number or code; fee state visible down the whole list; full
  profile with plan, payments, attendance and ID on file.
- **Attendance**: a month calendar, any week, month, year or dates you pick, a trend chart,
  and a CSV.
- **Reports**: fourteen figures — money, new members, renewals, personal training, trials,
  diet, the renewal rate, who left, busy hours, plan mix, and what the reminders changed —
  over a week, a month, a year or a custom range, with a CSV.
- **Enquiries**: every lead, where it came from, and **how many became members**.
- **Messages**: an inbox by person. What the gym sent, when, and whether it arrived.
- **Audit trail**: who changed what, and when.
- **Hindi first**, English on a toggle. Built for a phone, works on a desktop.
- **Staff roles**: a trainer sees members, a receptionist takes money, the owner sees money
  and settings. Unlocked by PIN.

### Members join themselves

- A **website** with online sign-up: UPI, card or netbanking.
- A **QR poster** at reception. A member fills the form on their own phone — details,
  photo, ID — and staff only approve it.
- The ID photograph is **read and checked**: that it is the card they chose, that the name
  matches, that the date of birth matches.
- **The same face cannot join twice** under a different name.
- **The ID number is never stored.** Only the photograph, and only while it is needed.

### Attendance without anybody doing anything

- **Face recognition at reception** on an ordinary phone or tablet — no turnstile, no
  separate hardware, no Android app to install.
- A **keypad fallback** when a face will not read.
- Face data is **encrypted**, kept private, and deleted when a member leaves.
- A member may **refuse** face attendance and be marked by hand.

### Money

- Online payment by UPI, card or netbanking; or cash at the desk, recorded.
- **Automatic monthly payment** by UPI mandate, for gyms that want it.
- Receipts numbered and sent on WhatsApp.

### Also there

Diet plans with follow-ups · personal training sold and tracked separately · announcements
to all members · a WhatsApp assistant that answers members' common questions and hands
anything else to a person · importing an existing paper register · website photo gallery
managed by the owner.

### What it does not do — say so early

No member app. No class booking. No turnstile. No multi-branch screen. No GST invoicing.
A gym owner who needs those should hear it on the first call, not the third.

---

## 3. The 60-second script

One idea: **"Aapke kitne members ki fees nikal gayi, aur aapko pata bhi nahi?"**

The ad is a demonstration, not a mood film. A gym owner buys software after he sees it do
the thing he cannot do today.

**This is where AI video genuinely helps** — unlike a gym ad, the hero footage here is
**screen recordings of real software**, which you can record from the running system in an
afternoon. AI does the b-roll, the titles and the transitions. Nothing has to be invented.

| # | Time | On screen | Voice (Hindi) | Text on screen |
|---|---|---|---|---|
| 1 | 0:00–0:05 | A hand turning the pages of a gym register, pen marks, some rows crossed out | *"आपके कितने मेंबर्स की फीस निकल गई — और आपको पता भी नहीं?"* | — |
| 2 | 0:05–0:10 | Same register, one finger stops on a row; the date beside it is a month old | *"रजिस्टर बता नहीं सकता। याद भी नहीं रहता।"* | **Renewals leak quietly** |
| 3 | 0:10–0:20 | **Screen recording:** Today screen loading — members, fees due, overdue, this month's money | *"`<PRODUCT>` खोलिए। आज कौन आया, किसकी फीस बाकी है, इस महीने कितना आया — एक स्क्रीन पर।"* | **Your whole gym, one screen** |
| 4 | 0:20–0:30 | **Screen recording:** WhatsApp reminder arriving on a member's phone, then the Messages inbox showing it delivered and read | *"फीस खत्म होने से पहले मेंबर को WhatsApp अपने आप चला जाता है। आपको कुछ नहीं करना।"* | **Reminders go by themselves**<br>7, 3, 2, 1 days before · on the day · after |
| 5 | 0:30–0:38 | **Screen recording:** the calls list, with each member's reason and last outcome | *"जो जवाब न दे, उसकी लिस्ट सुबह आपके सामने होती है — किसे, क्यों, और पिछली बार क्या कहा था।"* | **A call list that knows why** |
| 6 | 0:38–0:46 | **Phone at a reception desk:** a member walks up, the screen recognises the face and marks them | *"हाज़िरी के लिए कुछ नहीं करना। मोबाइल पर चेहरा, और हाज़िरी लग गई।"* | **Attendance, by itself**<br>No turnstile. No new machine. |
| 7 | 0:46–0:54 | **Screen recording:** the QR poster, then a member filling the form on their own phone | *"नया मेंबर QR से ख़ुद अपनी डिटेल भरता है। आपका स्टाफ़ सिर्फ़ 'हाँ' करता है।"* | **Members fill their own form** |
| 8 | 0:54–1:00 | End card: logo, one line, WhatsApp button | *"`<PRODUCT>` — V4You की तरफ़ से। अपने जिम के लिए डेमो देखिए, WhatsApp कीजिए।"* | **`<PRODUCT>` by V4You**<br>**See a demo — WhatsApp us** |

### 15-second cut, for Reels

Scenes 1 → 4 → 8. *"फीस निकल गई और पता नहीं चला? `<PRODUCT>` मेंबर को अपने आप WhatsApp कर
देता है। डेमो के लिए मैसेज कीजिए।"*

### Why it opens on a register and not on software

A gym owner recognises the register. He does not yet recognise your software. Five seconds
of his own problem buys the next fifty of your answer.

---

## 4. What to record, and what to let AI make

### Record yourself — about an hour

Screen recordings from the running system. Use the **demo gym**, never a real member's
data — real names and numbers must not go into an advertisement.

| | Recording | Length |
|---|---|---|
| ☐ | Today screen loading, scrolled slowly once | 15 s |
| ☐ | A WhatsApp reminder arriving on a real phone, filmed over the shoulder | 10 s |
| ☐ | The Messages inbox, opening one member's thread, sent → delivered → read | 15 s |
| ☐ | The calls list, scrolled | 10 s |
| ☐ | Face attendance at a desk — a phone on a stand, somebody walking up | 15 s |
| ☐ | The QR poster, then the form being filled on a phone | 20 s |
| ☐ | Reports: switch week → month → year, so the figures visibly change | 10 s |

Record at **1080×1920 vertical** where you can, or record landscape and crop with the
screen centred. Hide anything real: use demo data, and blur any number that appears.

### Let AI make these

Append to every prompt:

> Cinematic, premium, calm. Deep blacks, slightly desaturated, a touch of red rim light.
> Slow confident camera, no shake, no fast cuts, no flashing. Indian gym, daytime.
> 1080×1920 vertical, 30fps. No text, no logos, no watermarks, no subtitles.

| Shot | Prompt |
|---|---|
| 1–2 | Extreme close-up of weathered hands turning the pages of a thick paper ledger on a desk, handwritten rows and columns, some crossed out, warm desk lamp, shallow depth of field, very slow push-in. |
| 6 b-roll | A phone mounted on a small stand at a gym reception counter, screen facing out, a person approaching from the side, shot from behind the counter, soft focus on the background gym floor. |
| transitions | Abstract motion background, deep black with a slow red gradient drifting from one corner, clean dark centre, seamless loop, no objects and no text. |
| end card | Minimal dark background, a soft red glow low in the frame, centre kept clean and empty for a logo. No text, no shapes, no letters. |

**Never let the video model draw text.** Every one of them misspells Devanagari. Generate
the background, add the words in CapCut, Canva or Premiere.

---

## 5. The ad copy

Three variants, one ad set, let Meta choose.

**A — renewals** *(expect this to win)*

> आपके कितने मेंबर्स की फीस निकल गई और आपको पता ही नहीं चला?
>
> `<PRODUCT>` हर मेंबर को फीस खत्म होने से पहले WhatsApp कर देता है — 7, 3, 2 और 1 दिन पहले,
> और उस दिन भी। जो जवाब न दे, उसकी कॉल लिस्ट सुबह आपके सामने।
>
> रजिस्टर बंद। हाज़िरी चेहरे से। हिसाब एक स्क्रीन पर।
>
> अपने जिम के लिए डेमो देखिए।
>
> Headline: **Renewals stop leaking**
> Description: Built for Indian gyms · Hindi first
> Button: **WhatsApp**

**B — the whole gym on one screen**

> रजिस्टर में कौन सा मेंबर कब से नहीं आया — पता लगाने में कितना समय लगता है?
>
> `<PRODUCT>` में एक स्क्रीन: आज कौन आया, किसकी फीस बाकी, इस महीने कितना आया, किसे कॉल करना है।
>
> हिंदी में। मोबाइल पर। स्टाफ़ भी चला लेगा।
>
> Headline: **Your whole gym, one screen**
> Description: Members · Fees · Attendance · Reports
> Button: **WhatsApp**

**C — attendance**

> हाज़िरी का रजिस्टर कौन भरता है आपके जिम में? और सच में भरता है?
>
> `<PRODUCT>` में मेंबर काउंटर के सामने आता है, चेहरा पहचाना जाता है, हाज़िरी लग जाती है।
> कोई turnstile नहीं, कोई नई मशीन नहीं — बस एक मोबाइल।
>
> Headline: **Attendance marks itself**
> Description: No turnstile. No new hardware.
> Button: **WhatsApp**

---

## 6. Campaign setup

| | |
|---|---|
| **Objective** | **Leads**, destination WhatsApp. A gym owner will send a message; he will not fill a form. |
| **Where** | Start with **Delhi NCR** — Ghaziabad, Noida, Indirapuram, Vaishali, Vasundhara, Faridabad. You can reach these gyms in person, and the first ten customers need visiting. Widen only when you can set a gym up without travelling. |
| **Age** | 25–55 |
| **Interests** | **Gym owner** is not an interest Meta sells. Use: *Gym · Fitness centre · Physical fitness · Small business owners · Entrepreneurship*, and expect waste. The 3–5 km radius does more work than the interests. |
| **Budget** | ₹500–800 a day. Fewer people are gym owners than are gym members, so delivery is thinner and the learning phase is slower. |
| **Placements** | Automatic. Deliver 9:16. |
| **Schedule** | All week. A gym owner is free **between 11 am and 4 pm** — the gap between the morning and evening rush. Weight the budget there if Meta lets you. |

**Before you spend:**

- Decide `<PRODUCT>`, and put it on the WhatsApp Business profile. A lead who messages and
  sees an unnamed number does not reply twice.
- Decide **who answers**, and how fast. Software leads go cold in hours, not days.
- Have a **demo you can show in ten minutes** — the demo gym with realistic data, on a
  phone, over a video call.
- Know what you will say to **"kitna lagega?"** You do not need a price list. You do need an
  answer that is not silence. See the knowledge base.

---

## 7. Before you publish

- [ ] `<PRODUCT>` decided and used consistently — ad, video, WhatsApp profile, demo
- [ ] No price quoted anywhere
- [ ] Nothing claimed that is not in §2 — especially no member app, no class booking, no
      turnstile, no GST invoicing, no multi-branch
- [ ] No real member's name, number or photograph in any frame
- [ ] "Set up for you in a few days", never "start in five minutes"
- [ ] Hindi spelling read by a person
- [ ] WhatsApp answers, and the assistant has the knowledge base loaded
- [ ] Both cuts exist — 60 seconds and 15
