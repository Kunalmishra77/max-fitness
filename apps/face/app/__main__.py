"""Run the face engine: `python -m app`."""

import os

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app.main:api",
        host=os.environ.get("FACE_HOST", "0.0.0.0"),  # noqa: S104 — container-internal only
        port=int(os.environ.get("FACE_PORT", "8000")),
        # One worker. The models are ~39 MB of weights each copy, and a reception desk
        # makes one request at a time; a second worker would double the memory to serve
        # a queue that is never more than one deep.
        workers=1,
        log_level=os.environ.get("FACE_LOG_LEVEL", "info"),
    )
