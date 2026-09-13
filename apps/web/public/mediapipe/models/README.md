# MediaPipe face detector model

`blaze_face_short_range.v1.tflite` — MediaPipe BlazeFace short-range face detector (float16, version 1),
downloaded unchanged from
`https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`.

- Licence: Apache License 2.0 (Google MediaPipe models; see the model card linked from
  https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector).
- SHA-256: `b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f`
- Used only in the browser, only to check that one face is in frame before a selfie is taken.
  It detects presence and position; it does not recognise anyone (TRD §3).
- The `.v1` in the name lets the file be cached as immutable; bump it with a new model.
