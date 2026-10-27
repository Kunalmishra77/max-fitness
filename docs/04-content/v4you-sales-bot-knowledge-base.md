# V4You sales assistant — knowledge base

What the bot answering **ad leads** needs to know. The leads are gym owners who saw the
advertisement and sent a WhatsApp message.

Not to be confused with `bot-knowledge-base.md` in this folder, which is the **member-facing**
assistant inside a gym's own system. Different bot, different reader, different answers.

---

## 0. The job, and its limits

This bot does **one** thing: answer a gym owner's first questions well enough that he agrees
to a demo. It does not sell, quote or negotiate.

Three rules it must be given, in its own instructions:

1. **Never quote a price.** There is no price list. A number invented here is one you have
   to honour or retract, and either is worse than "let me get you a proper quote".
2. **Never promise a feature that is not in section 2.** A gym owner who is told there is a
   member app will ask for it on the demo call, and the call ends there.
3. **Hand over early.** Anything about money, timelines, contracts or "can it also do…" goes
   to a person. The bot's success is a booked demo, not a long conversation.

**The ask, every time:** *"आपके जिम के हिसाब से दिखा देते हैं — कब बात कर सकते हैं?"*

---

## 1. Settle these first

The bot will be asked all three in its first week. Decide them before it is live.

| Question | Status |
|---|---|
| **What is the product called?** | Undecided. Everything is named after the first customer — Max Register, Max Fitness Platform. Written below as `<PRODUCT>`. |
| **What does it cost?** | Undecided. The bot says so honestly and offers a quote; see Document 7. |
| **How long does setting up take?** | One deployment serves one gym today, so each customer is set up by hand. You know how long that took for Max Fitness Gym — put the real number in Document 6. It is written as `<N>` days. |

---

## 2. The documents

Paste one at a time. **Order matters** if your assistant truncates — most-asked first.

### Document 1 — What this is

> **Title:** What this is
>
> `<PRODUCT>` is software for running a gym, made by V4You.
>
> It does four things. It sends your members WhatsApp reminders before their fees are due,
> so renewals stop getting missed. It gives you one screen showing who came today, whose
> fees are pending and how much came in this month. It marks attendance automatically using
> the member's face, on an ordinary mobile — no turnstile and no new machine. And it lets
> new members fill their own details from a QR code, so your staff only have to approve.
>
> It is in Hindi, with English available, and it is built for a mobile.
>
> It is already running at a gym in Indirapuram, Ghaziabad.

### Document 2 — Reminders and renewals

> **Title:** Reminders and renewals
>
> `<PRODUCT>` messages a member on WhatsApp before their fees are due — 7 days before, 3
> days, 2 days, 1 day, and on the day itself. If they still have not paid, it follows up for
> up to a week afterwards. You set how many days.
>
> Messages only go between 8 am and 9 pm, and there is a limit per number per day, so a
> family sharing one phone is not flooded.
>
> If a member pays, the reminders stop immediately. If a member asks to stop, they stop and
> stay stopped.
>
> Whoever does not respond appears on your call list the next morning, with the reason they
> are on it and what was said the last time you called.
>
> These are official WhatsApp Business messages on approved templates, not a personal number
> sending bulk messages.

### Document 3 — What you can see

> **Title:** What you can see
>
> One screen shows: how many members you have, who came in today, whose fees are due this
> week, whose have already lapsed, how much money came in this month compared to last month,
> and whatever is waiting for your approval.
>
> Members: search by name, number or code. Each member has their plan, their payments, their
> attendance and their ID on file.
>
> Attendance: a month calendar, or any week, month, year or dates you choose. With a chart,
> and a download.
>
> Reports: money, new members, renewals, personal training, trials, how many renewed, who
> left, which hours are busiest, which plans sell, and what difference the reminders made.
> Over any period you choose, and downloadable.
>
> Enquiries: every enquiry, where it came from, and how many of them became members.
>
> There is also a record of who changed what and when.

### Document 4 — Attendance

> **Title:** Attendance
>
> A mobile or tablet kept at your reception counter recognises the member's face and marks
> their attendance. Nothing to press, nothing to carry.
>
> You do not need a turnstile, a fingerprint machine or any new hardware. An ordinary
> Android phone is enough.
>
> If a face does not read — a cap, poor light — the member types their number on a keypad
> instead.
>
> A member who does not want face attendance can refuse, and your staff mark them by hand.
> Face data is stored encrypted and is deleted when a member leaves.

### Document 5 — New members and payments

> **Title:** New members and payments
>
> You put a QR code at your reception. A new member scans it and fills in their own details
> on their own phone — name, number, photo and ID. Your staff only have to approve it.
>
> The ID photograph is checked automatically: that it is the card they said it was, and that
> the name and date of birth match what they typed. The ID number itself is never stored.
>
> The same face cannot join twice under a different name.
>
> Members can pay by UPI, card or netbanking, or in cash at your desk. Cash is recorded too.
> Receipts are numbered and sent on WhatsApp.
>
> If you want, fees can be collected automatically every month through a UPI mandate.
>
> You also get a website for your gym, where people can find you and sign up.

### Document 6 — Getting started

> **Title:** Getting started
>
> We set your gym up for you. It takes about `<N>` days.
>
> What we need from you: your gym's details and timings, your plans and prices, and a mobile
> number for the WhatsApp messages.
>
> If you already have a register or an Excel sheet of members, we import it — you do not
> start from an empty list.
>
> WhatsApp messages need Meta's approval first, which usually takes a day or two. We handle
> that.
>
> The best place to begin is a demo: we show you the whole thing on a call, using a gym's
> worth of real-looking data, and you decide after that.

### Document 7 — Price

> **Title:** Price
>
> The price depends on how many members your gym has and what you want switched on, so we
> give you a proper figure rather than a number off a list.
>
> Tell us roughly how many members you have and we will come back with it the same day.
>
> There is nothing to pay to see the demo.

### Document 8 — What it does not do

> **Title:** What it does not do
>
> There is no separate mobile app for members. Members get WhatsApp messages and a web page.
>
> There is no class or slot booking.
>
> It does not connect to a turnstile or a gate.
>
> It runs one gym at a time. If you have more than one branch, each is set up separately —
> tell us and we will explain how that works for you.
>
> It does not produce GST invoices.
>
> If you need any of these, say so and we will tell you honestly whether it is coming.

### Document 9 — Is my data safe

> **Title:** Is my data safe
>
> Your members' data is yours. It is kept on servers in India, and each gym's data is
> separated at the database level.
>
> We never store an ID card number — only the photograph, and only while it is needed.
>
> Face data is encrypted, is never shared, and is deleted when a member leaves your gym.
>
> Members are told what is collected and can refuse face attendance.
>
> You can export your members at any time.

### Document 10 — Who we are

> **Title:** Who we are
>
> We are V4You. We built this for a gym in Indirapuram, Ghaziabad that has been running
> since 2000, and it is in use there every day.
>
> We are not a large company and you will deal with the people who built it.

---

## 3. Deliberately not written down

The bot escalates on each of these, which is the right answer.

| Asked | Why a person takes it |
|---|---|
| "Exactly how much?" | No price list. Document 7 says so and asks for the member count. |
| "Can you add X?" | A roadmap promise is a commitment. A person makes those. |
| "Can I see it?" | Book it with a person — that is the whole point of the bot. |
| "Do you have a contract / refund policy?" | Not written yet. |
| "Can it run my 3 branches?" | Depends on their setup, and the honest answer today is "separately". A person explains it. |
| "Who else uses it?" | One gym. Say that on a call, with the owner's permission, or not at all. One honest reference beats a vague "several gyms". |

---

## 4. Settings for this bot

- **Name:** `<PRODUCT>` — so the lead knows who answered.
- **How to sound:** *"Brief and straightforward, like someone who builds the thing. Short
  sentences. Never pushy. Always offer to show it rather than describe it."*
- **Languages:** Hindi and English, replying in whichever was used.
- **On escalation:** *"मैं अभी किसी को बोलता हूँ, वो आपको थोड़ी देर में मैसेज करेंगे।"*

---

## 5. After it is live

Read every conversation for the first two weeks. Two things to look for:

- **The same question escalating repeatedly** — that is a document waiting to be written,
  or a decision V4You has not made yet. Usually the second.
- **A lead who asked a good question and went quiet** — that is the ad promising something
  the product does not do. Fix the ad, not the bot.

Review the whole set whenever the product changes, and whenever a price is finally decided.
