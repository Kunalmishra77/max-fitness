"""
Reading the text off a photographed government ID (ADR-120).

Members were uploading whatever the camera had last — a selfie, a product, a dog —
because nothing looked inside the picture. This looks, and hands back the words.

**It returns the text and judges nothing.** The rules about what counts as a valid card
live in `packages/core/src/qr/gov-id-text.ts`, where they are unit-tested against real
card layouts rather than guessed at in a container nobody runs locally. This file is the
engine; the judgement belongs with the domain.

**Nothing read here is stored anywhere.** The caller reaches a verdict and lets the text
go. ADR-074 is why: the gym keeps the photograph of a card and never the number, because
the Aadhaar Act restricts a private company from holding one and under DPDP it is a
liability with no use.
"""

from __future__ import annotations

import cv2
import numpy as np
import pytesseract

# Both scripts at once. An Aadhaar prints the holder's name twice, in English and in the
# local language, and which one survives a crease and the angle of the light is not ours
# to choose.
LANGUAGES = "eng+hin"

# A phone photograph of a card is often larger than tesseract needs and slower for it.
# Below this it is upscaled instead: a card filling a small frame reads poorly, and the
# interpolation costs less than the member re-taking the photograph.
TARGET_WIDTH = 1600
MIN_WIDTH = 900


def _prepare(image: np.ndarray) -> np.ndarray:
    """
    Flatten the photograph into something tesseract reads well.

    A card photographed on a phone carries shadow across it — a hand, a counter, the
    window behind. Plain thresholding loses half the text to the dark side; adaptive
    thresholding judges each patch against its own neighbourhood, which is what makes a
    creased Aadhaar on a reception desk legible at all.
    """
    height, width = image.shape[:2]
    if width > TARGET_WIDTH or width < MIN_WIDTH:
        scale = TARGET_WIDTH / float(width)
        image = cv2.resize(image, (TARGET_WIDTH, max(1, int(height * scale))), interpolation=cv2.INTER_CUBIC)

    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    # Block size and constant are the usual starting pair for document scans; they matter
    # less than using adaptive at all.
    return cv2.adaptiveThreshold(grey, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 15)


def read_text(image: np.ndarray) -> str:
    """
    Every word the engine can find, as one string.

    Both the prepared image and the original are read, and the longer result wins.
    Thresholding rescues a shadowed card and ruins a clean one — a crisp scan loses thin
    strokes to it — so trying both costs a second and avoids refusing a member over which
    way their card happened to be lit.
    """
    attempts = []
    for candidate in (_prepare(image), image):
        try:
            attempts.append(pytesseract.image_to_string(candidate, lang=LANGUAGES))
        except Exception:  # noqa: BLE001 - a language pack missing must not take the service down
            continue

    if not attempts:
        return ""
    return max(attempts, key=lambda text: len(text.strip()))
