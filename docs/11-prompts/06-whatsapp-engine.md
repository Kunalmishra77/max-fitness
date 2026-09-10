# 06 — Phase 6: WhatsApp Automation Engine

```text
Phase 6: reminders, unsubscribe, receipts, digests, alerts.

Read first: CLAUDE.md; docs/05-engineering/whatsapp-automation-engine.md (ALL); docs/04-content/whatsapp-templates.md; business-rules BR-5, BR-6; PRD §5.6; database-design.md §4.2; testing-strategy.md §4 (R1–R25); api-specification.md (webhooks/whatsapp); security-plan.md (webhooks, tokens).

Build:
1. packages/core/reminders: rules loader, planSlot, eligibility (complete from Phase 1 pure functions), variable builder (en/hi phrases), payload tokens.
2. Repository method for reminder candidates using the SQL in database-design §4.2 (parameterised; tested against seeded data and against the pure-function engine for parity).
3. Worker: dynamic slot cron registration in Asia/Kolkata from enabled rules; catch-up on boot (same day only) using the JobRun table (unique jobName+runKey prevents double runs); whatsapp-send handler with idempotent MessageLog insert, eligibility re-check, retries with backoff inside quiet hours, error classification.
4. packages/integrations/whatsapp/meta-cloud.ts: sendTemplate (body params, URL button param, quick_reply payload), sendText, sendInteractiveButtons, sendInteractiveList; Graph API version from env; typed errors. Verify request/response field names against current official Cloud API docs before finalising.
5. Webhook route GET verification + POST with X-Hub-Signature-256 verification over raw body; WebhookEvent persistence; whatsapp-inbound job handling statuses, button payloads (UNSUB/RESTART), interactive replies, keywords (STOP/UNSUBSCRIBE/बंद/band/RESTART), shared-number disambiguation list, quality/template status events.
6. Unsubscribe and restart transactions (BR-6), confirmation free-form messages, owner alert, call task, kiosk gallery change outbox.
7. Other messages: receipt, welcome, verification approved, owner digest job 08:30 (skips empty), owner alerts with bundling, birthday wish (owner-triggered).
8. Safeguards: quiet hours validation, per-number daily cap, slot failure guard, quality auto-pause of POST rule, kill switch (owner PIN) in Settings.
9. CRM: Messages log per member and global, pause reminders, reminder settings UI (slot times, cap slider with warning text, toggles per rule).
10. Message Simulator (non-production only): 30-day projected timeline; "Advance time" using fake clock that runs slots and renders WhatsApp-style bubbles with working Renew/Unsubscribe buttons that go through the real inbound handlers.
11. Tests: every row R1–R25 as unit or integration tests; webhook signature tests with recorded fixtures; E2E journey 8.
12. Live test plan: with WHATSAPP_PROVIDER=meta_cloud and DEMO_MODE=true, send to allowlisted numbers only; document template approval status and categories in decision-log.md.
Finish: update progress-log.md.
```
