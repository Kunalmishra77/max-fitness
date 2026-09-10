# Testing Strategy

## 1. Test pyramid
| Level | Tool | Scope | Target |
|---|---|---|---|
| Unit | Vitest | `packages/core` rules (pricing, dates, fee state, reminders, calls, cooldown, tokens), shared utils | ≥ 80% lines in core; 100% of business-rule examples |
| Component | Vitest + Testing Library | Selfie capture states, plan picker, CRM MemberRow, Renew flow, UndoBar | Key states |
| Integration | Vitest + `TEST_DATABASE_URL` (separate Supabase project) locally; Postgres 17 **service container** in CI | Services with real DB: confirmPayment idempotency, unsubscribe transaction, reminder candidate SQL, verification approve, attendance ingest | All money/state transitions. Skipped with a clear message when `TEST_DATABASE_URL` is unset — no Docker is required locally (ADR-010) |
| Contract | Vitest + recorded fixtures | Razorpay & WhatsApp webhook payloads, signature verification | All handled event types |
| E2E | Playwright | Critical journeys on staging-like env with DEMO providers | 12 journeys (§3) |
| Visual | Playwright screenshots | Landing, signup, CRM Home at 360/768/1440 | Diff on PR |
| Accessibility | axe-core in Playwright | Public pages + signup | 0 serious/critical |
| Performance | Lighthouse CI | Landing mobile | LCP ≤ 2.5 s, CLS ≤ 0.1 |
| Security | ZAP baseline, manual IDOR checks | Staging | Phase 8 |
| Android unit | JUnit + Robolectric | Matcher, DecisionMachine, Cooldown, Sync mapping | Core logic |
| Android instrumented | Espresso/Compose test | Kiosk screens, pairing, offline queue | Key flows |
| Field tests | Manual protocol | Face POC, soak, reboot, offline | `attendance-face-recognition-system.md` §13–14 |
| Usability | Moderated sessions | Owner 5-task test | All tasks unaided |

## 2. Test data & clocks
- `FakeClock` for all core tests; helper `ist('2026-09-10T19:00')`.
- Factory builders (`buildMember`, `buildMembership`) with sensible defaults.
- DB integration tests run migrations once per worker, truncate between tests. They need `TEST_DATABASE_URL`; without it the suite skips rather than fails, so `pnpm test` is green on a fresh clone.
- Unit tests must never touch a database (ADR-010).
- E2E uses `SEED_TODAY` for determinism.

## 3. E2E journeys (Playwright)
1. Landing loads, hero slider pause/play, plans toggle shows female prices.
2. Lead form submit → success; CRM shows lead + call task.
3. Signup with **fake camera** (`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`, `--use-file-for-fake-video-capture=tests/fixtures/face.y4m`) → plan → simulated payment success → confirmation → CRM member ACTIVE.
4. Signup camera denied → fallback file upload path works.
5. Payment failure → retry → pay at reception → CRM pending payment → desk record → ACTIVE.
6. Renew link from simulator message → pay → reminders timeline shows no further messages.
7. QR existing → verification approve → membership with declared date → simulator shows reminders from correct day.
8. Simulator: advance to E+1 → 3 messages → tap Unsubscribe → member LEFT, no more messages after advancing 3 days.
9. CRM login lockout after 5 wrong PINs.
10. Reception role cannot access Settings or void payment (403 + hidden UI).
11. Manual attendance + undo.
12. CSV import with errors preview → commit valid rows.

## 4. Reminder engine test matrix (unit + integration)
| # | Case | Expected |
|---|---|---|
| R1 | endDate = T+7, slot 10:00 | 1 PRE_7 intent |
| R2 | endDate = T+7, slot 19:00 | none |
| R3 | endDate = T+5 | none |
| R4 | T+3, T+2, T+1 at 10:00 | one intent each day |
| R5 | endDate = T, 10:00 | DUE_TODAY (if enabled) |
| R6 | endDate = T−1, slots 09:30/14:00/19:00 | 3 POST intents |
| R7 | endDate = T−8, cap 7 | none + call task exists |
| R8 | cap null, endDate = T−40 | 3 intents (warning setting) |
| R9 | Renewed yesterday (upcoming membership exists) with old end T+2 | none |
| R10 | Renewed between 14:00 and 19:00 on T−1 day | 14:00 sent, 19:00 skipped at eligibility re-check |
| R11 | Unsubscribed at 10:05 | 14:00 and later: none |
| R12 | remindersPausedUntil = T+3 | none until T+4 |
| R13 | whatsappOptIn false | none |
| R14 | status PENDING_VERIFICATION | none |
| R15 | Duplicate cron fire same slot | exactly one MessageLog per key |
| R16 | Worker down 10:00, restarts 11:30 | catch-up sends 10:00 intents once |
| R17 | Worker down all day, restarts next day | no back-fill for missed day |
| R18 | Quiet hours slot misconfigured to 22:00 | rejected by settings validation |
| R19 | Shared number, 2 members due same slot | 2 personalised intents; number cap respected |
| R20 | Month-end: start 31 Jan 1M | endDate 27 Feb (BR-3.1); PRE_7 on 20 Feb |
| R21 | Leap year: start 29 Feb 2028 12M | endDate 27 Feb 2029 |
| R22 | Language hi vs en | correct template language code & phrase |
| R23 | Tampered unsubscribe payload | rejected, no state change, logged |
| R24 | Restart within 7 days | member ACTIVE, reminders resume next slot |
| R25 | Restart after 7 days | rejected with owner-contact reply |

## 5. Payment test matrix
| # | Case | Expected |
|---|---|---|
| P1 | verify then webhook | single activation, one receipt number |
| P2 | webhook then verify | same |
| P3 | two webhooks concurrently | one activation (row lock) |
| P4 | amount mismatch in webhook | not activated, alert |
| P5 | invalid checkout signature | 422, payment stays CREATED |
| P6 | renewal within grace | start = old end + 1 |
| P7 | renewal after grace | start = payment date |
| P8 | receipt numbering across FY boundary (31 Mar → 1 Apr) | new FY counter starts at 1 |
| P9 | desk payment void | membership back to PENDING_PAYMENT, audit row |

## 6. Attendance test matrix
Duplicate clientEventId; cooldown boundary (179 vs 181 min); ineligible (LEFT) member event; expired member alert once per day; clock offset correction; batch of 200 mixed results; offline 24 h replay.

## 7. Non-functional tests
- Load (k6): 50 concurrent CRM users (overkill) + 150 attendance events/hour + webhook bursts of 100/min → p95 targets.
- Soak: worker 72 h with fake clock accelerated slots (staging) → no memory leak, no duplicate sends.
- Backup/restore drill timed against RTO.

## 8. CI gates
PR: lint, typecheck, unit, component, integration (Testcontainers), build. Main: + E2E, Lighthouse CI, axe. Release: + ZAP baseline (staging), manual UAT sign-off.

## 9. Bug severity
| Sev | Definition | Fix SLA |
|---|---|---|
| S1 | Money wrong, wrong/duplicate reminders to members, data leak, site down | Hotfix same day |
| S2 | Core journey blocked with workaround | 2 days |
| S3 | Minor functional/UI issue | Next sprint |
| S4 | Cosmetic | Backlog |
