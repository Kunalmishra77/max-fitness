# 08 — Phase 8: Hardening, UAT & Launch

```text
Phase 8: make it production-ready and launch.

Read first: CLAUDE.md; docs/07-security-compliance/* (checklists); docs/08-quality/testing-strategy.md and uat-checklist.md; docs/09-operations/* (deployment, runbook, training); PRD §8 release criteria.

Do:
1. Security: run the security-plan pre-launch checklist item by item; enforce CSP (test Razorpay checkout, maps, MediaPipe WASM); IDOR tests across roles for every /crm and /api route; rate limits verified; gitleaks scan; ZAP baseline on staging and fix findings; Sentry PII scrubbing verified with a test event.
2. Privacy: retention jobs tested with fake clock; consent withdrawal flows; minor handling; export/erasure; privacy policy final text inserted after client review.
3. Performance: Lighthouse CI budgets; k6 scenario per testing-strategy §7; worker soak with accelerated fake clock on staging; EXPLAIN ANALYZE key queries on a 2k-member synthetic dataset; add indexes if needed.
4. Reliability: backup + automated restore test + manual drill logged; uptime monitors; alert routing; rollback rehearsal (deploy previous sha on staging).
5. Production setup per deployment-plan §5; production seed with owner one-time PIN; live Razorpay and WhatsApp configuration; webhooks verified with test events; DEMO_MODE=false boot guard.
6. UAT with owner per uat-checklist.md; fix S1/S2 bugs; get sign-off.
7. Training materials: laminated guide PDF (Hindi, icons) generated from docs; short training video script.
8. Go-live per deployment-plan §7–8; hypercare schedule.
Finish: final progress-log entry, update README with production URLs (no secrets), handover checklist complete.
```
