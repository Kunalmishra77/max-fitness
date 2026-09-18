# Hero video brief — for the video editor

**Client:** Max Fitness Gym, Nyay Khand 1, Indirapuram (logo: "MAX GYM", `assets/brand/max-gym-logo.png`)
**Where it plays:** the top of the website, behind the headline and the "Get a call back" form, on phones and laptops. It plays **muted, on loop, with no sound**.
**Until it arrives:** the site shows the gym's own photos with a slow camera move (ADR-061). The video replaces them slide by slide.

## 1. What we need — 3 short clips, one per hero slide

| Clip | Headline shown over it | What the clip should show | Photos you may use as reference / stills |
|---|---|---|---|
| **hero1** | "Coached by the owner. Since 2000." | Trainer or owner correcting a member's form up close (hands on the dumbbell, spotting a lift), then the group training on the turf | `assets/photos/gbp/trainer-spot.jpg`, `functional-turf.jpg` |
| **hero2** | "New to the gym? Start right, not sore." | A calm, welcoming walk down the treadmill row; a beginner on the cardio floor; clean, bright, not intimidating | `floor-treadmills.jpg`, `cardio-steps.jpg` |
| **hero3** | "Women's membership at ₹… a month." | Cardio area, a woman training confidently (only with her written consent), the CROSSFIT wall | `cardio-crossfit.jpg` |

Optional **bonus clip** (for social media, not the website): medal winners and trophies, `champions-team.jpg`, `champion-trophies.jpg`, `champions-trio.jpg`.

## 2. Style

- **Mood:** premium, powerful, calm. Slow, confident camera moves: dolly, slow push-in or orbit. No shaky phone footage, no fast cuts, no flashing.
- **Colour grade:** match the brand, **black + red + white** from the logo. Deep blacks, slightly desaturated colours (the gym's yellow walls toned down), skin tones natural. A little red light in the frame (rim light or a red glow) is welcome.
- **Leave the left side calm and darker.** The headline sits on the left 55% of the frame on laptops, and in the lower half on phones. Keep faces and the main action in the **right half** (landscape) or the **upper half** (portrait).
- **No text, logos, subtitles or music burned into the video.** The website adds the headline itself, in English and Hindi.
- **People:** only members and staff who have agreed in writing to appear. No stock footage of other gyms.

## 3. Technical delivery (exactly these files)

For each clip `n` = 1, 2, 3:

| File | Size | Notes |
|---|---|---|
| `hero{n}-720.mp4` | 1280 × 720, H.264, yuv420p | landscape, for laptops |
| `hero{n}-720.webm` | 1280 × 720, VP9 | same clip, smaller file |
| `hero{n}-mobile-720x1280.mp4` | 720 × 1280, H.264 | **portrait**, reframed for phones (not just the landscape clip rotated) |
| `hero{n}-mobile-720x1280.webm` | 720 × 1280, VP9 | same portrait clip |

- **Length:** 6–8 seconds each, **seamless loop** (last frame flows into the first).
- **No audio track** (strip it; the file is smaller and browsers autoplay muted video only).
- **File size:** aim for **under 1.5 MB per file** (CRF ~30–32 for H.264, ~38 for VP9). The site stays fast on 4G.
- **Frame rate:** 24 or 25 fps.
- Also send one **still frame per clip** (the best-looking frame), 1600 × 900 and 720 × 1280, as JPG. We make the posters from them.

Send the masters too (ProRes or high-bitrate MP4, 1080p or 4K), so we can re-export later.

## 4. After delivery (developer)

1. Put the 12 files in `apps/web/public/media/hero/`.
2. Build the posters from the still frames (or keep the photo posters from `scripts/build-hero-posters.mjs`).
3. In `apps/web/src/components/marketing/hero-carousel.tsx` set `HERO_HAS_VIDEO = true`.
4. Check the Lighthouse LCP budget (≤ 2.5 s on a mid-range phone): the video still loads only after the page has settled, never with Save-Data or reduced motion.
