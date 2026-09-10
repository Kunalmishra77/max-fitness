# 02 — Phase 2: Landing Page & Legal Pages

```text
Phase 2: build the public website. Phase 1 must be complete and green.

Read first: CLAUDE.md; docs/02-product/PRD.md §5.1; docs/03-design/DESIGN-BLUEPRINT.md (all); docs/03-design/landing-page-wireframes.md (landing sections); docs/04-content/website-copy-deck.md; docs/04-content/content-strategy-and-seo.md §3–4; docs/04-content/assets-checklist-and-shot-list.md §3 and §5; docs/05-engineering/api-specification.md POST /leads, GET /plans.

Before coding, write a short design plan (tokens in use, type scale, layout per section, the three signature elements) and check it against DESIGN-BLUEPRINT §11. Show it to me; wait for "go".

Build (PRD IDs in brackets):
1. Section components under apps/web/src/components/marketing/, page composition at app/[locale]/(marketing)/page.tsx, strings in messages/en.json + hi.json [LP-01..LP-22].
2. Hero: Embla slider with 3 slides, <video muted playsInline loop preload="metadata" poster> with WebM+MP4 sources (use placeholder clips in public/media/hero/ until real footage arrives — generate simple placeholder posters, no stock people), rep-tally progress indicator (accessible buttons), pause/play, auto-advance 7s, stops on hover/focus, reduced-motion & Save-Data → posters only. One orchestrated headline reveal on first load only.
3. Lead form (RHF + Zod from packages/shared) → POST /api/v1/leads → packages/core lead service (dedupe BR-10.3, Outbox owner alert, call-task rule). Success/error states per copy deck. Rate limit per api-spec §8.
4. Fee board: GET plans via server component + packages/core pricing (per-month, savings, best value); gender toggle client component; "Choose" buttons link to /join?plan=CODE (signup is Phase 3 — route can show "coming next" placeholder).
5. Champion plaque with clearly marked placeholders from copy deck.
6. Testimonials with DEMO labels outside production; gallery lightbox (keyboard accessible); FAQ accordion with FAQPage JSON-LD.
7. Contact with click-to-load Google Maps embed (no third-party requests before click), tel: and wa.me links with prefilled text, hours table from settings (today highlighted).
8. Footer, mobile sticky bar (Call, WhatsApp, Sign up), WhatsApp float on desktop.
9. Legal pages from apps/web/content/legal/*.md: draft Privacy (use docs/07-security-compliance/privacy-and-dpdp-compliance.md), Terms of membership, Refund & cancellation (use placeholders for owner policy), Contact. Mark "DRAFT — pending client review" banner outside production.
10. SEO: metadata per content strategy, OG image, ExerciseGym JSON-LD (no aggregateRating), sitemap.ts, robots.ts, canonical, hreflang en/hi.
11. Consent banner + analytics wrapper (Plausible/GA4 only after consent); track events from PRD §7 relevant to this page.
12. Settings-driven: trust numbers, promo bar/banner, hours → revalidate tag on change.
13. Tests: component tests for fee board toggle & lead form; Playwright journeys 1–2 from testing-strategy §3; axe; Lighthouse CI budget (mobile LCP ≤ 2.5 s, CLS ≤ 0.1).

Quality bar: check at 360, 768, 1024, 1440 px; take screenshots and critique against the design blueprint (remove one accessory). No generic fade-ups, no all-caps eyebrows, no arrows appended to buttons.

Finish: update progress-log.md; list content still needed from the client.
```
