#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import os
from pathlib import Path
import shutil
import sys
import tempfile
import time
import urllib.request

OPENCV_ZOO_COMMIT = "47534e27c9851bb1128ccc0102f1145e27f23f98"

FILES = (
    {
        "name": "face_detection_yunet_2023mar.onnx",
        "url": (
            "https://media.githubusercontent.com/media/opencv/opencv_zoo/"
            + OPENCV_ZOO_COMMIT
            + "/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
        ),
        "sha256": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
        "size": 232589,
    },
    {
        "name": "face_recognition_sface_2021dec.onnx",
        "url": (
            "https://media.githubusercontent.com/media/opencv/opencv_zoo/"
            + OPENCV_ZOO_COMMIT
            + "/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"
        ),
        "sha256": "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
        "size": 38696353,
    },
)

LICENSES = (
    {
        "name": "YUNET_LICENSE.txt",
        "url": (
            "https://raw.githubusercontent.com/opencv/opencv_zoo/"
            + OPENCV_ZOO_COMMIT
            + "/models/face_detection_yunet/LICENSE"
        ),
    },
    {
        "name": "SFACE_LICENSE.txt",
        "url": (
            "https://raw.githubusercontent.com/opencv/opencv_zoo/"
            + OPENCV_ZOO_COMMIT
            + "/models/face_recognition_sface/LICENSE"
        ),
    },
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, destination: Path, attempts: int = 3) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        fd, tmp_name = tempfile.mkstemp(
            prefix=destination.name + ".",
            suffix=".tmp",
            dir=str(destination.parent),
        )
        os.close(fd)
        tmp = Path(tmp_name)
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "xdrive-photo-face-model-fetch/1",
                    "Accept": "application/octet-stream,*/*;q=0.8",
                },
            )
            with urllib.request.urlopen(request, timeout=120) as response:
                with tmp.open("wb") as output:
                    shutil.copyfileobj(response, output, length=1024 * 1024)
            os.replace(tmp, destination)
            return
        except Exception as exc:
            last_error = exc
            tmp.unlink(missing_ok=True)
            if attempt != attempts:
                time.sleep(attempt * 2)
    raise RuntimeError(f"download failed after {attempts} attempts: {url}") from last_error


def verify_model(path: Path, expected_sha256: str, expected_size: int) -> None:
    size = path.stat().st_size
    if size != expected_size:
        raise RuntimeError(
            f"{path.name}: size mismatch: got {size}, expected {expected_size}"
        )
    actual_sha256 = sha256_file(path)
    if actual_sha256 != expected_sha256:
        raise RuntimeError(
            f"{path.name}: sha256 mismatch: got {actual_sha256}, expected {expected_sha256}"
        )


def main() -> int:
    model_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "/models")
    license_dir = Path(sys.argv[2] if len(sys.argv) > 2 else "/licenses")
    model_dir.mkdir(parents=True, exist_ok=True)
    license_dir.mkdir(parents=True, exist_ok=True)

    for item in FILES:
        destination = model_dir / item["name"]
        if not destination.exists():
            download(item["url"], destination)
        verify_model(destination, item["sha256"], item["size"])

    for item in LICENSES:
        destination = license_dir / item["name"]
        if not destination.exists():
            download(item["url"], destination)
        if destination.stat().st_size <= 0:
            raise RuntimeError(f"{destination.name}: downloaded license is empty")

    metadata = license_dir / "OPENCV_ZOO_SOURCE.txt"
    metadata.write_text(
        "\n".join(
            [
                "OpenCV Zoo reference models used by xDrive Photo Intelligence",
                f"repository: https://github.com/opencv/opencv_zoo",
                f"commit: {OPENCV_ZOO_COMMIT}",
                "",
                "YuNet face_detection_yunet_2023mar.onnx",
                "license: MIT",
                f"sha256: {FILES[0]['sha256']}",
                "",
                "SFace face_recognition_sface_2021dec.onnx",
                "license: Apache-2.0",
                f"sha256: {FILES[1]['sha256']}",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
