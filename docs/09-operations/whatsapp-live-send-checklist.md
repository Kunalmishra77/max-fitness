# WhatsApp live-send checklist

Everything that has to be true before Max Fitness sends a real WhatsApp message to a
real member. Until every box here is ticked the platform runs in `DEMO_MODE`, where
every message goes to the in-app Message Simulator and only numbers in
`WHATSAPP_ALLOWLIST` receive anything at all (CLAUDE.md §2.7).

The order matters: Meta's approvals take days, the code changes take minutes.

---

## 1. Meta — the account and the number

Owner's job, with the vendor's help. Nothing in the code can start until this is done.

- [ ] **Meta Business account verified.** Business name, address and GSTIN match the
      gym's registration. Verification takes 2–10 working days and is rejected for
      small mismatches, so check the spelling against the GST certificate.
- [ ] **A WhatsApp Business number chosen.** It must **not** already be on the WhatsApp
      or WhatsApp Business app on anyone's phone — the number is taken over by the
      Cloud API and stops working as a normal WhatsApp. Using the gym's public number
      means losing the ordinary chat on it; a second SIM is usually the calmer choice.
- [ ] **Display name approved.** "Max Fitness Gym" — Meta rejects names that do not
      match the verified business.
- [ ] **Two-step PIN set and written down** somewhere the owner will find it in a year.
- [ ] Note the **phone number ID** and **WhatsApp Business Account ID** from the Meta
      dashboard; the code needs the phone number ID, not the phone number.

## 2. Templates — submitted and approved

All of them live in `docs/04-content/whatsapp-templates.md`; the bodies the code
renders are in `packages/integrations/src/whatsapp/templates.ts` and must match word
for word. Submit **both** languages of each. Approval is usually minutes to a day.

| # | Name | Category | Status |
|---|---|---|---|
| T1 | `mf_renewal_due` | Utility | ☐ submitted ☐ approved |
| T2 | `mf_renewal_due_today` | Utility | ☐ submitted ☐ approved |
| T3 | `mf_membership_expired` | Utility | ☐ submitted ☐ approved |
| T4 | `mf_payment_receipt` | Utility | ☐ submitted ☐ approved |
| T5 | `mf_welcome_member` | Utility | ☐ submitted ☐ approved |
| T6 | `mf_verification_approved` | Utility | ☐ submitted ☐ approved |
| T8 | `mf_login_code` | Authentication | ☐ submitted ☐ approved |
| T9 | `mf_owner_daily_digest` | Utility | ☐ submitted ☐ approved |
| T10 | `mf_owner_alert` | Utility | ☐ submitted ☐ approved |
| T11 | `mf_birthday_wish` | Marketing | ☐ submitted ☐ approved |
| T12 | `mf_announcement` | Marketing | ☐ submitted ☐ approved |

- [ ] **Sample values given for every variable.** A template submitted without them is
      rejected without explanation.
- [ ] **No promotional wording in a Utility template.** "Renew to keep your workouts
      going" is fine; "special offer" makes it Marketing, which costs more and needs
      marketing consent.
- [ ] **T12 carries the owner's own words in `{{2}}`,** so its sample value must read
      like a real announcement ("Closed tomorrow for Diwali."). It is Marketing however
      harmless it sounds, so a member without WhatsApp opt-in never receives one
      (ADR-079).
- [ ] **T10 is a single `{{1}}` body.** Meta sometimes rejects that shape. If it is
      rejected, register the three explicit templates named in the templates doc
      (`mf_owner_alert_expired_visit`, `mf_owner_alert_new_lead`,
      `mf_owner_alert_payment`) and map them in `alertSentence`.
- [ ] Record the approval date of each in `docs/10-delivery/decision-log.md`, because a
      template edited after approval goes back into review.

## 3. Code — the one thing still to build

- [ ] **`MetaCloudWhatsAppProvider` is a typed stub and must be written** before any
      real send. It is deliberately unimplemented: writing an API client against
      documentation we could not fully verify, for a number that does not exist yet,
      would have been guesswork. It needs the Cloud API's current message endpoint,
      its error shape, and its rate-limit headers — read them from Meta's live docs at
      the time, not from memory.
- [ ] Its `send` and `sendText` must map provider errors onto the outcomes the rest of
      the system already understands: `SENT` with a provider message id, `FAILED` with
      an error code (retryable or not). The quality codes in
      `packages/core/src/reminders/safeguards.ts` must come through unchanged, or the
      quality guard never fires.

## 4. Environment

- [ ] `WHATSAPP_PROVIDER=meta_cloud`
- [ ] `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`,
      `WHATSAPP_GRAPH_API_VERSION` set in Vercel **and** on the worker host.
- [ ] `WHATSAPP_VERIFY_TOKEN` set, and the same value entered in Meta's webhook config.
- [ ] Access token is a **permanent system-user token**, not the 24-hour test token.
- [ ] `DEMO_MODE=false` — **last**, after everything else on this page.
- [ ] `WHATSAPP_ALLOWLIST` kept populated with the owner's and vendor's own numbers
      during the first week, so a mistake reaches them and nobody else.

## 5. Webhook

- [ ] Callback URL `https://<domain>/api/v1/webhooks/whatsapp` registered in Meta.
- [ ] Verify token matches; Meta's GET challenge returns 200.
- [ ] Subscribed to the **messages** field (statuses and inbound messages).
- [ ] A test status callback appears in `/crm/messages` within a few seconds.
- [ ] **Run E2E journey 8b.** It skips while `WHATSAPP_APP_SECRET` is empty and starts
      running the moment it is set: it signs a real Unsubscribe tap, checks the member
      drops out of the reminder plan, and checks a tampered payload and a wrong
      signature are both refused (ADR-070).

## 6. The worker must actually be running

Nothing on a schedule happens without it. Reminders, the owner digest, the owner
alerts and the whole outbox are worker jobs.

- [ ] Worker deployed to a host that stays up (not Vercel — it has no long-running
      process). It needs `DIRECT_URL`, the session pooler on :5432.
- [ ] `/api/v1/health` reports `worker.ok = true`.
- [ ] Its heartbeat is watched, so a worker that dies at 2 a.m. is noticed before the
      owner asks why nobody was reminded.

## 7. Before the first real send

- [ ] Open **Messages → मैसेज का हिसाब** and read the 30-day plan. It shows exactly what
      will go out. If the number looks wrong, it is wrong — fix the rules before
      switching the provider, not after (this is how the 21-messages-a-member problem
      was found; see ADR-068).
- [ ] Check the member data: nobody with a wrong end date, nobody in `ACTIVE` who has
      actually left. A reminder to someone who left months ago is how a number gets
      reported.
- [ ] **Send to the owner's own number first.** Put only that number in the allowlist,
      let one real slot run, and read the message on a phone.
- [ ] Confirm the **Unsubscribe** button works end to end: tap it, and check the member
      is unsubscribed in the CRM and gets the confirmation.
- [ ] Confirm the **Renew now** link opens the right member's payment page.

## 8. The first week

- [ ] Watch **Meta's quality rating** daily. A drop to Medium is the warning; the
      quality guard pauses the post-expiry rule automatically on Meta's own error
      codes, but the rating is the earlier signal.
- [ ] Watch `/crm/messages` → **नहीं गए** every morning. A run of failures means
      something systemic, and the slot guard will have stopped the slot.
- [ ] Keep the **kill switch** (Settings → "सारे अपने-आप जाने वाले मैसेज बंद करें") in
      mind. It is the owner's, it needs their PIN, and it stops everything at once.

## 9. Things deliberately not done

- **"Advance time" in the simulator** (engine doc §10) is not built: it mutates real
  data and needs the worker running (ADR-067).
- **No message is ever sent to someone who has not opted in.** Imported members start
  with WhatsApp off (ADR-009) until they confirm, or the owner records desk consent.
