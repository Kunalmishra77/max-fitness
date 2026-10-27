# Max Fitness Gym's member assistant — knowledge base *(the client's bot)*

> **This is the bot inside a gym's own system, answering that gym's members.** V4You's
> sales bot, which answers gym owners who reply to the product ads, is
> `v4you-sales-bot-knowledge-base.md`.

What to paste into **Max Register → WhatsApp assistant → Documents**, one document at a
time. Everything here was read from the gym's own system on 2026-10-27.

---

## How the assistant uses this

The bot is told, in its own instructions: *"Only what the gym has written below. It is the
single source for prices, timings, rules and policies. **Never invent** a price, a timing,
an offer or a policy. If the answer is not written below, you do not know it."*

When it does not know, it replies `[[ASK_STAFF]]` and a person at the gym takes over.

Three things follow from that, and they are the whole reason this document exists:

1. **Anything you leave out, the bot hands to a human.** That is the safe failure, not a
   gap to be filled in with something plausible. A missing answer costs one WhatsApp
   reply; a wrong price costs an argument at the desk.
2. **Anything you write here, the bot will say — exactly, and to everybody.** Write it as
   you would want it read aloud to a stranger.
3. **Order matters.** Documents are read oldest first and cut off at 24,000 characters.
   Create them in the order below, so if anything is ever dropped it is the least-asked.

**Never put a member's own details here.** The bot has no business knowing whether
Suresh's fees are paid, and its instructions already forbid discussing anybody but the
person writing.

---

## ⚠️ Fix these before you paste

Three places where the website and the live system disagree. The bot will repeat whichever
you give it, so settle them first.

| What | Website says | Max Register says | |
|---|---|---|---|
| **Personal training** | ₹3,000 a month | **₹5,000** a month | Decide which is true. This KB uses ₹5,000. |
| **Trying before joining** | "your first session is free" | a paid trial, **₹100 a day** | Both can be true — a free look around, a paid day of training. This KB says exactly that; change it if it is wrong. |
| **The address** | Krishan Plaza, Plot No. 6, Abhay Khand 1 | C-6, Krishna Plaza | Not the same line. Fix one. |

And four facilities nobody has confirmed — **lockers, drinking water, parking,
air-conditioning**. They are left out on purpose, so the bot escalates instead of
promising something that may not be there.

---

## Document 1 — Timings and where we are

> **Title:** Timings and where we are
>
> We are open Monday to Saturday, 4:30 am to 10:00 pm.
> We are closed on Sunday.
>
> Max Fitness Gym, Krishan Plaza, Nyay Khand I, Indirapuram, Ghaziabad 201014.
> We are opposite Sai Mandir.
>
> Phone: 098714 06350.
>
> There is no need to book a time. Come whenever we are open.

## Document 2 — Membership fees

> **Title:** Membership fees
>
> Men: ₹1,500 for one month, ₹4,000 for three months, ₹6,000 for six months, ₹10,000 for
> twelve months.
>
> Women: ₹1,200 for one month, ₹3,500 for three months, ₹5,000 for six months, ₹8,000 for
> twelve months.
>
> There is no joining fee and no admission fee. The price above is the whole price.
>
> The longer the plan, the less each month costs. Twelve months works out cheapest.
>
> These fees are for the gym floor with trainer guidance. Personal training is separate.

## Document 3 — Trying the gym before you join

> **Title:** Trying the gym before you join
>
> You are welcome to walk in, see the floor and talk to the trainers before you pay
> anything.
>
> If you want to actually train before deciding, we have a trial at ₹100 a day. You can
> take 1, 2, 3, 5 or 7 days.
>
> Come any time we are open. There is no appointment needed.

## Document 4 — Personal training

> **Title:** Personal training
>
> Personal training means a trainer works with you one to one, plans your workouts and
> watches your form.
>
> It costs ₹5,000 for one month, ₹13,500 for three months, ₹24,000 for six months and
> ₹36,000 for twelve months. The price is the same for men and women.
>
> This is in addition to your membership.
>
> A diet plan is included.

## Document 5 — If you have never been to a gym

> **Title:** If you have never been to a gym
>
> That is completely fine. Most of our members started the same way.
>
> The owner, Ajay Kuliyal, trains on the floor himself, along with the other trainers.
> They will show you how each machine works and plan your first weeks so you start
> safely and do not get hurt.
>
> You do not need to know anything before you come.
>
> Bring a water bottle, a small towel and clean indoor shoes.

## Document 6 — What the gym has

> **Title:** What the gym has
>
> Strength: machines, free weights, benches, and full-length mirrors so you can check your
> own form.
>
> Cardio: treadmills and recumbent bikes, in their own area.
>
> Functional floor: battle ropes, step platforms and agility cones on an open wooden floor.
>
> We also offer personal training and diet plans.
>
> We have been in Nyay Khand since 2000.

## Document 7 — How to join and how to pay

> **Title:** How to join and how to pay
>
> You can join at reception, or sign up on our website.
>
> You can pay online by UPI, card or netbanking, or pay at reception by cash or UPI.
>
> When you join we take a photo of you. It becomes your member photo so the staff
> recognise you. If you agree, the attendance phone at reception can also mark your
> attendance using it. You can say no, and staff will mark your attendance by hand
> instead.
>
> The minimum age is 16. Anyone under 18 needs a parent or guardian to sign at reception.

## Document 8 — Diet plans

> **Title:** Diet plans
>
> We make diet plans for members. A plan is made for you based on your goal, and a trainer
> checks in on it regularly.
>
> A diet plan is included with personal training.
>
> We do not give medical advice. If you have a health condition, please speak to your
> doctor first and tell the trainer.

## Document 9 — Renewal

> **Title:** Renewal
>
> We will message you on WhatsApp before your membership ends, so you have time to renew.
>
> If you renew while your membership is still running, your new plan starts the day after
> the old one ends — you do not lose the days you paid for.
>
> You can renew at reception, or from the link in the WhatsApp message we send you.

## Document 10 — How to reach a person

> **Title:** How to reach a person
>
> If you want to talk to someone at the gym, call 098714 06350, or send a message here and
> a person will reply.
>
> For anything to do with changing, cancelling or refunding a payment, a person at the gym
> will handle it — not this assistant.

---

## Deliberately not written down

Each of these would make the bot answer when it should fetch a human. Add one only when
the owner has decided the answer and is happy for it to be said to everybody.

| Question members will ask | Why it is not here |
|---|---|
| "Can I pause my membership if I travel?" | No policy decided |
| "Can I get a refund?" | No policy decided — the Refund & Cancellation page is still a draft |
| "Is there a women's changing room or washroom?" | A 2025 review says there is none. Do not answer this until the owner confirms what exists today. |
| "Is there parking? Lockers? Drinking water? Is it air-conditioned?" | All four unconfirmed |
| "Is there a boxing area?" | **There is none.** The owner confirmed this on 2026-09-25. If members keep asking, add a document that says so plainly. |
| "Do you have a discount / any offer running?" | Offers change. Put one here only while it is running, and **delete it the day it ends** — the bot has no sense of time and will keep offering it. |

---

## The assistant's own settings

On the same screen, above the documents:

- **Name** — what it calls itself. "Max Fitness Gym" is better than a pet name; members
  should know they are talking to the gym.
- **How to sound** — suggested: *"Warm and brief, like the person at the reception desk.
  Short sentences. Never pushy."*
- **Languages** — Hindi and English. It replies in whichever the member used.
- **What to say when it escalates** — suggested: *"मैं इसके लिए जिम से किसी को बोल देता हूँ,
  वो आपको जल्दी जवाब देंगे।"*

---

## After it is live

**Read what it actually said.** Max Register → Messages shows every reply the assistant
sent, in the member's own thread. For the first week, read them.

Two things to watch for:

- **A wrong answer** — fix the document it came from, not the bot.
- **The same question escalating over and over** — that is a document waiting to be
  written. The bot is telling you what the gym has not decided yet.

Review the whole set whenever a price changes, and at the start of every month.
