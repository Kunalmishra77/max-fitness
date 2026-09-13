import type { FaceDetectorLike } from './selfie-capture';

/**
 * MediaPipe Face Detector, loaded on demand (signup-and-payment-flow.md §2.3).
 *
 * Only presence and position: the browser never recognises anyone (TRD §3). The library,
 * WASM runtime and model are all served from our origin — `/mediapipe/wasm` is copied
 * from the pinned package at build, the model is committed — so opening the selfie
 * sheet sends nothing to a third party. The ~11 MB runtime is fetched only when the
 * sheet opens, never with the page.
 */

const WASM_PATH = '/mediapipe/wasm';
const MODEL_PATH = '/mediapipe/models/blaze_face_short_range.v1.tflite';

export async function loadFaceDetector(): Promise<FaceDetectorLike | null> {
  try {
    const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    const detector = await FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
      runningMode: 'VIDEO',
      minDetectionConfidence: 0.5,
    });

    let lastTimestamp = 0;
    return {
      detect(video, timestampMs) {
        // The detector requires strictly increasing timestamps in VIDEO mode.
        lastTimestamp = Math.max(timestampMs, lastTimestamp + 1);
        return detector.detectForVideo(video, lastTimestamp).detections.flatMap((detection) => {
          const box = detection.boundingBox;
          return box === undefined ? [] : [{ x: box.originX, y: box.originY, width: box.width, height: box.height }];
        });
      },
      close() {
        detector.close();
      },
    };
  } catch {
    // An old browser, a blocked download: capture proceeds without the check.
    return null;
  }
}
