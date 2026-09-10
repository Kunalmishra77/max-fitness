# Coding Standards & Workflow

## 1. Git
- Trunk-based: `main` protected; short-lived branches `feat/…`, `fix/…`, `chore/…`.
- Conventional Commits (`feat(crm): renew in three taps`).
- PR template: summary, screenshots (360px + desktop), tests added, docs updated, env vars, migration notes.
- Squash merge; CI must pass; 1 review (human or designated reviewer).

## 2. TypeScript
- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- No `any` (use `unknown` + Zod). No non-null assertions except in tests.
- Exported functions have explicit return types in `packages/core`.
- Prefer pure functions; side effects at edges.
- Errors: throw `DomainError(code, meta)`; never throw strings.

## 3. Naming
- Files `kebab-case.ts`; React components `PascalCase.tsx`; hooks `use-*.ts`.
- DB models PascalCase singular; enums SCREAMING_CASE values.
- i18n keys `area.component.purpose` (e.g., `crm.home.tiles.overdue`).

## 4. React / Next.js
- Server Components by default; `"use client"` only for interactivity.
- Data mutations via Server Actions calling core services, with Zod validation and `assertCan`.
- No data fetching in `useEffect` for initial render; use RSC or TanStack Query.
- Components accept typed props; no business rules in components (call `packages/core` helpers like `feeStateLabel`).
- Every async UI has loading, empty, error states.
- Images via `next/image`; videos with explicit width/height/poster to avoid CLS.

## 5. Styling
- Tailwind utilities mapped to tokens; no raw hex in components.
- Component variants with `class-variance-authority`; avoid conflicting selectors.
- Respect `prefers-reduced-motion`.

## 6. Testing
- Unit tests colocated `*.test.ts`; integration tests in `tests/integration`; E2E in `apps/web/tests/e2e`.
- Fake clock for anything date-related; never depend on the real current date.
- Test names describe behaviour: `it('stops reminders after renewal')`.

## 7. Security & privacy in code
- Never log request bodies of registration, payment, kiosk templates.
- `mask.mobile('+919876543210') → '+91 98xxxxx210'`.
- All file access through signed URLs; no public buckets.
- Raw body preserved for webhook routes (`await req.text()` before JSON parse).

## 8. Android (kiosk)
- Kotlin, coroutines + Flow, Compose UI, Hilt DI.
- Camera/ML work off main thread; frame analyzer must not allocate per frame (reuse buffers).
- `FaceEngine` implementations behind interface; unit tests for Matcher, DecisionMachine, CooldownPolicy with synthetic vectors.
- ktlint + detekt in CI.

## 9. Definition of Ready (before a task starts)
Linked PRD ID, acceptance criteria, design reference, API contract, test notes.

## 10. Definition of Done
See `CLAUDE.md` §4, plus: reviewed, merged, deployed to staging, demo-able.
