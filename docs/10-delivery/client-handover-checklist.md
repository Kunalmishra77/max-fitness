# What we need from the gym

Everything the platform cannot be finished without, and that only the gym can supply.
One page, so nothing is discovered late.

**What is deliberately *not* on this list:** the wording of any message. Every WhatsApp
message — the renewal reminders, the receipt, the welcome, the birthday wish, the owner's
digest and alerts, the announcement — is already written in Hindi and English, tuned to
this gym, and lives in `docs/04-content/whatsapp-templates.md`. The gym does not need to
draft any of it. If the owner wants a sentence changed, that is a five-minute change on
our side; it is not something they have to produce.

Also not on this list: anything we can do ourselves. Hosting setup, the database, the
website, the CRM, the QR flow, the reminder engine and all the code are ours.

Legend: **Blocking** stops something working. **Needed for launch** can wait until the
day before going live. **Nice to have** improves it.

---

## 1. Payments — Razorpay · Blocking for online payment

Right now nobody can pay online. On the reception-QR path that is by design (the client
chose "pay at reception"), but the website still offers online payment and it is
simulated. Until this section is done, `DEMO_MODE` stays on and no card or UPI payment is
real.

- [ ] **A Razorpay account in the gym's name**, KYC completed and activated for live
      payments. This is the long pole: Razorpay asks for PAN, GST or business proof, a
      bank account and address proof, and takes a few days.
- [ ] **Live Key ID and Key Secret** from the Razorpay dashboard (not the test keys).
- [ ] **A webhook secret**, and Razorpay's webhook pointed at
      `https://<our domain>/api/v1/webhooks/razorpay` with the payment events enabled.
      We will do the pointing; the secret has to come from their dashboard.
- [ ] **The settlement bank account** confirmed, so money actually lands somewhere.
- [ ] **A decision:** does the gym want online payment on the website at all? If the
      answer is "everyone pays at reception", we remove the online option from the
      website too and this whole section disappears. That is a ten-minute change and it
      is worth asking before spending days on KYC.

## 2. WhatsApp — Meta Cloud API · Blocking for every automatic message

The gym has given us a number. That is the easy part, and on its own it sends nothing.
The full sequence is in `docs/09-operations/whatsapp-live-send-checklist.md`; what the
gym has to do is here.

- [ ] **A Facebook / Meta account** we can be added to, and through it a **Meta Business
      account**. The gym owns these; we cannot create them on their behalf.
- [ ] **Business verification passed.** Meta checks the business name, address and GSTIN
      against documents. It takes 2–10 working days and is refused for small spelling
      mismatches, so the name must match the GST certificate exactly.
- [ ] **A decision about the number, and it is the one people get wrong.** The number we
      use is *taken over* by the Cloud API and **stops working as ordinary WhatsApp on
      any phone**. If the number the gym gave us is the one on the reception phone that
      members already message, using it means losing those chats. A second SIM, kept in a
      drawer, is usually the calmer choice. This needs to be said out loud before anyone
      registers anything.
- [ ] **Display name approved** — "Max Fitness Gym". Meta rejects names that do not match
      the verified business.
- [ ] **A payment method on the Meta account.** WhatsApp conversations are charged. Our
      own estimate is roughly 500 utility messages a month at current member numbers; at
      Indian utility rates that is small, but it is not free and a declined card silently
      stops every message.
- [ ] **Business profile details** for the WhatsApp account: profile photo, "about" line,
      business description, email, website, category.
- [ ] **Someone to press approve on the templates.** We submit all twelve, in both
      languages, with their sample values. Approval lands in the gym's Meta account, not
      ours.
- [ ] **A two-step PIN** set on the WhatsApp account and written down somewhere the owner
      will find it in a year.

Once those exist we need, and can collect ourselves from the dashboard the gym gives us
access to: the phone number ID, the WhatsApp Business Account ID, a permanent system-user
access token, the app secret, and a verify token we choose.

## 3. Where the reminder engine runs · Blocking, and it costs a little

Nothing on a schedule happens today. No reminder, no owner digest, no alert, no
announcement actually leaves the building — because the part of the system that does the
sending has nowhere to live. Vercel, where the website and CRM run, cannot keep a
long-running process.

- [ ] **A decision and an account** on a host that stays up — Railway, Render and Fly all
      do this for a few hundred rupees a month. We will deploy and configure it; the
      account and the card have to be the gym's, so they are not locked out of their own
      system later.
- [ ] Or, if the gym would rather not: say so, and we will say plainly what stops working
      (every automatic message) so the decision is made with open eyes.

## 4. The words and numbers on the website · Needed for launch

These are on the live site now, some of them as visible placeholders. A visitor reading
the terms today sees square brackets.

- [ ] **Real plan prices** — all eight: 1, 3, 6 and 12 months, for men and for women.
      What is live now are our placeholder figures (₹1,500 / ₹1,200 monthly and so on).
- [ ] **The joining / admission fee**, or confirmation that there is none.
- [ ] **Personal training price** — the site says ₹3,000 a month including a diet plan,
      taken from the owner's own note on Google. Confirm it is still current.
- [ ] **The refund and cancellation policy, in the owner's own words.** Live on
      `/legal/refund` and `/legal/terms` right now as
      `[Owner's policy on pausing, for example for travel or illness.]` We cannot invent
      this: it is a promise the gym is making.
- [ ] **The membership-pause policy** — same pages, same brackets.
- [ ] **Locker rules** — `/legal/terms` says `[Locker availability and rules: owner to
      confirm.]`
- [ ] **Grievance officer: name, email and phone.** Live on `/legal/privacy` as
      `[Grievance officer name]`. This one is not cosmetic — India's data protection law
      requires a named, reachable person for data complaints.
- [ ] **Opening hours confirmed.** We have Mon–Sat 4:30 am – 10:00 pm, Sunday closed.
- [ ] **The PIN code confirmed.** Google's listing says 201020; postal references and
      Justdial say 201014, which is what the site uses. Worth one look at an old bill.
- [ ] **One photograph: the boxing corner.** Eight gym photos are in place — the floor,
      cardio, the functional turf, a trainer, three of the champions. The boxing corner is
      the only slot on the live site still saying "Photo coming soon". One decent phone
      picture of the heavy bags is enough.
- [ ] **A photograph of the owner**, if the gym wants one in the Owner section rather than
      the champions pictures it uses today.
- [ ] **Promotional line**, if the gym wants the red announcement bar on the website — and
      it is worth knowing this exists, because it is the fastest way to tell *visitors*
      something without messaging members.

## 5. Security and access · Needed for launch

- [ ] **Change both staff PINs.** They are still the demo ones — owner `2468`, reception
      `1357` — and they are written down in our documentation, which means they are not
      secret. Nobody real should be added to the register until these change.
- [ ] **Who gets a login**, with names, mobile numbers and role (owner / reception /
      trainer). Trainers cannot see money or approve anything.
- [ ] **Whether reception may take payments** — an owner setting, on by default.
- [ ] **A domain name.** The system is live on a `vercel.app` address. A real domain needs
      buying and its DNS pointed at us; the gym should own the registrar account.
- [ ] **Google Business Profile access**, if the gym wants us to keep the hours and photos
      there in step with the website.

## 6. Decisions, not credentials

Each of these changes what we build next. None of them needs an account or a document.

- [ ] **Face attendance.** The client chose face recognition in the browser. We have told
      them, and repeat here, that a browser tab is the weakest place to run it: it gets
      throttled in the background, it does not reopen itself after the phone restarts,
      and it asks for camera permission again. It will demonstrate well and be fragile in
      daily use. The alternative that does work reliably is a member typing their mobile
      number at reception, which is already built. Worth one more conversation.
- [ ] **Self check-in by mobile number** — built and live at `/checkin`. Does the gym want
      a tablet at reception running it?
- [ ] **How long to chase after expiry.** Seven days at the moment, one message a day at
      7 pm. Longer keeps messaging people who have left and risks the WhatsApp number's
      standing.
- [ ] **The QR OTP switch.** Disabled for now, because a member confirming their number by
      WhatsApp code needs WhatsApp to be live. Once it is, does the gym want it? It stops
      one person filling the form with somebody else's number.

## 7. One thing we have to finish ourselves, for the record

Not the gym's to supply, listed so nobody thinks the WhatsApp work is only paperwork:
the Meta Cloud API client itself (`MetaCloudWhatsAppProvider`) is a typed stub. It was
left unwritten on purpose — building an API client against a number that does not exist,
from documentation we could not test against, would have been guesswork. It is a day's
work once the number is real, and it is on us.

The face-recognition engine is the same shape of thing: the licence question is settled
(FaceX, Apache 2.0, weights included), the matching and threshold logic is built and
tested, but the engine itself ships as C and WebAssembly with no JavaScript package, so
wiring it into the browser is its own piece of work with measurements attached.

## 8. Nice to have

- [ ] **Sentry** (error reporting) — a free account is enough, and it is the difference
      between "a member said it broke" and knowing what broke.
- [ ] **Analytics** — Plausible, Google Analytics or a Meta pixel, if the gym wants to
      know where sign-ups come from. None is required.

---

## What is finished and waiting

So the conversation is balanced: the website, the reception QR for both existing and new
members, the whole Max Register CRM (members, fees, receipts, attendance, calls,
enquiries, reports, the paper-register import, staff, settings), the reminder engine with
its rules and safeguards, the message log and 30-day forecast, the announcement feature,
and self check-in are all built, tested and deployed. They are waiting on the items above,
not on more code.
