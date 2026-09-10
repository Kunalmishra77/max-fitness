# Max Register CRM — Module Specification

UX: `docs/03-design/crm-ux-blueprint.md` · PRD: CRM-01…26 · API: `api-specification.md` §5.

## 1. Modules
| Module | Screens | Core services |
|---|---|---|
| Auth | Login (mobile + PIN keypad), PIN reset by owner | `auth/session`, `staff` |
| Home | Today dashboard | `dashboard` (aggregates), `calls`, `birthdays`, `alerts` |
| Members | List/search, profile, add, edit, renew, left, pause reminders, face enrol, guardian consent | `members`, `memberships`, `payments`, `consent`, `attendance` |
| Fees | Due this week, overdue, pending payment, collected today | `payments`, `fee-state` |
| Calls | Task list with outcomes | `calls` |
| Verify | QR existing queue | `verification` |
| Leads | Pipeline | `leads` |
| Attendance | Today, absent, manual mark, kiosk status | `attendance`, `kiosk` |
| Messages | Log, simulator (demo) | `messages`, `reminders` |
| Alerts | Bell list | `alerts` |
| Reports | Monthly visual insights | `reports` |
| Settings | Prices, reminders, hours, promo, trust, staff, kiosk, language/voice, kill switch | `settings`, `staff`, `kiosk` |
| Import/Export | CSV import wizard, exports | `import`, `export` |

## 2. Dashboard definitions (single source: `packages/core/src/dashboard/definitions.ts`)
| Tile / list | Definition |
|---|---|
| कुल मेंबर (Active members) | `status=ACTIVE` and fee state ∈ {PAID, DUE_SOON, EXPIRED} (expired not yet auto-left) |
| आज आए (Came today) | Distinct members with non-voided attendance where `attendanceDate = today` |
| इस हफ्ते फीस (Due this week) | `ACTIVE`, fee state `DUE_SOON` (0–7 days); expected ₹ = sum of each member's last plan price at current prices |
| फीस बाकी (Overdue) | `ACTIVE`, fee state `EXPIRED` |
| आज के कॉल | `CallTask` OPEN, `dueDate ≤ today`, not snoozed; order by priority, then dueDate, then createdAt |
| आज जन्मदिन | BR-8 |
| जाँचना है | `VerificationRequest` PENDING |
| इस महीने (Money) | Sum of `Payment` PAID in current IST month (owner only) |

Home refresh: server-rendered, then TanStack Query refetch every 30 s while visible; instant invalidation after local mutations.

## 3. Permission matrix
| Capability | Owner | Reception | Trainer | Super admin |
|---|---|---|---|---|
| View home tiles & calls | ✓ | ✓ | view only | ✓ |
| View money totals / reports | ✓ | ✗ | ✗ | ✓ |
| Search/view members | ✓ | ✓ (mobile masked in lists) | ✓ (no phone) | ✓ |
| Add/edit member | ✓ | ✓ | ✗ | ✓ |
| Renew / record payment | ✓ | ✓ (setting) | ✗ | ✓ |
| Discount | ✓ | setting (max %) | ✗ | ✓ |
| Void payment | ✓ + PIN | ✗ | ✗ | ✓ + reason |
| Mark left / reactivate | ✓ / ✓ | ✓ / ✗ | ✗ | ✓ |
| Approve verification | ✓ | ✓ | ✗ | ✓ |
| Manual attendance | ✓ | ✓ | ✓ | ✓ |
| Call outcomes | ✓ | ✓ | ✗ | ✓ |
| Settings, staff, kiosk pairing | ✓ + PIN | ✗ | ✗ | ✓ |
| Export / delete member data | ✓ + PIN | ✗ | ✗ | ✓ (audit) |
| Simulator | demo only | demo only | ✗ | ✓ |

Enforced server-side in every service call (`assertCan(actor, 'payment.void')`), mirrored client-side only for hiding UI.

## 4. Background jobs used by CRM (worker)
| Job | Schedule (IST) | Does |
|---|---|---|
| `nightly-call-tasks` | 06:00 | BR-7 generation + auto-close cleared tasks |
| `nightly-lifecycle` | 02:30 | Auto-left (BR-4.3), cancel stale reservations, retention deletions, face template revocations |
| `owner-digest` | 08:30 | Builds and sends digest (skips if nothing to report) |
| `kiosk-offline-check` | every 10 min in gym hours | Alert if `lastSeenAt` > 30 min |
| `reminder-slot` | slot times | WhatsApp engine |
| `outbox-dispatch` | continuous (2 s poll) | Side effects |
| `receipt-pdf` | on demand | Renders receipts |
| `lead-followup` | every 15 min in gym hours | `NEW_LEAD` tasks older than 2 h |
| `refresh-landing` | on settings/plan change | Revalidate landing cache tag |

## 5. Alerts catalogue
| Type | Trigger | Channel (default) | Text key |
|---|---|---|---|
| EXPIRED_MEMBER_VISIT | attendance with fee state EXPIRED | Bell + WhatsApp to owner + web push | `alert.expiredVisit` |
| ONLINE_PAYMENT | payment PAID online | Bell + WhatsApp | `alert.onlinePayment` |
| NEW_LEAD | lead created | Bell + WhatsApp | `alert.newLead` |
| VERIFICATION_PENDING | QR existing submitted | Bell | `alert.verifyPending` |
| MEMBER_UNSUBSCRIBED | BR-6 | Bell | `alert.unsubscribed` |
| KIOSK_OFFLINE | heartbeat missing | Bell + WhatsApp (once/day) | `alert.kioskOffline` |
| WHATSAPP_FAILURE | slot failure rate > 20% | Bell + vendor email | `alert.waFailure` |
| WHATSAPP_QUALITY | quality/limit webhook | Bell + vendor | `alert.waQuality` |

Owner chooses which alerts also go to WhatsApp (Settings → Alerts).

## 6. Reports (owner)
| Card | Metric |
|---|---|
| Money this month | Sum PAID by method (cash/UPI/online/card), vs last month |
| New members | First confirmed memberships this month |
| Renewals | Confirmed memberships that start within grace of a previous one |
| Renewal rate | Renewed ÷ memberships that ended this month |
| Left | Members → LEFT this month, by reason (icons) |
| Busy hours | Attendance count by hour (bar), weekday vs weekend |
| Plan mix | Share of 1/3/6/12 month plans sold |
| Men/Women | Active split |
| Reminder impact | Renewals that happened after ≥ 1 reminder ÷ all renewals |
| Kiosk | Auto-recognised % of check-ins (FACE ÷ all) |

## 7. CSV import format (`assets/demo-data/member_import_template.csv`)
| Column | Required | Format | Example |
|---|---|---|---|
| full_name | ✓ | text | Sanjay Tomar |
| mobile | ✓ | 10 digits | 9876543210 |
| gender | ✓ | M/F | M |
| dob |  | DD-MM-YYYY | 14-02-1984 |
| email |  | email | |
| plan_months |  | 1/3/6/12 | 3 |
| month_end_date | ✓ | DD-MM-YYYY | 30-09-2026 |
| last_amount |  | rupees | 4000 |
| joined_on |  | DD-MM-YYYY | 05-06-2019 |
| notes |  | text | Morning batch |

Import wizard: upload → preview table with row errors (red) and warnings (duplicate mobile) → owner PIN → commit. Imported members are `ACTIVE` with declared memberships (`isDeclared=true`, `source=IMPORT`), `whatsappOptIn=false` until they confirm via QR (so no reminders to people who never consented), except where owner ticks "Members agreed to WhatsApp reminders at desk" per row group (recorded as desk consent).

## 8. PWA
- `manifest.webmanifest` scoped to `/crm`, name "Max Register", Hindi short name "रजिस्टर", theme colour Plate Navy.
- Service worker: cache app shell and static assets only; never cache API responses containing PII.
- Web push (optional) using VAPID for alerts.

## 9. Voice read-out
- Client `SpeakButton` builds a short sentence from the current view model using i18n templates and calls `speechSynthesis.speak()` with `lang='hi-IN'`, rate 0.95.
- If no Hindi voice is installed, fall back to English voice with English text and show a one-time tip "फ़ोन सेटिंग में हिंदी आवाज़ डाउनलोड करें".
