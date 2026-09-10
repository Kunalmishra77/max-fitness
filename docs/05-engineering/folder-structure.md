# Folder Structure (target)

Created progressively by the phase prompts. Do not create folders for later phases early.

> **Phase 1 deviation (ADR-010):** the whole `infra/` tree — Dockerfiles, `compose.*.yml`, `caddy/`, `scripts/` — is deferred to **Phase 8**. Development uses remote Supabase Postgres and needs no Docker. Phase 1 creates only `.github/workflows/ci.yml`.

```
max-fitness-platform/
├── CLAUDE.md                      # agent rules
├── AGENTS.md
├── README.md
├── .env.example
├── .gitignore
├── .nvmrc                          # 24
├── .editorconfig
├── package.json                    # root scripts, engines, packageManager
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── eslint.config.mjs               # flat config, shared
├── prettier.config.mjs
├── vitest.workspace.ts
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                  # lint, typecheck, unit, build
│   │   ├── e2e.yml                 # playwright on PR to main
│   │   ├── deploy-staging.yml
│   │   └── deploy-production.yml   # manual approval
│   ├── pull_request_template.md
│   └── dependabot.yml
│
├── apps/
│   ├── web/
│   │   ├── next.config.ts
│   │   ├── playwright.config.ts
│   │   ├── messages/               # next-intl
│   │   │   ├── en.json
│   │   │   └── hi.json
│   │   ├── content/legal/          # privacy.md, terms.md, refund.md
│   │   ├── public/
│   │   │   ├── media/hero/         # optimised videos + posters
│   │   │   ├── media/photos/
│   │   │   ├── icons/ manifest.webmanifest (CRM PWA)
│   │   │   └── og.png
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── [locale]/
│   │   │   │   │   ├── (marketing)/
│   │   │   │   │   │   ├── page.tsx                  # landing
│   │   │   │   │   │   ├── @modal/(.)join/page.tsx   # intercepted signup modal
│   │   │   │   │   │   ├── legal/[slug]/page.tsx
│   │   │   │   │   │   └── contact/page.tsx
│   │   │   │   │   ├── join/                          # full-page signup flow
│   │   │   │   │   │   ├── page.tsx                   # step 1
│   │   │   │   │   │   ├── plan/page.tsx              # step 2
│   │   │   │   │   │   ├── pay/page.tsx               # step 3
│   │   │   │   │   │   └── done/page.tsx              # confirmation
│   │   │   │   │   ├── qr/
│   │   │   │   │   │   ├── page.tsx                   # existing / new choice
│   │   │   │   │   │   ├── existing/page.tsx
│   │   │   │   │   │   └── new/page.tsx
│   │   │   │   │   ├── renew/[token]/page.tsx
│   │   │   │   │   ├── r/[token]/page.tsx             # receipt
│   │   │   │   │   └── stop/[token]/page.tsx          # unsubscribe web fallback
│   │   │   │   ├── crm/
│   │   │   │   │   ├── login/page.tsx
│   │   │   │   │   ├── (app)/layout.tsx               # bottom nav, auth guard
│   │   │   │   │   ├── (app)/page.tsx                 # Home "Today"
│   │   │   │   │   ├── (app)/members/page.tsx
│   │   │   │   │   ├── (app)/members/new/page.tsx
│   │   │   │   │   ├── (app)/members/[id]/page.tsx
│   │   │   │   │   ├── (app)/members/[id]/renew/page.tsx
│   │   │   │   │   ├── (app)/fees/page.tsx
│   │   │   │   │   ├── (app)/attendance/page.tsx
│   │   │   │   │   ├── (app)/calls/page.tsx
│   │   │   │   │   ├── (app)/verify/page.tsx
│   │   │   │   │   ├── (app)/leads/page.tsx
│   │   │   │   │   ├── (app)/messages/page.tsx        # log + simulator (demo)
│   │   │   │   │   ├── (app)/alerts/page.tsx
│   │   │   │   │   ├── (app)/reports/page.tsx
│   │   │   │   │   ├── (app)/settings/...             # prices, reminders, staff, kiosk, promo
│   │   │   │   │   └── (app)/import/page.tsx
│   │   │   │   └── api/v1/
│   │   │   │       ├── leads/route.ts
│   │   │   │       ├── registrations/route.ts
│   │   │   │       ├── plans/route.ts
│   │   │   │       ├── checkout/orders/route.ts
│   │   │   │       ├── checkout/verify/route.ts
│   │   │   │       ├── checkout/status/route.ts
│   │   │   │       ├── otp/send/route.ts, otp/verify/route.ts
│   │   │   │       ├── qr/existing/route.ts, qr/new/route.ts
│   │   │   │       ├── renew/[token]/route.ts
│   │   │   │       ├── webhooks/razorpay/route.ts
│   │   │   │       ├── webhooks/whatsapp/route.ts
│   │   │   │       ├── kiosk/pair/route.ts, sync/route.ts, attendance/route.ts,
│   │   │   │       │   enrollment-jobs/route.ts, templates/route.ts, heartbeat/route.ts,
│   │   │   │       │   lookup/route.ts
│   │   │   │       ├── crm/...                         # JSON endpoints used by client components
│   │   │   │       ├── files/[id]/route.ts             # signed private file access
│   │   │   │       └── health/route.ts
│   │   │   ├── components/
│   │   │   │   ├── marketing/  (Hero, TrustStrip, FeeBoard, ChampionPlaque, Faq, …)
│   │   │   │   ├── join/       (SelfieCapture, DobSelect, GenderSelect, PlanPicker, …)
│   │   │   │   ├── crm/        (MemberRow, FeeStateBand, StatTile, CallTaskCard, UndoBar, SpeakButton, …)
│   │   │   │   └── ui/         (Button, Input, Sheet, Dialog, Toast, … token-styled primitives)
│   │   │   ├── lib/            (auth/session.ts, permissions.ts, rate-limit.ts, container.ts DI wiring, analytics.ts)
│   │   │   ├── styles/         (globals.css, tokens.css)
│   │   │   └── proxy.ts / middleware  # locale + crm auth redirect (per Next.js version convention)
│   │   └── tests/e2e/          (signup.spec.ts, qr-existing.spec.ts, crm-renew.spec.ts, …)
│   │
│   ├── worker/
│   │   ├── src/
│   │   │   ├── index.ts                # boot, pg-boss, graceful shutdown
│   │   │   ├── schedules.ts            # cron registrations (IST)
│   │   │   ├── jobs/
│   │   │   │   ├── reminder-slot.ts
│   │   │   │   ├── whatsapp-send.ts
│   │   │   │   ├── whatsapp-inbound.ts
│   │   │   │   ├── outbox-dispatch.ts
│   │   │   │   ├── nightly-call-tasks.ts
│   │   │   │   ├── nightly-lifecycle.ts   # auto-left, face deletion, retention
│   │   │   │   ├── owner-digest.ts
│   │   │   │   ├── receipt-pdf.ts
│   │   │   │   └── kiosk-offline-check.ts
│   │   │   └── container.ts
│   │   └── Dockerfile
│   │
│   └── kiosk-android/
│       ├── settings.gradle.kts, build.gradle.kts, gradle/libs.versions.toml
│       └── app/src/main/
│           ├── AndroidManifest.xml
│           ├── assets/models/          # face model files (licensed) — not committed if licence forbids
│           └── java/in/maxfitness/haazri/
│               ├── HaazriApp.kt
│               ├── kiosk/              (LockTaskController, BootReceiver, AdminReceiver, ScreenPolicy)
│               ├── camera/             (CameraController, FrameAnalyzer)
│               ├── face/               (FaceEngine.kt interface, MlKitDetector, Aligner, EmbeddingModel, LivenessModel, Matcher, QualityGate)
│               ├── attendance/         (DecisionMachine, CooldownPolicy, AttendanceRepository)
│               ├── enroll/             (EnrollmentJobWorker, AssistedEnrollmentScreen)
│               ├── data/               (Room db, dao, entities, SQLCipher, crypto)
│               ├── sync/               (ApiClient, SyncWorker, HeartbeatWorker, Pairing)
│               ├── ui/                 (IdleScreen, WelcomeScreen, ConfirmScreen, KeypadScreen, AdminScreen, theme)
│               └── voice/              (Speaker)
│
├── packages/
│   ├── core/
│   │   └── src/
│   │       ├── pricing/         (plans.ts, pricing.ts, pricing.test.ts)
│   │       ├── membership/      (dates.ts, fee-state.ts, renewal.ts, *.test.ts)
│   │       ├── members/         (member.service.ts, unsubscribe.ts, lifecycle.ts)
│   │       ├── payments/        (payment.service.ts, receipt-number.ts)
│   │       ├── reminders/       (rules.ts, engine.ts, eligibility.ts, engine.test.ts)
│   │       ├── calls/           (call-task.rules.ts, call-task.service.ts)
│   │       ├── attendance/      (attendance.service.ts, cooldown.ts)
│   │       ├── verification/    (verification.service.ts)
│   │       ├── leads/           (lead.service.ts)
│   │       ├── consent/         (consent.service.ts, notice-versions.ts)
│   │       ├── digest/          (owner-digest.ts)
│   │       ├── tokens/          (signed-links.ts)
│   │       ├── ports/           (Clock, WhatsAppProvider, PaymentProvider, StorageDriver, Outbox interfaces)
│   │       └── errors.ts
│   ├── db/
│   │   ├── prisma/schema.prisma          # copy from docs/05-engineering/database/schema.prisma
│   │   ├── prisma/migrations/
│   │   ├── seed/ (index.ts, scenarios.ts, names.ts, attendance.ts)
│   │   └── src/ (client.ts, repositories/*)
│   ├── shared/
│   │   └── src/ (schemas/*.ts, types.ts, constants.ts, env.ts, time/*.ts, phone.ts, mask.ts, money.ts)
│   ├── integrations/
│   │   └── src/
│   │       ├── whatsapp/ (meta-cloud.ts, simulator.ts, webhook-verify.ts, payloads.ts)
│   │       ├── payments/ (razorpay.ts, simulated.ts, signature.ts)
│   │       ├── storage/  (local.ts, s3.ts)
│   │       └── otp/
│   └── config/ (tsconfig, eslint presets)
│
├── infra/
│   ├── docker/
│   │   ├── compose.dev.yml            # postgres, mailpit (optional)
│   │   ├── compose.staging.yml
│   │   ├── compose.production.yml
│   │   └── web.Dockerfile
│   ├── caddy/Caddyfile
│   ├── scripts/
│   │   ├── bootstrap-vps.sh            # users, ufw, fail2ban, docker, unattended-upgrades
│   │   ├── deploy.sh
│   │   ├── backup.sh / restore.sh
│   │   └── generate-qr-poster.ts
│   └── README.md
│
├── docs/                              # this blueprint
└── assets/                            # brand, photos, videos, demo data (raw media not in git)
```

## Dependency rules (enforced by ESLint `import/no-restricted-paths` or dependency-cruiser)
- `packages/shared` → no internal deps.
- `packages/core` → `shared` only (plus `db` types via repository interfaces).
- `packages/integrations` → `shared`, `core/ports`.
- `packages/db` → `shared`.
- `apps/*` → any package. Packages never import apps.
