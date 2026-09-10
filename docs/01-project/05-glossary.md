# 05 — Glossary (English ⇄ Hindi UI terms)

Use these exact words in the CRM and kiosk so the owner learns one vocabulary.

| Concept | English UI | Hindi UI (default in CRM) | Notes |
|---|---|---|---|
| Member | Member | मेंबर | Commonly understood loanword; avoid "सदस्य" |
| Membership / plan | Plan | प्लान | |
| Fees | Fees | फीस | |
| Fees paid till | Paid till | फीस जमा है — तारीख | |
| Days left | days left | दिन बाकी | "12 दिन बाकी" |
| Fees due (expired) | Fees due | फीस बाकी | Red |
| Due soon | Due soon | जल्द फीस | Amber |
| Renew | Renew | रिन्यू करें | Same word on button and success toast ("रिन्यू हो गया") |
| Record payment | Take fees | फीस लें | |
| Cash / UPI / Card | Cash / UPI / Card | कैश / UPI / कार्ड | Icons carry meaning |
| Attendance | Attendance | हाज़िरी | |
| Present today | Came today | आज आए | |
| Absent for N days | Not coming | N दिन से नहीं आए | |
| Call list | Calls to make | आज के कॉल | |
| Birthday | Birthday | जन्मदिन | Cake icon |
| Left the gym | Left | जिम छोड़ दिया | Grey |
| Verify | Check & approve | जाँचें | |
| Approve / Reject | Approve / Reject | सही है / गलत है | |
| Lead / enquiry | Enquiry | पूछताछ | |
| Unsubscribe | Unsubscribe | अनसब्सक्राइब | WhatsApp button text |
| Kiosk | Attendance phone | हाज़िरी फ़ोन | Owner never sees the word "kiosk" |
| Settings | Settings | सेटिंग | |
| Undo | Undo | वापस लें | |
| Month-end date | Month-end date | फीस किस तारीख तक जमा है | Used in QR existing-customer form |

## Technical glossary
| Term | Meaning |
|---|---|
| Fee state | Derived status of a member's current membership: `PAID` (>7 days left), `DUE_SOON` (0–7 days left), `EXPIRED` (past end date), `NONE` |
| Reminder rule | Config row that says *when* (offset from end date), *which slots*, *which template* |
| Send slot | A fixed daily time (e.g., 09:30) when the engine evaluates rules |
| Template (WhatsApp) | Pre-approved message format required to message a user outside a 24-hour customer-service window |
| Face template | Numeric vector (embedding) derived from a face image, used for matching; not a photo |
| Shadow mode | Kiosk recognises and logs but asks staff to confirm; used to calibrate thresholds |
| Idempotency key | Unique key that makes repeating an operation safe (no duplicate message or payment) |
| DPDP | Digital Personal Data Protection Act, 2023 and Rules, 2025 (India) |
