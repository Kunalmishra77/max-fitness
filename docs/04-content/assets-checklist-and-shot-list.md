# Required Assets, Shot List & Specifications

## 1. Master asset checklist

| # | Asset | Source | Spec | Folder | Needed by |
|---|---|---|---|---|---|
| A1 | Logo (vector) | Owner or redraw from signboard | SVG + PNG 1024px, light & dark versions, favicon set, app icon 512px | `assets/brand/` | Phase 1 |
| A2 | Hero videos ×3 | Shoot | See §3 | `assets/videos/` | Phase 2 |
| A3 | Hero posters ×3 (desktop + mobile crops) | Frames from videos | AVIF + WebP, 1920×1080 & 1080×1920, ≤ 180 KB | `assets/photos/hero/` | Phase 2 |
| A4 | Facilities photos ×12 (3 per zone) | Shoot | 3:2 & 4:5 crops, 2400px long edge master | `assets/photos/facilities/` | Phase 2 |
| A5 | About photos ×3 | Shoot | Wide floor, trainer with member, exterior with signboard | `assets/photos/about/` | Phase 2 |
| A6 | Owner portraits ×4 | Shoot | Tall portrait 4:5, clean background on floor, one action shot | `assets/owner-story/` | Phase 2 |
| A7 | Certificates / medals / newspaper cuttings | Owner (scan/photo) | Flat, even light, 3000px | `assets/owner-story/` | Phase 2 |
| A8 | Gallery photos ×20 | Shoot + consented member photos | Mixed | `assets/photos/gallery/` | Phase 2 |
| A9 | Google/Justdial screenshots for claims register | Capture monthly | PNG | `assets/brand/claims/` | Phase 2 |
| A10 | OG/social share image | Design | 1200×630 PNG | `apps/web/public/` | Phase 2 |
| A11 | Legal page drafts | Us + owner review | Markdown | `apps/web/content/legal/` | Phase 2 |
| A12 | WhatsApp profile photo, about text, business description | Design | 640×640 | `assets/brand/whatsapp/` | Phase 0 |
| A13 | Reception QR standee | Design + print | See `assets/reception-qr/README.md` | `assets/reception-qr/` | Phase 5 |
| A14 | Kiosk stand + LED light + phone | Purchase | See attendance spec §3 | — | Phase 1b POC |
| A15 | Member consent forms (photo use, transformations) | Us | Printable A4 bilingual | `assets/brand/forms/` | Phase 2 |
| A16 | Owner training video (Hindi, 6–8 min) | Record screen + voice | 1080p vertical | `assets/videos/training/` | Phase 8 |
| A17 | Laminated one-page CRM guide (Hindi, icons) | Design | A4 | `assets/brand/print/` | Phase 8 |
| A18 | Existing member register scans | Owner | Phone photos | secure drive only (not git) | Phase 5 |

## 2. Shoot planning
- **When:** one weekday 6:30–9:30 am (light, fewer members) + one evening 6–8 pm (energy, crowd b-roll). 
- **Crew:** 1 photographer/videographer, 1 coordinator for releases.
- **Gear:** full-frame or high-end phone with log/flat profile, gimbal, 2 LED panels (daylight 5600K) to neutralise tube-light cast, wireless lav mic for owner quotes, clean lens cloths, extra batteries.
- **Prep:** clean mirrors and floor, remove clutter and loose plates, arrange dumbbells, switch on all lights, turn off TV screens showing brands, check for other brands' logos on clothing.
- **Releases:** every recognisable person signs a bilingual photo/video release (A15). No minors in shots without guardian signature.

## 3. Video specification
| Item | Spec |
|---|---|
| Clips | 3 hero loops + 6 b-roll for social/GBP |
| Duration | 6–10 s each, seamless-ish loop |
| Capture | 4K 25/30 fps (and 60 fps for slow-motion options), horizontal + vertical takes |
| Delivery (web) | MP4 H.264 (baseline compatibility) + WebM VP9; 1280×720 @ ~1.2 Mbps and 1920×1080 @ ~2.5 Mbps; mobile 720×1280 portrait; no audio track |
| Target size | ≤ 1.5 MB mobile per clip, ≤ 3 MB desktop per clip |
| Posters | First frame, colour-matched |

Encoding (reference):
```
ffmpeg -i in.mov -vf "scale=1280:-2,fps=30" -an -c:v libx264 -profile:v high -crf 26 -preset slow -movflags +faststart hero1-720.mp4
ffmpeg -i in.mov -vf "scale=1280:-2,fps=30" -an -c:v libvpx-vp9 -b:v 0 -crf 36 -row-mt 1 hero1-720.webm
```

## 4. Shot list
| ID | Use | Shot | Notes |
|---|---|---|---|
| V1 | Hero slide 1 | Owner coaching a member through a squat or deadlift lockout; slow push-in | Owner face visible; confident, not staged smile |
| V2 | Hero slide 2 | Trainer demonstrating a machine to a nervous beginner; close hands + face | Warm, patient body language |
| V3 | Hero slide 3 | Woman training on functional floor (ropes or step platform) with trainer nearby | Respectful framing, consent |
| V4 | B-roll | Battle rope waves, 60 fps | Functional floor |
| V5 | B-roll | ~~Heavy bag combo~~ — dropped: the gym has no boxing corner (2026-09-25) | — |
| V6 | B-roll | Treadmill row, members walking in evening | Cardio |
| V7 | B-roll | Plates loading, chalk hands | Strength |
| V8 | B-roll | Exterior signboard at dusk, entrance, Sai Mandir landmark context | Wayfinding |
| V9 | B-roll | Reception with QR standee and attendance phone | For how-it-works reels |
| P1 | About | Wide floor from corner, all lights on | Show red/blue walls, wooden floor |
| P2 | About | Trainer with member, candid | |
| P3 | Facilities | Strength machines ×3 angles | |
| P4 | Facilities | Cardio row ×3 | |
| P5 | Facilities | Functional floor overhead/diagonal ×3 | Cones and step platforms arranged |
| P6 | Facilities | Heavy bags ×3 | |
| P7 | Owner | Portrait on gym floor, arms relaxed | Tall 4:5, eye-level |
| P8 | Owner | Holding medal/certificate | |
| P9 | Owner | Action coaching shot | |
| P10 | Owner | Close-up of hands on bar | Texture for champion section |

## 5. Image processing pipeline
- Masters stay in shared drive (not git). Export web sizes via script in Phase 2: AVIF (q≈50) + WebP (q≈75), widths 480/768/1200/1920, strip EXIF/GPS.
- Colour: neutralise green cast, keep wall colours saturated but natural.
- Alt text written at export time into `assets/photos/manifest.json` (`file`, `alt_en`, `alt_hi`, `credit`, `releaseId`).
