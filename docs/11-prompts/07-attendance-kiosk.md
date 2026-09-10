# 07 — Phase 7: Max Haazri Attendance Kiosk (production)

```text
Phase 7: production kiosk app + server integration. Precondition: POC go decision and a commercially licensed FaceEngine recorded in decision-log.md.

Read first: CLAUDE.md; docs/05-engineering/attendance-face-recognition-system.md (ALL); api-specification.md §7; business-rules BR-9, BR-12; DESIGN-BLUEPRINT §10; privacy doc §4–5; security-plan §3.4; the POC report.

Server (apps/web + core):
1. Kiosk endpoints: pair, sync (delta cursor, eligibility filter, template decryption only for paired devices), attendance batch ingest (idempotent, cooldown, fee state, EXPIRED alerts & call task, lastAttendanceAt), enrollment-jobs claim, templates upload (cap per member, eviction), lookup (keypad), heartbeat (commands, serverTime).
2. Device token issuance (hash + pepper), revocation, pairing codes (6 digits, 10 min, hashed).
3. FaceTemplate field encryption (AES-256-GCM with key id), retention/revocation jobs.
4. CRM: attendance phone status card, pairing screen, revoke, shadow-mode toggle, thresholds (owner/vendor only), kiosk-offline-check job + alert.

Android (apps/kiosk-android):
5. Project per folder-structure.md; Hilt; Compose; theme from design tokens; minSdk 29.
6. Kiosk: AdminReceiver, Device Owner lock task, boot receiver, keep screen on, idle dim & burn-in shift, crash restart, thermal listener.
7. Camera pipeline with adaptive fps and zero per-frame allocation in analyzer.
8. FaceEngine production implementation (licensed), quality gate, aligner, matcher over in-memory gallery, liveness, decision state machine (spec §6) with parameters from server settings.
9. Screens: idle, welcome (paid/due soon), expired (no amounts), already marked, confirm, unknown, keypad with photo candidates, admin (PIN), assisted enrolment, pairing.
10. Data: Room + SQLCipher with Keystore-wrapped key; encrypted token storage; queue table; purge policy.
11. Sync: WorkManager periodic + expedited uploads; heartbeat worker; command handling (SYNC_NOW, RELOAD_SETTINGS, WIPE_AND_UNPAIR).
12. Voice: Android TextToSpeech hi-IN with graceful fallback.
13. Tests: unit tests for matcher, decision machine, cooldown, sync mapping; instrumented UI tests for screens; acceptance tests from spec §14 executed on the real device with a written report.
14. Provisioning guide in infra/README.md (Device Owner commands, pairing, signage).
Finish: update progress-log.md; start 2-week shadow mode plan.
```
