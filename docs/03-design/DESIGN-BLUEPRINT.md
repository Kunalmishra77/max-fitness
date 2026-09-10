# Design Blueprint

Covers the public website and QR flow (brand-forward) and sets the base for Max Register (utility-forward, see `crm-ux-blueprint.md`) and the kiosk.

---

## 1. Subject, audience, primary job

- **Subject:** a 26-year-old neighbourhood strength gym in Indirapuram, run on the floor by a former national champion. Red-and-yellow "MAX" signboard, red and blue walls, wooden functional floor, battle ropes, punching bags, treadmills.
- **Audience:** local adults 17–45 on phones, many of them beginners or women comparing prices at night.
- **Primary job of the website:** turn a Google Maps tap into a sign-up, a WhatsApp chat, or a call within one scroll.

## 2. Concept: "Champion's floor, neighbourhood welcome"

The visual language borrows from two things every member of this gym already knows: **the painted fee board on a gym wall** and **a championship medal**. Everything is honest photography of the real gym, bold condensed bilingual type, and plain, direct words. The one place we spend boldness is the **Champion story**, set like a medal plaque in gold on navy. Everything else stays disciplined.

## 3. Colour tokens

| Name | Hex | Role | Grounding |
|---|---|---|---|
| **Plate Navy** | `#14213D` | Dark sections, nav on scroll, footer, text on light | Painted iron plates and the blue gym walls |
| **Signboard Red** | `#D62828` | Primary buttons, active states, key prices | The "MAX" signboard |
| **Chalk** | `#F2F3EF` | Light section background, form panels | Lifting chalk (cool, not cream) |
| **Medal Gold** | `#E3A92B` | Champion story only; "recommended" plan marker | National medal |
| **Wall Blue** | `#2F5DAA` | Links, focus rings on dark, secondary accents | Gym wall blue |
| **Rubber Grey** | `#5C6272` | Secondary text, borders at 24% | Rubber flooring |

Supporting: White `#FFFFFF` for cards on Chalk; Ink `#0F1729` for body text on Chalk (a navy-ink, not a tinted black).

Contrast checks (target WCAG AA; verify in build):
- Chalk text on Plate Navy — high contrast, suitable for body.
- White on Signboard Red buttons — verify ≥ 4.5:1 at button text size; if marginal, darken red to `#C1121F` for text-bearing buttons.
- Medal Gold on Plate Navy — large display text only.

Rules:
- Red is for **actions and prices**, never decoration.
- Gold appears **only** in the Champion section and the single "recommended" plan marker.
- Sections alternate Plate Navy (dark) and Chalk (light) to create rhythm without dividers.

## 4. Typography

| Role | Typeface | Why |
|---|---|---|
| Display & headlines, big numbers, prices | **Khand** (600/700) — Indian Type Foundry, Latin + Devanagari, condensed | Condensed athletic energy that also sets Hindi beautifully, so bilingual headlines share one voice. Less common on gym sites than the usual condensed choices. |
| Body, UI, forms | **Hind** (400/500/600) — Indian Type Foundry, Latin + Devanagari | Highly legible humanist sans with matching Devanagari; pairs with Khand by the same foundry. |

Both are on Google Fonts — self-host via `next/font` with `display: swap`, subset `latin` + `devanagari`.

Type scale (mobile → desktop, `clamp()`), 1.25 ratio base 16px body:

| Token | Mobile | Desktop | Font | Line height | Use |
|---|---|---|---|---|---|
| `display-xl` | 44px | 88px | Khand 700 | 0.95 | Hero headline |
| `display-l` | 36px | 64px | Khand 700 | 1.0 | Section headlines, Champion name |
| `display-m` | 28px | 44px | Khand 600 | 1.05 | Sub-sections, prices |
| `title` | 20px | 24px | Hind 600 | 1.3 | Card titles |
| `body-l` | 18px | 20px | Hind 400 | 1.6 | Lead paragraphs |
| `body` | 16px | 17px | Hind 400 | 1.6 | Body |
| `small` | 14px | 14px | Hind 500 | 1.45 | Captions, legal |

Rules:
- Headlines in **sentence case**. No all-caps labels, no eyebrow labels above headings, no single highlighted word inside a headline.
- Line length ≤ 70 characters for body copy.
- Numbers (prices, ratings, years) are set in Khand so they read like a scoreboard.
- Devanagari gets +10% line-height relative to Latin at the same size.

## 5. Layout

- 12-column grid, max content width 1200px, gutters 24px (desktop) / 16px (mobile), side padding 20px mobile.
- **Left-aligned** text throughout. Centre alignment only for the kiosk and single-action confirmation screens.
- Section vertical padding: 96px desktop / 64px mobile.
- Border radius by hierarchy (not one radius everywhere): buttons & inputs 6px; panels & forms 12px; photographs 2px (they're photographs, not cards); modals 16px.
- Shadows only on elevated overlays (modal, sticky nav on scroll). Cards on Chalk use a 1px Rubber Grey @ 20% border instead.

## 6. Signature elements

1. **Rep-tally slider indicator (hero).** The slide progress is drawn as tally strokes that fill like counting reps; the current stroke fills over the slide duration. It's a real sequence, so a sequential marker is honest. Accessible as buttons "Slide 1 of 3".
2. **The fee board (Membership section).** Plans are presented as one painted-board-style table — Monthly, 3, 6, 12 months as rows or columns on a single Plate Navy board with Chalk lettering — instead of three floating cards. Gender toggle sits on the board's header. The 12-month row carries the only gold "recommended" mark.
3. **The medal plaque (Champion section).** The single bold moment: full-width Plate Navy, a large portrait, the championship title set huge in Medal Gold Khand, a short verified timeline, and a certificate photo. No other section uses gold at this scale.

## 7. Photography & video direction
- Real members and real equipment only. No stock models.
- Warm natural skin tones; correct the tube-light green cast; keep the red/blue walls visible (they are the brand).
- Motion clips: strong, simple actions — battle rope waves, a deadlift lockout, a trainer correcting a beginner's form, a woman on the treadmill smiling at a trainer. 6–10 s loops, no text burned in.
- Portrait crops for mobile hero (9:16 safe zone), landscape 16:9 for desktop.
- Scrim: a bottom-left gradient from Plate Navy 80% to 0% behind hero text for legibility.

## 8. Motion
- **One orchestrated moment:** on first load, the hero headline lines reveal upward in sequence (≈500 ms total) while the video fades in from the poster.
- User-triggered motion only elsewhere: accordion expand, modal open (scale 0.98 → 1, 180 ms), plan toggle cross-fade, selfie capture flash, success tick draw.
- No scroll-triggered fade-ups on sections. No hover lifts on cards.
- `prefers-reduced-motion`: hero shows the poster image, no reveal; slider does not auto-advance.

## 9. Components (website)

| Component | Spec |
|---|---|
| Button / primary | Signboard Red bg, White text, Hind 600 16px, height 48px (56px in hero), radius 6px, focus ring 3px Wall Blue offset 2px. Labels say what happens: "Sign up", "Request a call back", "Pay ₹4,000". |
| Button / secondary | 2px Chalk border on dark or Plate Navy border on light, transparent bg |
| Button / WhatsApp | Secondary style + WhatsApp glyph; label "Chat on WhatsApp" |
| Input | 48px height, 16px text (prevents iOS zoom), label above, helper/error below in plain words |
| Phone input | Fixed "+91" prefix, numeric keypad, 10-digit mask |
| DOB input | Three selects (Day / Month / Year) — faster than calendar pickers on phones |
| Gender selector | Two large segmented options with text labels (no gendered colour coding) |
| Selfie tile | 1:1 tile with camera glyph "Take selfie"; after capture shows photo with "Retake" |
| Modal / sheet | Desktop 560px modal; mobile full-height sheet with sticky footer button |
| Stepper | "Step 1 of 3: Your details" in plain text (sign-up, plan, payment are a real sequence) |
| Rating chip | Khand number + 5-star glyph + source name ("Google", "Justdial") + count |
| FAQ item | Question in Hind 600, chevron, 56px min tap height |
| Toast | Bottom on mobile; says the action result: "Request sent. We'll call you soon." |

## 10. Kiosk visual language (Max Haazri)
- Full-screen, centre aligned, Plate Navy background.
- States use full-screen colour washes that are readable from 2 m away: Welcome (green `#1F8A4C`), Please meet reception (amber `#B7791F` with Chalk text), Not recognised (Plate Navy with keypad), Confirm "Are you…?" (Wall Blue).
- Member photo 40% of screen width, name in Khand 72px, days left in Khand 48px.
- Idle: dimmed gym logo + "Look at the camera for attendance / हाज़िरी के लिए कैमरे की ओर देखें" + small QR "New? Join here".

## 11. Design review against defaults (what we changed and why)

| First instinct | Why it was generic | Revised to |
|---|---|---|
| Near-black site with a single bright red accent | A common default for gym sites and generated pages | Plate Navy base drawn from the gym's blue walls, alternating with cool Chalk sections; red restricted to actions and prices |
| Condensed all-caps display face popular on fitness sites | Instantly templated | Khand in sentence case — bilingual, locally designed, same voice in Hindi |
| Three rounded pricing cards with a "Most popular" ribbon | SaaS card kit | Single "fee board" referencing the painted boards in Indian gyms |
| Big stats row with gradient accents in hero | Default hero treatment | Plain trust strip with verifiable numbers (ratings, since 2000) |
| Fade-up animation on every section | Reads as generated | One hero reveal; otherwise motion only in response to actions |
| Glassmorphism lead form over video | Trend default, poor legibility | Solid Chalk panel with Ink text |

## 12. Accessibility floor
- Visible focus on every interactive element; logical tab order through modal steps; focus trapped in modals.
- Video has no essential information; pause control always visible.
- Form errors announced via `aria-live`; inputs labelled; error colour never the only signal.
- Hit areas ≥ 44px web, ≥ 56px CRM, ≥ 72px kiosk.
- Hindi content marked `lang="hi"`.
