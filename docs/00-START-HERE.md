# Start Here — Document Map

## Reading order by role
| Role | Read |
|---|---|
| Founder / PM | 01-project/* → 02-product/PRD.md → 10-delivery/development-roadmap.md → 09-operations/cost-estimate.md |
| Tech lead | 01-project/01-project-analysis.md → 05-engineering/TRD.md → system-architecture.md → database/* → api-specification.md → module specs → 07-security-compliance/* |
| Full stack | business-rules.md → database/* → api-specification.md → signup-and-payment-flow.md → whatsapp-automation-engine.md → qr-onboarding-flow.md |
| Frontend | DESIGN-BLUEPRINT.md → landing-page-wireframes.md → crm-ux-blueprint.md → design-tokens.json → website-copy-deck.md |
| UI/UX | DESIGN-BLUEPRINT.md → crm-ux-blueprint.md → personas-and-user-journeys.md → assets-checklist-and-shot-list.md |
| Android | attendance-face-recognition-system.md → api-specification.md §7 → security-plan.md §3.4 |
| QA | PRD.md → business-rules.md → testing-strategy.md → uat-checklist.md |
| Content / marketing | content-strategy-and-seo.md → website-copy-deck.md → whatsapp-templates.md → assets/owner-story/README.md |
| AI coding agent | CLAUDE.md → the phase prompt in 11-prompts/ (it lists what to read) |

## All documents
### 01 Project
- `01-project-analysis.md` — evidence, needs, key decisions, brief gaps & resolutions, risks, KPIs
- `02-scope-and-deliverables.md` — in/out of scope, deliverables
- `03-client-inputs-and-open-questions.md` — questionnaire with defaults (send to owner)
- `04-risk-register.md`
- `05-glossary.md` — English ⇄ Hindi UI vocabulary

### 02 Product
- `PRD.md` — requirements with IDs & acceptance criteria
- `business-rules.md` — pricing, dates, statuses, reminders, unsubscribe, call tasks, attendance
- `personas-and-user-journeys.md`

### 03 Design
- `DESIGN-BLUEPRINT.md` — brand concept, colour, type, layout, signature elements, motion, components, kiosk visuals
- `landing-page-wireframes.md` — every landing section + sign-up modal + QR screens
- `crm-ux-blueprint.md` — low-literacy CRM principles and screens
- `design-tokens.json`

### 04 Content
- `content-strategy-and-seo.md` — positioning, voice, keywords, schema, GBP, reviews, social
- `website-copy-deck.md` — all copy EN/HI
- `assets-checklist-and-shot-list.md`
- `whatsapp-templates.md` — all templates EN/HI with buttons and payloads

### 05 Engineering
- `TRD.md` — stack, rendering, conventions, NFRs, integrations, environments
- `system-architecture.md` — context/container/component diagrams, data flows, outbox, boundaries, failure modes
- `folder-structure.md`
- `database/schema.prisma` (validated, Prisma 7) · `database/database-design.md`
- `api-specification.md`
- `signup-and-payment-flow.md`
- `qr-onboarding-flow.md`
- `crm-module-spec.md`
- `whatsapp-automation-engine.md`
- `attendance-face-recognition-system.md`
- `demo-data-seed-spec.md`
- `coding-standards.md`

### 06 Diagrams
- `diagrams.md` — ERD, lifecycle, fee state, sequences, deployment pipeline, Gantt

### 07 Security & compliance
- `security-plan.md` · `privacy-and-dpdp-compliance.md`

### 08 Quality
- `testing-strategy.md` · `uat-checklist.md`

### 09 Operations
- `deployment-plan.md` · `runbook-monitoring-backups.md` · `owner-training-and-handover.md` · `cost-estimate.md`

### 10 Delivery
- `development-roadmap.md` · `implementation-backlog.md` · `decision-log.md` · `progress-log.md`

### 11 Prompts
- `README.md` · `00-FIRST-PROMPT.md` … `08-hardening-launch.md`

## Rendering diagrams
Mermaid blocks render on GitHub/GitLab and in VS Code (Markdown Preview Mermaid Support extension).
