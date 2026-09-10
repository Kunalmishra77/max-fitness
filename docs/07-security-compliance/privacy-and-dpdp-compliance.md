# Privacy & DPDP Compliance Plan

> Not legal advice. Have the final notices and policies reviewed by a lawyer familiar with India's Digital Personal Data Protection Act, 2023 and the DPDP Rules, 2025.

## 1. Context
- The DPDP Rules, 2025 were notified in November 2025 with staggered commencement; the remaining substantive obligations (notices, consent, security safeguards, breach notification, children's data, rights) apply from **May 2027**. This platform launches earlier; we build to those obligations now so no retrofit is needed.
- **Data Fiduciary:** Max Fitness Gym (the owner's business). **Data Processor:** the development/hosting vendor (contract required, §10).
- There are no size exemptions for ordinary businesses under the framework; treat compliance as mandatory.

## 2. Data inventory & purposes
| Data | Collected at | Purpose | Legal basis | Retention |
|---|---|---|---|---|
| Name, mobile, email, DOB, gender | Signup, QR, desk | Membership management, pricing by gender, age eligibility, contact | Consent (notice) / contract performance | Membership + 3 years (accounts), then anonymise |
| Selfie (profile photo) | Signup, QR, desk | Identify member at reception; source for face enrolment if consented | Consent | Until 12 months after leaving |
| Face templates | Kiosk/derived | Automatic attendance | **Separate explicit consent** | Deleted 30 days after leaving/withdrawal |
| Attendance records | Kiosk/CRM | Attendance history, absence follow-up | Consent / legitimate use for service | 24 months |
| Payment records | Payments | Accounting, receipts, disputes | Legal obligation / contract | As required by tax law (confirm, typically several years) |
| WhatsApp messages & status | Engine | Reminders, receipts | Consent (WhatsApp updates) | 24 months |
| Leads (name, mobile, goal) | Lead form | Call back about membership | Consent | 12 months if not converted |
| Guardian name (minors) | Desk | Verifiable parental consent | Legal requirement | With member record |
| Device/usage analytics | Website | Improve site | Consent (cookie banner) | Provider default ≤ 14 months |

Data minimisation: no Aadhaar, no address, no health data in 1.0. If a health declaration (PAR-Q) is added later, treat as sensitive and collect on paper or with explicit consent.

## 3. Notices (standalone, clear, bilingual)
Shown before collection with a link to the full privacy policy. Versioned (`noticeVersion` stored with each Consent).

### 3.1 Short notice at sign-up / QR (EN)
> **How we use your details.** Max Fitness Gym uses your name, mobile, email, date of birth, gender and photo to register and manage your membership, calculate your fee, send receipts and renewal reminders on WhatsApp (if you agree), and recognise you at reception. If you choose automatic attendance, our reception phone creates a face template from your photo to mark attendance; you can say no and staff will mark it manually. We don't sell your data. You can withdraw consent, correct or delete your data any time by contacting {grievance contact} or visiting reception. Full privacy policy: {link}.

### 3.2 Short notice (HI)
> **हम आपकी जानकारी कैसे इस्तेमाल करते हैं।** Max Fitness Gym आपका नाम, मोबाइल, ईमेल, जन्मतिथि, जेंडर और फोटो आपकी मेंबरशिप बनाने और संभालने, फीस तय करने, WhatsApp पर रसीद और रिन्यू रिमाइंडर भेजने (अगर आप सहमत हैं) और रिसेप्शन पर आपको पहचानने के लिए इस्तेमाल करता है। अगर आप ऑटोमैटिक हाज़िरी चुनते हैं, तो रिसेप्शन का फोन आपकी फोटो से चेहरे का एक टेम्पलेट बनाता है ताकि हाज़िरी अपने-आप लगे; आप मना कर सकते हैं, तब स्टाफ हाज़िरी लगाएगा। हम आपका डेटा बेचते नहीं हैं। आप कभी भी सहमति वापस ले सकते हैं, जानकारी सुधारवा या हटवा सकते हैं — {grievance contact} से संपर्क करें या रिसेप्शन पर आएँ। पूरी प्राइवेसी पॉलिसी: {link}।

### 3.3 Face attendance consent text (separate, un-ticked)
EN: "I agree that Max Fitness Gym may create and store a face template from my photo only to mark my attendance automatically. I can withdraw this anytime; my face template will then be deleted."
HI: "मैं सहमत हूँ कि Max Fitness Gym मेरी फोटो से चेहरे का टेम्पलेट सिर्फ मेरी हाज़िरी अपने-आप लगाने के लिए बनाए और रखे। मैं यह सहमति कभी भी वापस ले सकता/सकती हूँ; तब मेरा टेम्पलेट हटा दिया जाएगा।"

### 3.4 Reception signage (A4)
"Automatic attendance camera. This phone recognises members who agreed to face attendance. It does not record video. Don't want it? Tell reception — we'll mark attendance manually. Privacy: scan QR."

## 4. Consent management
- Consent ledger (`Consent` table): type, granted, notice version, channel, timestamp, IP hash, staff (for desk consent), guardian name.
- Consents are **granular**: Terms/Privacy, WhatsApp updates, Face attendance, Photo marketing (for transformations/social).
- No pre-ticked boxes. Face consent not required to join.
- **Withdrawal** as easy as giving: CRM toggle (desk), WhatsApp Unsubscribe (updates), web link in privacy page for requests.
- Effects of withdrawal implemented: face → templates revoked + kiosk sync + deletion job; WhatsApp → no reminders.

## 5. Children (under 18)
- DOB collected → `isMinor`.
- Online sign-up allowed for payment convenience, but before first workout a parent/guardian gives consent at the desk (recorded with guardian name and staff id).
- **No face attendance for minors** unless guardian consent includes it; default off. No marketing/behavioural tracking of minors; exclude from analytics profiling and marketing messages.
- Minimum age setting (default 16).

## 6. Data principal rights workflows
| Right | How | SLA (target) |
|---|---|---|
| Access / information | Owner exports member JSON/PDF from CRM (`/crm/members/{id}/export`) | 15 days |
| Correction | Staff edits in CRM; member can request at desk/WhatsApp | 7 days |
| Erasure | CRM delete (owner PIN) → deletes media, templates, consents kept as minimal proof, anonymises member; payments retained pseudonymously for legal obligations | 30 days |
| Withdraw consent | Desk/CRM/WhatsApp | Immediate for messages; face within 24 h |
| Grievance redressal | Named contact in privacy policy and footer | Acknowledge 48 h, resolve per applicable rules |
| Nominate | Note in privacy policy how to nominate; record in member notes | — |

All requests logged in AuditLog (`privacy.request.*`).

## 7. Security safeguards
Reference `security-plan.md`. Key items the law expects: encryption, access controls, logging/monitoring for unauthorised access, backups, and contracts with processors. Keep access logs for the retention period specified by the Rules (confirm with counsel; design keeps AuditLog 3 years).

## 8. Processors & transfers
| Processor | Data | Location | Contract/terms |
|---|---|---|---|
| VPS provider (Mumbai region) | All app data | India | Provider DPA |
| Off-site backup storage | Encrypted backups | Choose India region if available; otherwise document | Provider DPA |
| Meta (WhatsApp) | Mobile, message content | Global | WhatsApp Business terms |
| Razorpay | Payment data | India | Merchant agreement |
| Sentry | Error metadata (PII scrubbed) | Choose region; scrub PII | DPA |
| Analytics | Pseudonymous usage | Choose provider/region | DPA |
| Face SDK vendor (if any) | Should process on-device only; no data leaves device | — | Licence must confirm no telemetry of face data |

Cross-border transfers are permitted except to countries the government restricts — review list at launch.

## 9. Breach response
- Maintain contact list (owner, vendor lead, counsel).
- On a personal data breach: contain → assess → **inform affected members in plain language** (what happened, likely consequences, what we did, what they can do, contact) and **report to the Data Protection Board** within the timelines the Rules specify (commonly summarised as an initial intimation without delay and a detailed report within 72 hours — confirm with counsel).
- Templates for member notice (EN/HI) kept in `docs/09-operations/runbook-monitoring-backups.md` §7.

## 10. Vendor ↔ gym contract clauses (processor agreement)
Scope & purpose limitation; confidentiality; security measures; sub-processor list and approval; breach notification to gym within 24 h; assistance with rights requests; deletion/return of data at contract end; audit rights; data localisation preference; ownership of WhatsApp Business Account and Razorpay account by the gym.

## 11. Compliance checklist (launch)
- [ ] Privacy policy (EN/HI) published and linked in footer, signup, QR, kiosk signage
- [ ] Consent texts versioned and stored
- [ ] Face consent separate and optional; manual path works
- [ ] Minor handling implemented and tested
- [ ] Rights workflows usable by owner
- [ ] Retention jobs enabled and tested with fake clock
- [ ] Processor agreement signed
- [ ] Grievance contact named
- [ ] Breach playbook shared with owner
