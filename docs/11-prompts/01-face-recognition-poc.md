# 01 — Face Recognition POC Spike (Phase 1b, parallel with Phase 1)

Run in a separate folder `apps/kiosk-android-poc` (throwaway) by the Android developer.

```text
You are building a THROWAWAY proof-of-concept Android app to decide whether on-device face recognition works well enough at Max Fitness Gym's reception. Production code comes later in Phase 7.

Read first: CLAUDE.md, docs/05-engineering/attendance-face-recognition-system.md (all), docs/07-security-compliance/privacy-and-dpdp-compliance.md §3.3 and §5.

Build in apps/kiosk-android-poc (Kotlin, Jetpack Compose, CameraX, ML Kit Face Detection):
1. Full-screen front-camera preview with overlay showing detected face box, yaw/pitch/roll, brightness, blur score, and whether the quality gate passes (thresholds from spec §5, editable in a debug panel).
2. A FaceEngine interface exactly as in spec §4. Two implementations behind a toggle:
   a) ResearchEngine — loads a TFLite/LiteRT embedding model file from app storage (I will supply the file; do NOT bundle or download model weights yourself; mark clearly "research-only, not for production").
   b) VendorEngine — adapter stub for a commercial SDK trial (I will add the SDK and licence key later).
3. Alignment to 112×112 using ML Kit landmarks (similarity transform), L2-normalised embeddings, cosine matcher, top1/top2 margin.
4. Enrolment screens: (a) import a selfie image from device storage for a named test subject, (b) assisted 5-frame capture.
5. Decision state machine from spec §6 with parameters in debug panel.
6. Logging: every attempt appended to a CSV in app-specific storage: timestamp, subjectLabel (typed by tester), engine, top1Member, top1Score, top2Score, margin, liveness (if any), decision, latencyMs, fps, batteryTempC, lightingNote.
7. Thermal & fps readout; adaptive fps (idle 4, active 12).
8. Export button to share CSV.

No network, no server, no kiosk mode. All test data stays on device and is deleted after the POC (add a "Wipe all data" button).

Then write docs/10-delivery/face-poc-report-template.md with tables for the metrics in spec §13 and a go/no-go section. Update progress-log.md.
```
