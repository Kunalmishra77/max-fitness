# WhatsApp templates — submission sheet

**Generated — do not edit by hand.** Source: `packages/integrations/src/whatsapp/templates.ts`.
Regenerate with `pnpm wa:templates`.

Submit each one in Meta → WhatsApp Manager → Message templates → Create template.
The **name must match exactly** — the product sends by that name, and a typo is a message that never arrives.
Each template is submitted **twice**, once per language, under the same name.

21 templates.

> Anything in `docs/04-content/whatsapp-templates.md` that is not listed here is obsolete.
> It names four templates the product no longer sends; do not create them.

---

## Tick list

| # | Template | Category | Why it matters | English | Hindi |
|---|---|---|---|---|---|
| 1 | `mf_autopay_invite` | UTILITY | the e-mandate link — without it autopay cannot reach anybody | ☐ | ☐ |
| 2 | `mf_renewal_due` | UTILITY | the reminders the gym runs on | ☐ | ☐ |
| 3 | `mf_renewal_due_today` | UTILITY | the reminders the gym runs on | ☐ | ☐ |
| 4 | `mf_membership_expired` | UTILITY | the reminders the gym runs on | ☐ | ☐ |
| 5 | `mf_payment_receipt` | UTILITY | every payment sends one | ☐ | ☐ |
| 6 | `mf_welcome_member` | UTILITY | the first message a new member gets | ☐ | ☐ |
| 7 | `mf_verification_approved` | UTILITY | the QR arrivals | ☐ | ☐ |
| 8 | `mf_login_code` | AUTHENTICATION | staff sign-in | ☐ | ☐ |
| 9 | `mf_owner_daily_digest` | UTILITY | later | ☐ | ☐ |
| 10 | `mf_owner_alert` | UTILITY | later | ☐ | ☐ |
| 11 | `mf_birthday_wish` | MARKETING | later | ☐ | ☐ |
| 12 | `mf_announcement` | MARKETING | later | ☐ | ☐ |
| 13 | `mf_diet_question` | UTILITY | later | ☐ | ☐ |
| 14 | `mf_diet_plan_ready` | UTILITY | later | ☐ | ☐ |
| 15 | `mf_diet_follow_up` | UTILITY | later | ☐ | ☐ |
| 16 | `mf_trial_welcome` | UTILITY | later | ☐ | ☐ |
| 17 | `mf_trial_check_in` | UTILITY | later | ☐ | ☐ |
| 18 | `mf_trial_last_day` | UTILITY | later | ☐ | ☐ |
| 19 | `mf_trial_join` | UTILITY | later | ☐ | ☐ |
| 20 | `mf_autopay_halted` | UTILITY | later | ☐ | ☐ |
| 21 | `mf_autopay_cancelled` | UTILITY | later | ☐ | ☐ |

---

## 1 of 21 — `mf_autopay_invite`

**Category:** UTILITY

**Variables**, in this order:

| # | Meaning | Sample to paste |
|---|---|---|
| {{1}} | firstName | Ravi |
| {{2}} | amount | ₹4,000 |
| {{3}} | firstChargeDate | 1 Oct 2026 |
| {{4}} | link | https://maxfitnessgym.co.in/r/abc123 |

### English (en)

```
Hi {{1}}, you can set your Max Fitness Gym fee to pay itself. {{2}} would be taken automatically from {{3}}, and nothing before that. Set it up here: {{4}} — you can stop it any time from your own UPI app.
```

Footer: `Max Fitness Gym, Nyay Khand 1, Indirapuram`

### Hindi (hi)

```
नमस्ते {{1}}, आप अपनी Max Fitness Gym की फ़ीस ऑटोमैटिक कर सकते हैं। {{3}} से {{2}} अपने आप कट जाएगा, उससे पहले कुछ नहीं। यहाँ सेट कीजिए: {{4}} — अपने UPI ऐप से कभी भी बंद कर सकते हैं।
```

Footer: `Max Fitness Gym, न्याय खंड 1, इंदिरापुरम`

---

## 2 of 21 — `mf_renewal_due`

**Category:** UTILITY

**Variables**, in this order:

| # | Meaning | Sample to paste |
|---|---|---|
| {{1}} | firstName | Ravi |
| {{2}} | endDate | 15 Sep 2026 |
| {{3}} | whenPhrase | in 7 days |

### English (en)

```
Hi {{1}}, your Max Fitness Gym membership ends on {{2}} ({{3}}).

Renew before this date to continue your workouts without a break.

If you do not want to continue your membership, please unsubscribe.
```

Footer: `Max Fitness Gym, Nyay Khand 1, Indirapuram`

Buttons, in this order: [URL] Renew now · [Quick reply] Unsubscribe

### Hindi (hi)

```
नमस्ते {{1}}, Max Fitness Gym में आपकी मेंबरशिप {{2}} ({{3}}) को खत्म हो रही है।

बिना ब्रेक वर्कआउट जारी रखने के लिए इस तारीख से पहले रिन्यू करें।

अगर आप मेंबरशिप जारी नहीं रखना चाहते, तो कृपया अनसब्सक्राइब करें।
```

Footer: `Max Fitness Gym, न्याय खंड 1, इंदिरापुरम`

Buttons, in this order: [URL] अभी रिन्यू करें · [Quick reply] अनसब्सक्राइब

The URL button is **dynamic**: set it to `https://maxfitnessgym.co.in/r/{{1}}` with sample `abc123`.
The product sends only the token, because the template already holds everything before it.

---

## 3 of 21 — `mf_renewal_due_today`

**Category:** UTILITY

**Variables**, in this order:

| # | Meaning | Sample to paste |
|---|---|---|
| {{1}} | firstName | Ravi |
| {{2}} | endDate | 15 Sep 2026 |

### English (en)

```
Hi {{1}}, your Max Fitness Gym membership ends today, {{2}}.

Renew today to keep training from tomorrow without a break.

If you do not want to continue your membership, please unsubscribe.
```

Footer: `Max Fitness Gym, Nyay Khand 1, Indirapuram`

Buttons, in this order: [URL] Renew now · [Quick reply] Unsubscribe

### Hindi (hi)

```
नमस्ते {{1}}, Max Fitness Gym में आपकी मेंबरशिप आज, {{2}} को खत्म हो रही है।

कल से बिना ब्रेक ट्रेनिंग के लिए आज ही रिन्यू करें।

अगर आप मेंबरशिप जारी नहीं रखना चाहते, तो कृपया अनसब्सक्राइब करें।
```

Footer: `Max Fitness Gym, न्याय खंड 1, इंदिरापुरम`

Buttons, in this order: [URL] अभी रिन्यू करें · [Quick reply] अनसब्सक्राइब

The URL button is **dynamic**: set it to `https://maxfitnessgym.co.in/r/{{1}}` with sample `abc123`.
The product sends only the token, because the template already holds everything before it.

---

## 4 of 21 — `mf_membership_expired`

**Category:** UTILITY

**Variables**, in this order:

| # | Meaning | Sample to paste |
|---|---|---|
| {{1}} | firstName | Ravi |
| {{2}} | endDate | 15 Sep 2026 |

### English (en)

```
Hi {{1}}, your Max Fitness Gym membership ended on {{2}}.

Renew using the button below to continue your workouts. You can also pay at reception.

If you do not want to continue your membership, please unsubscribe.
```

Footer: `Max Fitness Gym, Nyay Khand 1, Indirapuram`

Buttons, in this order: [URL] Renew now · [Quick reply] Unsubscribe

### Hindi (hi)

```
नमस्ते {{1}}, Max Fitness Gym में आपकी मेंबरशिप {{2}} को खत्म हो गई है।

वर्कआउट जारी रखने के लिए नीचे दिए बटन से रिन्यू करें। आप रिसेप्शन पर भी फीस दे सकते हैं।

अगर आप मेंबरशिप जारी नहीं रखना चाहते, तो कृपया अनसब्सक्राइब करें।
```

Footer: `Max Fitness Gym, न्याय खंड 1, इंदिरापुरम`

Buttons, in this order: [URL] अभी रिन्यू करें · [Quick reply] अनसब्सक्राइब

The URL button is **dynamic**: set it to `https://maxfitnessgym.co.in/r/{{1}}` with sample `abc123`.
The product sends only the token, because the template already holds everything before it.

---

## 5 of 21 — `mf_payment_receipt`

**Category:** UTILITY

**Variables**, in this order:

| # | Meaning | Sample to paste |
|---|---|---|
| {{1}} | firstName | Ravi |
| {{2}} | amount | ₹4,000 |
| {{3}} | planName | 3 months |
| {{4}} | startDate | 16 Jun 2026 |
| {{5}} | endDate | 15 Sep 2026 |
| {{6}} | receiptNo | MF/2026-27/000123 |

### English (en)

```
Payment received — thank you, {{1}}. Your membership at Max Fitness Gym is active and you can train from today.

Amount paid: {{2}}
Plan: {{3}}
Valid from {{4}} until {{5}}
Receipt number: {{6}}

Please keep this message. Show it at the reception desk if there is ever a question about this payment.
```

Footer: `Max Fitness Gym, Nyay Khand 1, Indirapuram`

### Hindi (hi)

```
भुगतान मिल गया — धन्यवाद, {{1}}। Max Fitness Gym में आपकी मेंबरशिप चालू है और आप आज से ट्रेनिंग कर सकते हैं।

राशि: {{2}}
प्लान: {{3}}
वैधता: {{4}} से {{5}} तक
रसीद नंबर: {{6}}

यह मैसेज सँभाल कर रखिए। इस भुगतान को लेकर कभी कोई सवाल हो तो रिसेप्शन पर दिखा दीजिए।
```

Footer: `Max Fitness Gym, न्याय खंड 1, इंदिरापुरम`

---

## 6 of 21 — `mf_welcome_member`

**Category:** UTILITY

**Variables**, in this order:

| # | Meaning | Sample to paste |
|---|---|---|
| {{1}} | firstName | Ravi |
| {{2}} | memberCode | MF-0231 |

### English (en)

```
Welcome to Max Fitness Gym, {{1}}! Your membership is active and you can start training today.

Member ID: {{2}}
Gym timings: Monday to Saturday, 4:30 am to 10 pm. Closed on Sunday.

On your first visit, please meet reception so we can set up your attendance.
```

Footer: `Max Fitness Gym, Nyay Khand 1, Indirapuram`

### Hindi (hi)

```
Max Fitness Gym में आपका स्वागत है, {{1}}! आपकी मेंबरशिप चालू है और आप आज से ट्रेनिंग शुरू कर सकते हैं।

मेंबर आईडी: {{2}}
जिम का समय: सोमवार से शनिवार, सुबह 4:30 से रात 10 बजे तक। रविवार बंद।

पहली बार आएँ तो रिसेप्शन पर मिलें, ताकि आपकी हाज़िरी सेट की जा सके।
```

Footer: `Max Fitness Gym, न्याय खंड 1, इंदिरापुरम`

---

## 7 of 21 — `mf_verification_approved`

**Category:** UTILITY

**Variables**, in this order:

| # | Meaning | Sample to paste |
|---|---|---|
| {{1}} | firstName | Ravi |
| {{2}} | endDate | 15 Sep 2026 |

### English (en)

```
Hi {{1}}, your details are confirmed at Max Fitness Gym.

Your fees are paid till {{2}}. We'll remind you before this date on WhatsApp.

If you do not want reminders, please unsubscribe.
```

Footer: `Max Fitness Gym, Nyay Khand 1, Indirapuram`

### Hindi (hi)

```
नमस्ते {{1}}, Max Fitness Gym में आपकी जानकारी पक्की हो गई है।

आपकी फीस {{2}} तक जमा है। इस तारीख से पहले हम आपको WhatsApp पर याद दिला देंगे।

अगर आप रिमाइंडर नहीं चाहते, तो कृपया अनसब्सक्राइब करें।
```

Footer: `Max Fitness Gym, न्याय खंड 1, इंदिरापुरम`

---

## 8 of 21 — `mf_login_code`

**Category:** AUTHENTICATION

**Variables**, in this order:

| # | Meaning | Sample to paste |
|---|---|---|
| {{1}} | code | 418266 |

### English (en)

```
{{1}} is your verification code. For your security, do not share this code.
```

Footer: `This code expires in 10 minutes.`

### Hindi (hi)

```
{{1}} आपका वेरिफिकेशन कोड है। अपनी सुरक्षा के लिए यह कोड किसी को न बताएँ।
```

Footer: `यह कोड 10 मिनट में खत्म हो जाएगा।`

---

## 9 of 21 — `mf_owner_daily_digest`

**Category:** UTILITY

**Variables**, in this order:

| # | Meaning | Sample to paste |
|---|---|---|
| {{1}} | ownerName | Ajay |
| {{2}} | endingToday | 2 |
| {{3}} | overdue | 5 |
| {{4}} | dueThisWeek | 7 |
| {{5}} | callsToday | 4 |
| {{6}} | birthdays | 1 |
| {{7}} | collectedYesterday | ₹12,000 |

### English (en)

```
Good morning {{1}}. Here is where the gym stands this morning, before the floor fills up:

Fees ending today: {{2}}
Fees overdue: {{3}}
Fees due this week: {{4}}
Today's calls: {{5}}
Birthdays: {{6}}
Collected yesterday: {{7}}

Every one of these opens as a list in Max Register.
```

Footer: `Max Fitness Gym, Nyay Khand 1, Indirapuram`

### Hindi (hi)

```
सुप्रभात {{1}}। सुबह-सुबह जिम का हाल, भीड़ आने से पहले:

फीस आज खत्म: {{2}}
फीस बाकी: {{3}}
इस हफ्ते आने वाली फीस: {{4}}
आज के कॉल: {{5}}
जन्मदिन: {{6}}
कल आए पैसे: {{7}}

इनमें से हर एक Max Register में लिस्ट की तरह खुलती है।
```

Footer: `Max Fitness Gym, न्याय खंड 1, इंदिरापुरम`

---

## 10 of 21 — `mf_owner_alert`

**Category:** UTILITY

**Variables**, in this order:

| # | Meaning | Sample to paste |
|---|---|---|
| {{1}} | sentence | 3 members have fees overdue by more than a week. |

### English (en)

```
Max Fitness Gym — something at the gym needs your attention:

{{1}}

Open Max Register to see which members this is about.
```

Footer: `Max Fitness Gym, Nyay Khand 1, Indirapuram`

### Hindi (hi)

```
Max Fitness Gym — जिम में एक बात आपके ध्यान देने लायक है:

{{1}}

किन मेंबर की बात है, यह देखने के लिए Max Register खोलिए।
```

Footer: `Max Fitness Gym, न्याय खंड 1, इंदिरापुरम`

---

## 11 of 21 — `mf_birthday_wish`

**Category:** MARKETING

**Variables**, in this order:

| # | Meaning | Sample to paste |
|---|---|---|
| {{1}} | firstName | Ravi |

### English (en)

```
Many happy returns of the day, {{1}}! 🎉 Everyone at Max Fitness Gym wishes you a healthy and strong year ahead.
```

Footer: `Max Fitness Gym, Nyay Khand 1, Indirapuram`

### Hindi (hi)

```
जन्मदिन की बहुत-बहुत शुभकामनाएँ, {{1}}! 🎉 Max Fitness Gym की पूरी टीम की ओर से आपको स्वस्थ और ताकतवर साल की शुभकामनाएँ।
```

Footer: `Max Fitness Gym, न्याय खंड 1, इंदिरापुरम`

---

## 12 of 21 — `mf_announcement`

**Category:** MARKETING

**Variables**, in this order:

| # | Meaning | Sample to paste |
|---|---|---|
| {{1}} | firstName | Ravi |
| {{2}} | message | The gym stays closed on Sunday 12 October. |

### English (en)

```
Hi {{1}}, a message from everyone at Max Fitness Gym:

{{2}}

If anything about this is unclear, ask at the reception desk on your next visit.
```

Footer: `Max Fitness Gym, Nyay Khand 1, Indirapuram`

### Hindi (hi)

```
नमस्ते {{1}}, Max Fitness Gym की ओर से एक सूचना:

{{2}}

इसमें कुछ समझ न आए तो अगली बार रिसेप्शन पर पूछ लीजिए।
```

Footer: `Max Fitness Gym, न्याय खंड 1, इंदिरापुरम`

---

## 13 of 21 — `mf_diet_question`

**Category:** UTILITY

**Variables**, in this order:

| # | Meaning | Sample to paste |
|---|---|---|
| {{1}} | firstName | Ravi |
| {{2}} | question | How many meals do you eat in a day? |

### English (en)

```
Hi {{1}}, to write your diet plan we need a few details.

{{2}}

Just reply to this message.
```

Footer: `Max Fitness Gym, Nyay Khand 1, Indirapuram`

### Hindi (hi)

```
नमस्ते {{1}}, आपका डाइट प्लान बनाने के लिए थोड़ी जानकारी चाहिए।

{{2}}

इसी मैसेज का जवाब दे दीजिए।
```

Footer: `Max Fitness Gym, न्याय खंड 1, इंदिरापुरम`

---

## 14 of 21 — `mf_diet_plan_ready`

**Category:** UTILITY

**Variables**, in this order:

| # | Meaning | Sample to paste |
|---|---|---|
| {{1}} | firstName | Ravi |
| {{2}} | calories | 2,100 |
| {{3}} | meals | 4 |
| {{4}} | link | https://maxfitnessgym.co.in/r/abc123 |

### English (en)

```
Hi {{1}}, your diet plan is ready — about {{2}} calories a day across {{3}} meals.

Open it here: {{4}}

This is general guidance, not medical advice. If you have a medical condition, please check with a doctor or a qualified nutritionist.
```

Footer: `Max Fitness Gym, Nyay Khand 1, Indirapuram`

### Hindi (hi)

```
नमस्ते {{1}}, आपका डाइट प्लान तैयार है — लगभग {{2}} कैलोरी रोज़, {{3}} मील में।

यहाँ देखें: {{4}}

यह सामान्य सलाह है, मेडिकल सलाह नहीं। कोई बीमारी हो तो डॉक्टर या क्वालिफाइड न्यूट्रिशनिस्ट से ज़रूर पूछ लें।
```

Footer: `Max Fitness Gym, न्याय खंड 1, इंदिरापुरम`

---

## 15 of 21 — `mf_diet_follow_up`

**Category:** UTILITY

**Variables**, in this order:

| # | Meaning | Sample to paste |
|---|---|---|
| {{1}} | firstName | Ravi |
| {{2}} | question | How many meals do you eat in a day? |

### English (en)

```
Hi {{1}}, checking in on your diet plan.

{{2}}

Reply here and we will adjust it if it needs adjusting.
```

Footer: `Max Fitness Gym, Nyay Khand 1, Indirapuram`

### Hindi (hi)

```
नमस्ते {{1}}, आपके डाइट प्लान का हाल पूछ रहे हैं।

{{2}}

यहीं जवाब दे दीजिए, ज़रूरत हो तो प्लान बदल देंगे।
```

Footer: `Max Fitness Gym, न्याय खंड 1, इंदिरापुरम`

---

## 16 of 21 — `mf_trial_welcome`

**Category:** UTILITY

**Variables**, in this order:

| # | Meaning | Sample to paste |
|---|---|---|
| {{1}} | firstName | Ravi |
| {{2}} | days | 3 |
| {{3}} | startDate | 16 Jun 2026 |
| {{4}} | endDate | 15 Sep 2026 |

### English (en)

```
Welcome to Max Fitness Gym, {{1}}. Your {{2}} trial is booked: {{3}} to {{4}}.

Come in any time we are open and tell reception your name. Bring a towel and water.
```

Footer: `Max Fitness Gym, Nyay Khand 1, Indirapuram`

### Hindi (hi)

```
Max Fitness Gym में स्वागत है, {{1}}। आपका {{2}} का ट्रायल बुक हो गया है: {{3}} से {{4}} तक।

जिम खुलने के किसी भी समय आ जाइए और रिसेप्शन पर अपना नाम बता दीजिए। तौलिया और पानी साथ लाइए।
```

Footer: `Max Fitness Gym, न्याय खंड 1, इंदिरापुरम`

---

## 17 of 21 — `mf_trial_check_in`

**Category:** UTILITY

**Variables**, in this order:

| # | Meaning | Sample to paste |
|---|---|---|
| {{1}} | firstName | Ravi |

### English (en)

```
Hi {{1}}, how are you finding Max Fitness Gym so far? If anything is missing — a machine, a timing, help with your form — reply here and we will sort it out.
```

Footer: `Max Fitness Gym, Nyay Khand 1, Indirapuram`

### Hindi (hi)

```
नमस्ते {{1}}, Max Fitness Gym अभी तक कैसा लग रहा है? कोई चीज़ चाहिए — कोई मशीन, कोई टाइमिंग, या फ़ॉर्म में मदद — तो यहीं जवाब दे दीजिए, हम देख लेंगे।
```

Footer: `Max Fitness Gym, न्याय खंड 1, इंदिरापुरम`

---

## 18 of 21 — `mf_trial_last_day`

**Category:** UTILITY

**Variables**, in this order:

| # | Meaning | Sample to paste |
|---|---|---|
| {{1}} | firstName | Ravi |

### English (en)

```
Hi {{1}}, today is the last day of your trial. How was it? Tell us one thing you liked and one thing you did not — we read every reply.
```

Footer: `Max Fitness Gym, Nyay Khand 1, Indirapuram`

### Hindi (hi)

```
नमस्ते {{1}}, आज आपके ट्रायल का आख़िरी दिन है। कैसा रहा? एक चीज़ जो अच्छी लगी और एक जो नहीं — बता दीजिए, हम हर जवाब पढ़ते हैं।
```

Footer: `Max Fitness Gym, न्याय खंड 1, इंदिरापुरम`

---

## 19 of 21 — `mf_trial_join`

**Category:** UTILITY

**Variables**, in this order:

| # | Meaning | Sample to paste |
|---|---|---|
| {{1}} | firstName | Ravi |

### English (en)

```
Hi {{1}}, your trial at Max Fitness Gym is done. Would you like to carry on with a membership? Reply here or come to reception and we will set it up.
```

Footer: `Max Fitness Gym, Nyay Khand 1, Indirapuram`

### Hindi (hi)

```
नमस्ते {{1}}, आपका Max Fitness Gym का ट्रायल पूरा हो गया। आगे मेंबरशिप लेना चाहेंगे? यहीं जवाब दे दीजिए या रिसेप्शन पर आ जाइए, हम कर देंगे।
```

Footer: `Max Fitness Gym, न्याय खंड 1, इंदिरापुरम`

---

## 20 of 21 — `mf_autopay_halted`

**Category:** UTILITY

**Variables**, in this order:

| # | Meaning | Sample to paste |
|---|---|---|
| {{1}} | firstName | Ravi |

### English (en)

```
Hi {{1}}, your automatic Max Fitness Gym fee payment has stopped — the bank could not take it. Nothing has been lost, but the fee is now due the usual way. Come to reception and we will set it up again, or pay at the desk.
```

Footer: `Max Fitness Gym, Nyay Khand 1, Indirapuram`

### Hindi (hi)

```
नमस्ते {{1}}, आपकी Max Fitness Gym की ऑटोमैटिक फ़ीस बंद हो गई है — बैंक से कट नहीं पाई। कुछ नुकसान नहीं हुआ, लेकिन अब फ़ीस आम तरीक़े से देनी होगी। रिसेप्शन पर आ जाइए, हम दोबारा सेट कर देंगे, या वहीं जमा कर दीजिए।
```

Footer: `Max Fitness Gym, न्याय खंड 1, इंदिरापुरम`

---

## 21 of 21 — `mf_autopay_cancelled`

**Category:** UTILITY

**Variables**, in this order:

| # | Meaning | Sample to paste |
|---|---|---|
| {{1}} | firstName | Ravi |

### English (en)

```
Hi {{1}}, your automatic Max Fitness Gym fee payment has been cancelled. Your membership is unchanged — just pay at reception as before.
```

Footer: `Max Fitness Gym, Nyay Khand 1, Indirapuram`

### Hindi (hi)

```
नमस्ते {{1}}, आपकी Max Fitness Gym की ऑटोमैटिक फ़ीस रद्द कर दी गई है। आपकी मेंबरशिप वैसी ही है — पहले की तरह रिसेप्शन पर फ़ीस जमा कर दीजिए।
```

Footer: `Max Fitness Gym, न्याय खंड 1, इंदिरापुरम`

---

