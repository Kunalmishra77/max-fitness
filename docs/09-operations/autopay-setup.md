# Autopay (e-mandate) — what is in Razorpay's dashboard, and what is in the code

Autopay lets a member's fee arrive on its own. Razorpay calls it a **subscription**; a member's
bank or UPI app calls it a **mandate**; this document calls it autopay, which is what the gym
calls it. The rules behind it are ADR-105.

There is no `mandate.*` webhook event in Razorpay. Everything about a standing instruction —
the member authorising it, each debit, a failure, a halt — arrives as a `subscription.*` event.

## 1. Razorpay dashboard — the one-time setup

**Subscriptions must be enabled on the account.** Done: Settings → the Subscriptions product.
Nothing in this feature works without it, and the dashboard says plainly whether it is on.

**Plans are created by script, never by hand.** A Razorpay plan is immutable once created —
neither the amount nor the cycle can be edited, only deactivated — so a hand-typed amount is a
mistake that cannot be corrected, only abandoned, and it still shows in the list afterwards.

```
pnpm --filter @mfp/worker run create:razorpay-plans          # says what it would create
RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=... \
  pnpm --filter @mfp/worker run create:razorpay-plans -- --yes
```

It reads the gym's own plan rows, creates one Razorpay plan for each, checks the amount
Razorpay echoes back against the register, and only then writes the id onto `Plan.providerPlanId`.
All sixteen exist as of 2026-10-05: eight membership, eight personal training.

Its dry run needs no payment credentials, which is the point — the live keys live in the host's
environment and never in `.env`, so a machine that cannot create a plan can still answer which
ones are missing and at what price.

## 2. Webhook events

URL: `https://maxfitnessgym.co.in/api/v1/webhooks/razorpay`. The signing secret is
`RAZORPAY_WEBHOOK_SECRET` in the host's environment, and it has been verified against
production: a body signed with it is accepted, a body signed with anything else gets a 401.

**Subscribed, and needed:**

| Event | What it does here |
|---|---|
| `payment.captured` | confirms a one-off payment (the ordinary checkout path) |
| `payment.failed` | records why a one-off payment did not go through |
| `subscription.charged` | **an autopay debit** — becomes a `Payment` row and extends the membership |
| `subscription.halted` | **Razorpay gave up** — alert, WhatsApp to the member, call task |

**Worth adding, and why:**

| Event | What goes wrong without it |
|---|---|
| `subscription.activated` | we never learn the member authorised. Their mandate stays `CREATED`, so the fee reminders keep going out until the first debit lands a cycle later — correct behaviour on wrong information. |
| `subscription.cancelled` | a member who cancels from their own UPI app still reads as paying here until something else corrects it. |
| `subscription.pending` | a debit being retried looks like nothing is happening. |

Each is one checkbox. Until they are added, `sync:mandates` is the correction:

```
RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=... \
  pnpm --filter @mfp/worker run sync:mandates          # says what it would change
```

It asks Razorpay what every unsettled mandate is actually doing and writes it down **through
the domain**, so a halt discovered this way raises the same alert, sends the same message and
opens the same call task as one that arrived by webhook.

## 3. What the member and the desk see

**A new member**, on the confirmation screen after paying: "Want next time's fee to pay itself?"
Nothing is taken that day — the offer states the date, which is the day after the term they have
just paid for ends. Tapping it creates the mandate and shows the link to approve; approving
happens in their own UPI app or with their bank.

**An existing member**, from their profile in Max Register: *Automatic fee payment* → *Set up*.
That one also WhatsApps them the link, so they do not have to be at the desk.

**The desk** sees the state on the member's profile, above the payment history. Four things
matter about that panel:

- A mandate waiting for approval says so. It is **not** shown as live, because treating an
  unopened link as a signed mandate is what would stop the gym chasing a fee that is never coming.
- A halted mandate is explained, not just named: "the bank could not take the fee — collect it
  at the desk." A halt is otherwise invisible, since every other thing on the page still says the
  member is paid up.
- The link is on screen for as long as Razorpay considers it usable.
- Reception can set one up and stop one. Stopping is the more consequential half, but a member
  can cancel from their own UPI app whenever they like, so making them wait for the owner would
  add friction without adding protection.

## 4. The rules worth knowing

- **The first debit is never today.** It is the day after the member's current cover ends —
  whether that cover is a trial, a month, or a year. Charging for cover already held would be
  taking the same money twice.
- **A live mandate stops the fee reminders**, checked at send time rather than when the slot was
  planned. The two trial check-ins still go out: they are not about money.
- **One live mandate per member.** Asking for a second returns the first, link included. Two
  would debit the same fee twice.
- **A debit becomes an ordinary payment.** Receipts, the day book, the fee state and the
  membership extension all work without knowing a mandate exists.
- **Money that arrives is always recorded.** An unexpected amount, or a debit on a mandate the
  desk had cancelled, is recorded *and* raised as an alert. A member who has been debited and
  shows as unpaid is worse than a number somebody has to look at.
