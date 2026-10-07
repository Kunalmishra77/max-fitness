# `apps/face` — the face engine

One job: **turn a photograph into a 128-number embedding**, and say whether the face in it
was good enough to trust. It holds no database, no member names and no state, and it keeps
nothing: a frame arrives, an embedding goes back, the frame is forgotten.

Everything that decides *who* a member is — the threshold, the margin over the runner-up,
how many frames must agree — lives in `packages/core`, where it is pure and tested. This
service never learns whose face it just looked at.

## The models, and why these two

| Model | Job | Licence | Benchmark |
|---|---|---|---|
| [YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) | find the face and its five landmarks | **MIT** | — |
| [SFace](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface) | turn the aligned face into 128 numbers | **Apache 2.0** | 0.9940 |

Both licences permit commercial use, which is the whole reason they were chosen: ADR-003
forbids shipping research-only weights, and the gym is a business. InsightFace's models are
non-commercial, and dlib's recogniser carries a training-dataset restriction. ADR-107 has
the comparison and the measurements.

**The alignment is not hand-rolled on purpose.** OpenCV's `FaceRecognizerSF.alignCrop`
applies the five-point similarity transform SFace was trained against. Writing that by hand
is a few dozen lines of arithmetic that, when subtly wrong, does not crash — it just quietly
costs accuracy on every member for ever.

## Running it

```
pip install -r requirements.txt
python -m app                      # http://127.0.0.1:8000
```

`FACE_SERVICE_TOKEN` must match the web app's. There is no other authentication: this
service is never exposed publicly, only to the app on the same private network.

## The one number that decides whether any of this works

A member is recognised against the selfie they uploaded at signup. Measured on the gym's
own selfies (ADR-107), every member whose enrolment photograph held a face of **192 px or
more** scored 0.84–0.99 against a degraded version of themselves, while two whose faces were
43 px and 129 px fell to 0.59 and 0.42 — below where different people score against each
other. The floor is enforced at enrolment, in `quality`, and it matters more than any
threshold further down the line.
