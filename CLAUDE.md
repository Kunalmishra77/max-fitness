# CLAUDE.md — Operating rules for AI coding agents

You are building the **Max Fitness Platform**: a public website with sign-up and payments, an owner CRM called **Max Register**, QR onboarding, a WhatsApp reminder engine, and an Android face-attendance kiosk called **Max Haazri**, for Max Fitness Gym, Indirapuram, Ghaziabad.

## 1. Sources of truth — read before writing code

| Topic | File |
|---|---|
| What and why | `docs/02-product/PRD.md` |
| Every date, price, status and reminder rule | `docs/02-product/business-rules.md` |
| Stack, NFRs, conventions | `docs/05-engineering/TRD.md` |
| Architecture | `docs/05-engineering/system-architecture.md` |
| Folder layout | `docs/05-engineering/folder-structure.md` |
| Database | `docs/05-engineering/database/schema.prisma` + `database-design.md` |
| API contracts | `docs/05-engineering/api-specification.md` |
| Visual design | `docs/03-design/DESIGN-BLUEPRINT.md`, `docs/03-design/design-tokens.json` |
| CRM UX | `docs/03-design/crm-ux-blueprint.md` |
| Copy | `docs/04-content/website-copy-deck.md`, `docs/04-content/whatsapp-templates.md` |
| Security and privacy | `docs/07-security-compliance/*` |
| Tests | `docs/08-quality/testing-strategy.md` |
| Current phase task | the prompt you were given from `docs/11-prompts/` |

If a document is silent on something, choose the simplest option consistent with the docs, then record the decision in `docs/10-delivery/decision-log.md`. Never invent a business rule silently.

## 2. Non-negotiable engineering rules

1. **Money is integer paise** (`amountPaise: Int`). Never floats. Format only at the UI edge.
2. **Business dates are `DATE` in Asia/Kolkata**; event timestamps are UTC `timestamptz`. Use only `packages/shared/src/time/*` helpers. Never call `new Date()` for business dates inside domain code — inject a clock.
3. **All inputs validated with Zod** schemas exported from `packages/shared`. Same schema on client and server.
4. **Domain logic lives in `packages/core`** as pure, tested functions and services. Route handlers, server actions and jobs are thin. No Prisma calls inside React components.
5. **External side effects are idempotent.** WhatsApp sends, payment captures and attendance events carry an idempotency key with a unique DB constraint.
6. **Check eligibility at send time**, not only at schedule time (a member may have renewed or unsubscribed minutes ago).
7. **`DEMO_MODE=true`** means: payments are simulated, WhatsApp messages go to the in-app Message Simulator, and real sends are allowed only to numbers in `WHATSAPP_ALLOWLIST`.
8. **Privacy by default.** Selfies and face templates are private objects served only through short-lived signed URLs. Never log full mobile numbers, emails, tokens or images; use the masking helpers.
9. **i18n.** CRM default language is Hindi (`hi`), with English (`en`) toggle. Website default English with Hindi toggle. No hard-coded UI strings.
10. **Mobile first.** Every screen must work at 360px width. CRM touch targets ≥ 56px.
11. **Tests first for `packages/core`** (pricing, membership dates, reminder engine, call-task rules, attendance cooldown). Use a fake clock.
12. **Secrets never committed.** When you add an env var, add it to `.env.example` with a comment.
13. **Stay in phase.** Only do what the current phase prompt asks. At the end of every session append to `docs/10-delivery/progress-log.md`: what changed, what is pending, any decisions.
14. **Pin versions.** Use the latest stable patch of the chosen majors (see TRD §3) and commit the lockfile. Check framework security advisories before release.

## 3. Commands (created in Phase 1)

Development runs against **remote Supabase Postgres (Mumbai)**. No local command requires Docker.

```
pnpm install
pnpm dev              # web + worker
pnpm build
pnpm lint && pnpm typecheck
pnpm test             # vitest across packages
pnpm test:e2e         # playwright (apps/web)
pnpm db:migrate       # prisma migrate dev
pnpm db:seed          # realistic demo data (see docs/05-engineering/demo-data-seed-spec.md)
pnpm db:reset
pnpm db:studio        # prisma studio
```

## 4. Definition of done (every task)

- Types pass, lint passes, unit tests for new logic pass.
- Works at 360px and 1440px; keyboard focus visible; no console errors.
- Strings in i18n files; loading, empty and error states designed.
- No PII in logs; new env vars documented.
- Progress log updated.
