"""
The face engine itself: find a face, align it, turn it into numbers.

Deliberately free of any opinion about *who* the face belongs to. It reports what it
measured — how big the face was, how bright, how sharp — and leaves every judgement to
`packages/core`, where the rules are pure and tested. A service that decided "this selfie
is acceptable" would be a second place where that rule lives, and the two would drift.

The alignment is OpenCV's own `alignCrop`, not a hand-rolled similarity transform. SFace
was trained on faces warped a particular way from five landmarks; getting that warp subtly
wrong does not raise an error, it just costs accuracy on every member, for ever.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import cv2
import numpy as np

# Stamped onto every template. When this changes, old templates no longer compare against
# new frames, and the matcher ignores them by length rather than scoring them as strangers.
MODEL_VERSION = "yunet-2023mar+sface-2021dec"

EMBEDDING_SIZE = 128

# YuNet's own confidence floor for calling something a face at all. Below this it is noise.
_DETECT_CONFIDENCE = 0.6
_NMS = 0.3
_TOP_K = 5000


@dataclass(frozen=True)
class FaceMeasurement:
    """What was found, with no verdict attached."""

    # Pixel box in the image as it was sent.
    x: int
    y: int
    width: int
    height: int
    # The shorter side. This is the number that decides whether a member can be recognised
    # later: measured on the gym's own selfies, faces of 192px and up survived every camera
    # condition tested, and 43px and 129px did not (ADR-107).
    face_px: int
    detector_confidence: float
    # Mean luminance of the face, 0–255.
    brightness: float
    # Variance of the Laplacian over the face: low means blurred or out of focus.
    sharpness: float
    # How many faces were in the frame at all. More than one at a check-in means somebody
    # is standing behind the member, and the domain may want to refuse rather than guess.
    faces_in_frame: int
    # The shorter side of the *second* biggest face, or 0.
    #
    # The count alone is not enough to judge on. Two of the gym's own selfies contain a
    # second detection that is a few pixels across — a pattern on a wall, a reflection —
    # and refusing those would refuse real members. What matters is whether the second face
    # is big enough to be another person standing there, which is a comparison, not a count.
    second_face_px: int
    # Sharpness of the aligned 112×112 face — the view the recogniser is actually given.
    #
    # Measured on the gym's selfies and found **not** to separate good enrolments from bad:
    # the two photographs that failed recognition scored 236 and 858 while a member who
    # recognised perfectly scored 130. It is reported for a low floor that catches a
    # genuinely smeared image, and must not be used as a quality ranking (ADR-107).
    aligned_sharpness: float


class FaceEngine:
    def __init__(self, models_dir: str | None = None) -> None:
        root = models_dir or os.environ.get("FACE_MODELS_DIR", "/models")
        detector_path = os.path.join(root, "yunet.onnx")
        recogniser_path = os.path.join(root, "sface.onnx")
        for path in (detector_path, recogniser_path):
            if not os.path.exists(path):
                raise FileNotFoundError(f"model missing: {path}")

        # The input size is set per image before each detect; this initial one is a
        # placeholder the constructor requires.
        self._detector = cv2.FaceDetectorYN.create(detector_path, "", (320, 320), _DETECT_CONFIDENCE, _NMS, _TOP_K)
        self._recogniser = cv2.FaceRecognizerSF.create(recogniser_path, "")

    @staticmethod
    def decode(data: bytes) -> np.ndarray | None:
        image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        return image if image is not None and image.size > 0 else None

    def measure(self, image: np.ndarray) -> tuple[FaceMeasurement, np.ndarray] | None:
        """The biggest face in the frame, measured, with the raw detection kept for alignment."""
        height, width = image.shape[:2]
        self._detector.setInputSize((width, height))
        _, faces = self._detector.detect(image)
        if faces is None or len(faces) == 0:
            return None

        # The biggest, not the first: a selfie often catches somebody in the background, and
        # the person who took it is the one closest to the camera.
        ranked = sorted(faces, key=lambda f: float(f[2]) * float(f[3]), reverse=True)
        face = ranked[0]
        runner_up = ranked[1] if len(ranked) > 1 else None
        second_face_px = min(int(runner_up[2]), int(runner_up[3])) if runner_up is not None else 0
        x, y, w, h = (int(face[0]), int(face[1]), int(face[2]), int(face[3]))

        # Clamped before slicing: YuNet can return a box that runs past the edge when a face
        # is half out of frame, and a negative index would silently take the wrong pixels.
        x0, y0 = max(0, x), max(0, y)
        x1, y1 = min(width, x + w), min(height, y + h)
        crop = image[y0:y1, x0:x1]
        if crop.size == 0:
            return None

        grey = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        # Brightness from the aligned face, so it means the same thing whether the member
        # stood close or far: the crop's own size would otherwise change what "average" is.
        aligned_grey = cv2.cvtColor(self._recogniser.alignCrop(image, face), cv2.COLOR_BGR2GRAY)
        measurement = FaceMeasurement(
            x=x,
            y=y,
            width=w,
            height=h,
            face_px=min(w, h),
            detector_confidence=float(face[-1]),
            brightness=float(grey.mean()),
            sharpness=float(cv2.Laplacian(grey, cv2.CV_64F).var()),
            faces_in_frame=len(faces),
            second_face_px=second_face_px,
            aligned_sharpness=float(cv2.Laplacian(aligned_grey, cv2.CV_64F).var()),
        )
        return measurement, face

    def embed(self, image: np.ndarray, face: np.ndarray) -> list[float]:
        """L2-normalised, so the matcher's cosine similarity is a plain dot product."""
        aligned = self._recogniser.alignCrop(image, face)
        vector = self._recogniser.feature(aligned).flatten().astype(np.float64)
        norm = float(np.linalg.norm(vector))
        if norm == 0.0:
            raise ValueError("the engine produced a zero vector")
        return (vector / norm).tolist()
