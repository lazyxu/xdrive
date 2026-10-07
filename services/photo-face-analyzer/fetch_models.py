#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import time
import urllib.request

OPENCV_ZOO_COMMIT = "47534e27c9851bb1128ccc0102f1145e27f23f98"
ZOO_MEDIA = "https://media.githubusercontent.com/media/opencv/opencv_zoo/" + OPENCV_ZOO_COMMIT
ZOO_RAW = "https://raw.githubusercontent.com/opencv/opencv_zoo/" + OPENCV_ZOO_COMMIT

SIGLIP_ONNX_COMMIT = "ba1f3b0843f24bc5417d38e19c37b287d719b2f4"
SIGLIP_ONNX = (
    "https://huggingface.co/onnx-community/"
    "siglip2-base-patch16-224-ONNX/resolve/" + SIGLIP_ONNX_COMMIT
)
SIGLIP_TOKENIZER_COMMIT = "997aaec"
SIGLIP_TOKENIZER = (
    "https://huggingface.co/google/siglip2-base-patch16-224/resolve/"
    + SIGLIP_TOKENIZER_COMMIT
)

FILES = (
    {
        "name": "face_detection_yunet_2023mar.onnx",
        "url": ZOO_MEDIA + "/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        "sha256": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
        "size": 232589,
    },
    {
        "name": "face_recognition_sface_2021dec.onnx",
        "url": ZOO_MEDIA + "/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
        "sha256": "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
        "size": 38696353,
    },
    {
        "name": "image_classification_mobilenetv2_2022apr.onnx",
        "url": ZOO_MEDIA + "/models/image_classification_mobilenet/image_classification_mobilenetv2_2022apr.onnx",
        "sha256": "c0c3f76d93fa3fd6580652a45618618a220fced18babf65774ed169de0432ad5",
        "size": 13964571,
    },
    {
        "name": "text_detection_cn_ppocrv3_2023may.onnx",
        "url": ZOO_MEDIA + "/models/text_detection_ppocr/text_detection_cn_ppocrv3_2023may.onnx",
        "sha256": "03f550c6b406fda8bf54bd8327815f6c7e2edd98cea02348c93d879254366587",
        "size": 2423490,
    },
    {
        "name": "text_recognition_CRNN_CN_2021nov.onnx",
        "url": ZOO_MEDIA + "/models/text_recognition_crnn/text_recognition_CRNN_CN_2021nov.onnx",
        "sha256": "c760bf82d684b87dfabb288e6c0f92d41a8cd6c1780661ca2c3cd10c2065a9ba",
        "size": 72807160,
    },
    {
        "name": "siglip2_vision_int8.onnx",
        "url": SIGLIP_ONNX + "/onnx/vision_model_int8.onnx",
        "sha256": "0dd31785a2713f1113ef2272472165c69d580473dae38d7b47568ac587795e70",
        "size": None,
    },
    {
        "name": "siglip2_text_int8.onnx",
        "url": SIGLIP_ONNX + "/onnx/text_model_int8.onnx",
        "sha256": "3a0603d3a00c05a80a6ded4743c16aaac7b1e62cdcc7e362e7ce418659b96400",
        "size": None,
    },
    {
        "name": "siglip2_tokenizer.json",
        "url": SIGLIP_TOKENIZER + "/tokenizer.json",
        "sha256": "cb9140fae3ac5122c972d37adf83e1248471a38147ad76f8215c8872c6fd8322",
        "size": 34363039,
    },
)

LICENSES = (
    {
        "name": "YUNET_LICENSE.txt",
        "url": ZOO_RAW + "/models/face_detection_yunet/LICENSE",
    },
    {
        "name": "SFACE_LICENSE.txt",
        "url": ZOO_RAW + "/models/face_recognition_sface/LICENSE",
    },
    {
        "name": "MOBILENET_LICENSE.txt",
        "url": ZOO_RAW + "/models/image_classification_mobilenet/LICENSE",
    },
    {
        "name": "PPOCR_LICENSE.txt",
        "url": ZOO_RAW + "/models/text_detection_ppocr/LICENSE",
    },
    {
        "name": "CRNN_LICENSE.txt",
        "url": ZOO_RAW + "/models/text_recognition_crnn/LICENSE",
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
                    "User-Agent": "xdrive-photo-intelligence-model-fetch/1",
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


def verify_model(
    path: Path,
    expected_sha256: str,
    expected_size: int | None,
) -> None:
    size = path.stat().st_size
    if expected_size is not None and size != expected_size:
        raise RuntimeError(
            f"{path.name}: size mismatch: got {size}, expected {expected_size}"
        )
    actual_sha256 = sha256_file(path)
    if actual_sha256 != expected_sha256:
        raise RuntimeError(
            f"{path.name}: sha256 mismatch: got {actual_sha256}, expected {expected_sha256}"
        )


def extract_triple_quoted(source: str, variable: str) -> str:
    match = re.search(
        rf"{re.escape(variable)}\s*=\s*'''(.*?)'''",
        source,
        flags=re.DOTALL,
    )
    if match is None:
        raise RuntimeError(f"cannot extract {variable} from pinned OpenCV Zoo source")
    return match.group(1)


def download_text(url: str, destination: Path) -> str:
    download(url, destination)
    return destination.read_text(encoding="utf-8")


def write_runtime_text_assets(model_dir: Path) -> None:
    mobilenet_source = download_text(
        ZOO_RAW + "/models/image_classification_mobilenet/mobilenet.py",
        model_dir / ".mobilenet_source.py",
    )
    labels = [
        line.strip()
        for line in extract_triple_quoted(
            mobilenet_source,
            "LABELS_IMAGENET_1K",
        ).splitlines()
        if line.strip()
    ]
    if len(labels) != 1000:
        raise RuntimeError(f"ImageNet label count is {len(labels)}, expected 1000")
    (model_dir / "imagenet1k_labels.txt").write_text(
        "\n".join(labels) + "\n",
        encoding="utf-8",
    )

    crnn_source = download_text(
        ZOO_RAW + "/models/text_recognition_crnn/crnn.py",
        model_dir / ".crnn_source.py",
    )
    charset = "".join(
        extract_triple_quoted(crnn_source, "CHARSET_CN_3944").splitlines()
    )
    if len(charset) < 3900:
        raise RuntimeError(
            f"CRNN CN charset length is {len(charset)}, expected at least 3900"
        )
    (model_dir / "crnn_cn_charset.txt").write_text(
        charset,
        encoding="utf-8",
    )
    (model_dir / ".mobilenet_source.py").unlink(missing_ok=True)
    (model_dir / ".crnn_source.py").unlink(missing_ok=True)


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

    write_runtime_text_assets(model_dir)

    for item in LICENSES:
        destination = license_dir / item["name"]
        if not destination.exists():
            download(item["url"], destination)
        if destination.stat().st_size <= 0:
            raise RuntimeError(f"{destination.name}: downloaded license is empty")

    metadata = license_dir / "OPENCV_ZOO_SOURCE.txt"
    lines = [
        "Pinned models used by xDrive Photo Intelligence",
        "repository: https://github.com/opencv/opencv_zoo",
        f"opencv_zoo_commit: {OPENCV_ZOO_COMMIT}",
        f"siglip_onnx_commit: {SIGLIP_ONNX_COMMIT}",
        f"siglip_tokenizer_commit: {SIGLIP_TOKENIZER_COMMIT}",
        "",
    ]
    for item in FILES:
        lines.extend(
            [
                item["name"],
                f"sha256: {item['sha256']}",
                f"size: {item['size']}",
                "",
            ]
        )
    metadata.write_text("\n".join(lines), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
