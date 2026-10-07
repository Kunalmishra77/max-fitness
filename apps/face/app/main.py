"""
`apps/face` — the HTTP surface.

Two endpoints and no state. `/v1/embed` measures a face and turns it into numbers;
`/health` says whether the weights loaded. Nothing is written to disk, nothing is logged
about the person in the frame, and the service never learns a member's name — it is given
pixels and gives back arithmetic.

It is not reachable from the internet. Coolify keeps it on the project's private network
and only the web app calls it, with a shared token, so that a leaked URL is not a face
search engine.
"""

from __future__ import annotations

import hmac
import os
import time
from typing import Annotated

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from .engine import EMBEDDING_SIZE, MODEL_VERSION, FaceEngine

# Bigger than any frame the check-in page sends (it downscales before posting) and than any
# signup selfie (720×720). A request past this is a mistake or an attack, and decoding it
# would be the expensive part.
MAX_IMAGE_BYTES = 4 * 1024 * 1024

api = FastAPI(title="Max Fitness face engine", docs_url=None, redoc_url=None, openapi_url=None)

_engine: FaceEngine | None = None
_load_error: str | None = None


@api.on_event("startup")
def _load() -> None:
    """Load the weights once, at startup.

    Loading them per request would add about a second to every check-in, and a member
    standing at the desk would feel every one of it.
    """
    global _engine, _load_error
    try:
        _engine = FaceEngine()
    except Exception as error:  # noqa: BLE001 — reported through /health, never raised at a member
        _load_error = str(error)


def _authorise(authorization: Annotated[str | None, Header()] = None) -> None:
    expected = os.environ.get("FACE_SERVICE_TOKEN", "")
    if expected == "":
        # Refusing everything is the safe failure. A service that accepts anything because
        # its token was not configured is worse than one that is down.
        raise HTTPException(status_code=503, detail="not configured")
    presented = (authorization or "").removeprefix("Bearer ").strip()
    if not hmac.compare_digest(presented, expected):
        raise HTTPException(status_code=401, detail="unauthorised")


@api.get("/health")
def health() -> JSONResponse:
    ok = _engine is not None
    return JSONResponse(
        status_code=200 if ok else 503,
        content={
            "ok": ok,
            "modelVersion": MODEL_VERSION,
            "embeddingSize": EMBEDDING_SIZE,
            **({"error": _load_error} if _load_error is not None else {}),
        },
    )


@api.post("/v1/embed", dependencies=[Depends(_authorise)])
async def embed(image: Annotated[UploadFile, File()]) -> JSONResponse:
    """
    Measure the biggest face in the image and embed it.

    Every answer is a 200 with a `found` flag rather than an error status: "there is no
    face in this photograph" is a normal, expected outcome — a member photographs their
    dog, or the camera catches the ceiling — and the caller has to tell those apart from
    the service being broken. A 4xx would conflate them.
    """
    if _engine is None:
        raise HTTPException(status_code=503, detail="engine not loaded")

    data = await image.read()
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="empty image")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="image too large")

    started = time.perf_counter()
    frame = _engine.decode(data)
    if frame is None:
        # Not an image at all: a PDF, a text file, a truncated upload.
        return JSONResponse({"found": False, "reason": "NOT_AN_IMAGE", "modelVersion": MODEL_VERSION})

    found = _engine.measure(frame)
    if found is None:
        # The detector is a *human face* detector, so this is also the answer for an animal,
        # a product photograph, a screenshot or a picture of a wall. There is nothing here
        # to recognise a member by.
        return JSONResponse({"found": False, "reason": "NO_FACE", "modelVersion": MODEL_VERSION})

    measurement, raw = found
    height, width = frame.shape[:2]
    try:
        vector = _engine.embed(frame, raw)
    except ValueError:
        return JSONResponse({"found": False, "reason": "NO_FACE", "modelVersion": MODEL_VERSION})

    return JSONResponse(
        {
            "found": True,
            "modelVersion": MODEL_VERSION,
            "embedding": vector,
            "image": {"width": width, "height": height},
            "face": {
                "x": measurement.x,
                "y": measurement.y,
                "width": measurement.width,
                "height": measurement.height,
                "facePx": measurement.face_px,
                "confidence": round(measurement.detector_confidence, 4),
                "brightness": round(measurement.brightness, 2),
                "sharpness": round(measurement.sharpness, 2),
                "alignedSharpness": round(measurement.aligned_sharpness, 2),
                "facesInFrame": measurement.faces_in_frame,
                "secondFacePx": measurement.second_face_px,
            },
            "tookMs": round((time.perf_counter() - started) * 1000, 1),
        }
    )
