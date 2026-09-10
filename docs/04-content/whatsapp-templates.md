# WhatsApp Message Templates

Submitted in WhatsApp Manager (or via API) **in week 0–1**. Business-initiated messages outside a 24-hour customer-service window must use approved templates. Keep reminder templates strictly **transactional (Utility)** — no offers, discounts or promotional language, or Meta may reclassify them as Marketing (higher price, stricter limits).

Naming: `mf_<purpose>`; each has `en` and `hi` language variants. Variables are `{{1}}`, `{{2}}`, …

## Pricing note
Meta bills per delivered template message by category and recipient country. Indian Utility templates are low-cost (order of ₹0.1–0.15 per message before GST) and Marketing templates cost several times more; rates and in-window rules change periodically (a pricing update is scheduled for 1 Oct 2026). Always check Meta's current rate card. Cost model: `docs/09-operations/cost-estimate.md`.

---

## T1 `mf_renewal_due` — Utility
Used by rules `PRE_7`, `PRE_3`, `PRE_2`, `PRE_1`.

**en**
```
Hi {{1}}, your Max Fitness Gym membership ends on {{2}} ({{3}}).

Renew before this date to continue your workouts without a break.

If you do not want to continue your membership, please unsubscribe.
```
Footer: `Max Fitness Gym, Nyay Khand 1, Indirapuram`
Buttons: `[URL] Renew now → https://{domain}/renew/{{1}}` · `[Quick reply] Unsubscribe`
Variables: {{1}} first name · {{2}} "15 Sep 2026" · {{3}} "in 7 days" / "in 3 days" / "in 2 days" / "tomorrow" · URL {{1}} signed renew token

**hi**
```
नमस्ते {{1}}, Max Fitness Gym में आपकी मेंबरशिप {{2}} ({{3}}) को खत्म हो रही है।

बिना ब्रेक वर्कआउट जारी रखने के लिए इस तारीख से पहले रिन्यू करें।

अगर आप मेंबरशिप जारी नहीं रखना चाहते, तो कृपया अनसब्सक्राइब करें।
```
Buttons: `[URL] अभी रिन्यू करें` · `[Quick reply] अनसब्सक्राइब`
{{3}} values: "7 दिन बाद" / "3 दिन बाद" / "2 दिन बाद" / "कल"

## T2 `mf_renewal_due_today` — Utility
**en**
```
Hi {{1}}, your Max Fitness Gym membership ends today, {{2}}.

Renew today to keep training from tomorrow without a break.

If you do not want to continue your membership, please unsubscribe.
```
**hi**
```
नमस्ते {{1}}, Max Fitness Gym में आपकी मेंबरशिप आज, {{2}} को खत्म हो रही है।

कल से बिना ब्रेक ट्रेनिंग के लिए आज ही रिन्यू करें।

अगर आप मेंबरशिप जारी नहीं रखना चाहते, तो कृपया अनसब्सक्राइब करें।
```
Buttons: same as T1.

## T3 `mf_membership_expired` — Utility
Used by rule `POST` (3 slots/day).
**en**
```
Hi {{1}}, your Max Fitness Gym membership ended on {{2}}.

Renew using the button below to continue your workouts. You can also pay at reception.

If you do not want to continue your membership, please unsubscribe.
```
**hi**
```
नमस्ते {{1}}, Max Fitness Gym में आपकी मेंबरशिप {{2}} को खत्म हो गई है।

वर्कआउट जारी रखने के लिए नीचे दिए बटन से रिन्यू करें। आप रिसेप्शन पर भी फीस दे सकते हैं।

अगर आप मेंबरशिप जारी नहीं रखना चाहते, तो कृपया अनसब्सक्राइब करें।
```
Buttons: same as T1.

> Note: the three daily slots send the same template. Meta may flag identical repeated messages as low quality. Mitigations: slot-specific opening line is **not** possible within one template, so optionally register `mf_membership_expired_morning|afternoon|evening` variants with slightly different wording (same meaning). Decide after template review.

## T4 `mf_payment_receipt` — Utility
**en**
```
Payment received. Thank you, {{1}}.

Amount: {{2}}
Plan: {{3}}
Valid: {{4}} to {{5}}
Receipt no: {{6}}
```
Button: `[URL] View receipt → https://{domain}/r/{{1}}`
**hi**
```
भुगतान मिल गया। धन्यवाद, {{1}}।

राशि: {{2}}
प्लान: {{3}}
वैधता: {{4}} से {{5}} तक
रसीद नंबर: {{6}}
```

## T5 `mf_welcome_member` — Utility
**en**
```
Welcome to Max Fitness Gym, {{1}}. Your member code is {{2}}.

Gym timings: {{3}}
Address: Krishan Plaza, Plot No. 6, Nyay Khand 1, Indirapuram (opposite Sai Mandir).

On your first visit, please meet reception so we can set up your attendance.
```
Button: `[URL] Get directions → {maps link}`

## T6 `mf_verification_approved` — Utility (QR existing customers)
**en**
```
Hi {{1}}, your details are confirmed at Max Fitness Gym.

Your fees are paid till {{2}}. We'll remind you before this date on WhatsApp.

If you do not want reminders, please unsubscribe.
```
Buttons: `[Quick reply] Unsubscribe`

## T7 `mf_signup_payment_pending` — Utility (optional, off by default)
```
Hi {{1}}, your Max Fitness Gym registration is saved. Complete your payment online or at reception within 48 hours to start.
```
Buttons: `[URL] Complete payment`

## T8 `mf_login_code` — Authentication
Use Meta's authentication template format (fixed body with code, optional security disclaimer and expiry, copy-code button). Code expiry 10 minutes.

## T9 `mf_owner_daily_digest` — Utility (to owner)
**hi** (default for owner)
```
सुप्रभात {{1}}। आज का हिसाब:

फीस आज खत्म: {{2}}
फीस बाकी: {{3}}
इस हफ्ते आने वाली फीस: {{4}}
आज के कॉल: {{5}}
जन्मदिन: {{6}}
कल आए पैसे: {{7}}
```
Button: `[URL] Max Register खोलें → https://{domain}/crm`

## T10 `mf_owner_alert` — Utility (to owner)
**hi**
```
{{1}}
```
Where {{1}} is one of the controlled alert sentences, e.g. "संजय तोमर अभी जिम आए, फीस 6 दिन से बाकी है।" / "नई पूछताछ: नेहा, वजन घटाना, 98xxxx4521" / "रोहित शर्मा ने ऑनलाइन ₹4,000 दिए।"
> A single-variable body may be rejected. If so, register explicit templates: `mf_owner_alert_expired_visit`, `mf_owner_alert_new_lead`, `mf_owner_alert_payment`.

## T11 `mf_birthday_wish` — Marketing (owner-triggered)
**hi**
```
जन्मदिन की बहुत-बहुत शुभकामनाएँ, {{1}}! 🎉 Max Fitness Gym की पूरी टीम की ओर से आपको स्वस्थ और ताकतवर साल की शुभकामनाएँ।
```

## Free-form (session) messages
Sent only inside an open 24-hour window (e.g., right after the member taps a button):
- **Unsubscribe confirmation:** "You're unsubscribed, {name}. You won't get membership reminders. Tapped by mistake?" + interactive reply button `Restart reminders`.
- **Restart confirmation:** "Reminders are back on, {name}."
- **STOP text for shared numbers:** "Which member should stop getting reminders?" + interactive list of members on this number + "All".
- **Unknown reply:** "Thanks for your message. For help, call 098714 06350 or visit reception." (and notify owner inbox if enabled)

## Quick-reply payloads (sent via template components)
- Unsubscribe: `UNSUB.<base64url(memberId.membershipId.exp)>.<hmac>`
- Restart: `RESTART.<...>.<hmac>`
Server verifies HMAC with `LINK_TOKEN_SECRET`; never trust phone number alone.

## Submission checklist
- [ ] Sample values provided for every variable
- [ ] No promotional words in Utility templates
- [ ] Both `en` and `hi` submitted
- [ ] URL button domain matches verified business website
- [ ] Record template status and category returned by Meta in `docs/10-delivery/decision-log.md`
