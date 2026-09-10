# 04 — Phase 4: Max Register CRM Core

```text
Phase 4: the owner CRM. The owner studied up to 5th standard — simplicity beats features.

Read first: CLAUDE.md; docs/03-design/crm-ux-blueprint.md (ALL — this is the most important doc for this phase); docs/01-project/05-glossary.md; PRD §5.5; business-rules BR-4, BR-7, BR-8, BR-9; docs/05-engineering/crm-module-spec.md; api-specification.md §5–6; security-plan.md §3.1 AuthN/AuthZ.

Step A — before coding UI: produce low-fidelity screens (simple React pages with static data are fine) for Home, Member row, Profile, Renew (3 taps), Calls, in Hindi, at 360px. Stop and show me so the founder can test them with the owner.

Step B — build:
1. /crm/login: mobile + PIN keypad (big buttons), Argon2id verify, lockout, sessions table, trusted device, logout; PIN re-prompt elevation helper.
2. Permissions module (crm-module-spec §3) with unit tests for every capability × role; server-side assertCan in every service.
3. (app) layout: bottom tab bar (होम, मेंबर, फीस, हाज़िरी, और), floating + button, alerts bell with count, language toggle, SpeakButton.
4. Home dashboard exactly per UX §3 using dashboard definitions in packages/core (one aggregated query); 30 s refetch while visible.
5. MemberRow, members list with instant search (name, digits, code), filters by fee state/status.
6. Member profile per UX §5 incl. attendance month dots, plan/payment history, messages (from MessageLog), notes.
7. Add member wizard (photo first; one question per screen) → optional renew/payment in same flow.
8. Renew in 3 taps with desk payment methods, optional discount (permission), receipt outbox, UndoBar (10 s; implement as delayed commit or compensating void — document choice in decision-log).
9. Mark left (reason icons), reactivate (owner), pause reminders until date, guardian consent capture, face enrol request.
10. Fees tabs; Calls list with outcomes; nightly-call-tasks job implementing BR-7 generation + auto-close; lead-followup job.
11. Birthdays; Alerts page; Attendance today/absent/manual mark with undo; Leads pipeline basic.
12. Reports cards (owner only) per crm-module-spec §6.
13. Settings (owner + PIN): prices (revalidate landing tag), hours, promo, trust numbers, staff management, language/voice, kill switch placeholder.
14. Privacy actions: export member JSON, delete member (erasure workflow), audit logging.
15. PWA manifest + minimal service worker (app shell only; never cache API data).
16. All strings in hi.json/en.json using the glossary terms exactly. Hindi default.
17. Tests: permission matrix, dashboard definitions against seeded data, Playwright journeys 9–11, visual snapshots of Home/Profile/Renew at 360px.

Accessibility & UX bar: touch targets ≥ 56px, contrast ≥ 7:1 for primary text, colour never the only signal (icon + text), every list has empty/loading/error states.
Finish: record a short screen capture script for the owner demo (steps + expected results) in docs/09-operations/owner-training-and-handover.md appendix; update progress-log.md.
```
