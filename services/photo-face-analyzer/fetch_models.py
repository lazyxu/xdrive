#!/usr/bin/env python3

from __future__ import annotations

import argparse
import hashlib
import http.client
import math
import os
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.parse
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

# Derived from the same pinned OpenCV Zoo source; verify these on cache reuse
# and in the network-disabled runtime packaging step as well as the ONNX files.
IMAGENET_LABELS_SHA256 = "0df974a6fdfba8f5bbb7510f1794a7865206e887f0730a498f548fe48b28f933"
CRNN_CHARSET_SHA256 = "cafc44d3e1c67556f0207b9c1e94ba481a978fdf44add70f5e69edcb9d0e6255"

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
    {
        "name": "image_segmentation_efficientsam_ti_2025april_int8.onnx",
        "url": ZOO_MEDIA + "/models/image_segmentation_efficientsam/image_segmentation_efficientsam_ti_2025april_int8.onnx",
        "sha256": "5ecc8d59a2802c32246e68553e1cf8ce74cf74ba707b84f206eb9181ff774b4e",
        "size": None,
    },
)

LICENSES = (
    {
        "name": "YUNET_LICENSE.txt",
        "url": ZOO_RAW + "/models/face_detection_yunet/LICENSE",
        "sha256": "c83b8120c50ccbd4c4f96edf53141bdd566ebb8f8e9227e415326aa1b1aba958",
    },
    {
        "name": "SFACE_LICENSE.txt",
        "url": ZOO_RAW + "/models/face_recognition_sface/LICENSE",
        "sha256": "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
    },
    {
        "name": "MOBILENET_LICENSE.txt",
        "url": ZOO_RAW + "/models/image_classification_mobilenet/LICENSE",
        "sha256": "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
    },
    {
        "name": "PPOCR_LICENSE.txt",
        "url": ZOO_RAW + "/models/text_detection_ppocr/LICENSE",
        "sha256": "609aaac97719da6b71cd3ffd08b5de08b75f582e5c50a196fab522b6d5087714",
    },
    {
        "name": "CRNN_LICENSE.txt",
        "url": ZOO_RAW + "/models/text_recognition_crnn/LICENSE",
        "sha256": "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
    },
    {
        "name": "EFFICIENTSAM_LICENSE.txt",
        "url": ZOO_RAW + "/models/image_segmentation_efficientsam/LICENSE",
        "sha256": "c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4",
    },
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class ModelIntegrityError(RuntimeError):
    pass


class InvalidDownloadResponse(RuntimeError):
    pass


def download_urls(url: str) -> list[str]:
    """An explicit Hub mirror changes only the host/base, never the pinned path."""
    endpoint = os.environ.get("HF_ENDPOINT", "").strip().rstrip("/")
    parsed = urllib.parse.urlsplit(url)
    if not endpoint or parsed.hostname != "huggingface.co":
        return [url]
    mirror = urllib.parse.urlsplit(endpoint)
    if (
        mirror.scheme not in ("http", "https") or not mirror.netloc
        or mirror.username or mirror.password or mirror.query or mirror.fragment
    ):
        raise ValueError("HF_ENDPOINT must be an HTTP(S) base URL without credentials, query or fragment")
    candidate = endpoint + parsed.path
    if parsed.query:
        candidate += "?" + parsed.query
    return list(dict.fromkeys([candidate, url]))


def download(
    url: str,
    destination: Path,
    attempts: int | None = None,
    *,
    expected_sha256: str | None = None,
    expected_size: int | None = None,
) -> None:
    attempts = attempts if attempts is not None else int(
        os.environ.get("XDRIVE_MODEL_DOWNLOAD_ATTEMPTS") or "5"
    )
    timeout = float(os.environ.get("XDRIVE_MODEL_DOWNLOAD_TIMEOUT") or "30")
    if attempts < 1 or not math.isfinite(timeout) or timeout <= 0:
        raise ValueError("model download attempts and timeout must be positive")
    sources = download_urls(url)
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_name(destination.name + ".part")
    partial_key = destination.with_name(destination.name + ".part.key")
    identity = hashlib.sha256(
        f"{url}\n{expected_sha256}\n{expected_size}".encode("utf-8")
    ).hexdigest()

    if destination.exists() and expected_sha256:
        try:
            verify_model(destination, expected_sha256, expected_size)
        except ModelIntegrityError:
            print(f"[photo-face-model] {destination.name}: invalid cache; downloading again", file=sys.stderr)
        else:
            partial.unlink(missing_ok=True)
            partial_key.unlink(missing_ok=True)
            return

    # A partial from another pinned URL/hash must never be appended to this one.
    try:
        same_identity = partial_key.read_bytes() == identity.encode("ascii")
    except FileNotFoundError:
        same_identity = False
    if not same_identity:
        partial.unlink(missing_ok=True)
    partial_key.write_text(identity, encoding="ascii")

    def publish() -> None:
        os.replace(partial, destination)
        partial_key.unlink(missing_ok=True)

    last_error: Exception | None = None
    disabled_sources: set[str] = set()
    request_count = 0
    for attempt in range(1, attempts + 1):
        for source in sources:
            if source in disabled_sources:
                continue
            offset = partial.stat().st_size if partial.exists() else 0
            request_count += 1
            host = urllib.parse.urlsplit(source).hostname
            print(
                f"[photo-face-model] {destination.name}: source={host} "
                f"attempt={attempt}/{attempts} resume={offset} bytes",
                file=sys.stderr, flush=True,
            )
            try:
                headers = {
                    "User-Agent": "xdrive-photo-intelligence-model-fetch/1",
                    "Accept": "application/octet-stream,*/*;q=0.8",
                    "Accept-Encoding": "identity",
                }
                if offset:
                    headers["Range"] = f"bytes={offset}-"
                request = urllib.request.Request(source, headers=headers)
                with urllib.request.urlopen(request, timeout=timeout) as response:
                    content_length = response.headers.get("Content-Length")
                    if content_length is not None and not content_length.isdigit():
                        raise InvalidDownloadResponse("invalid Content-Length")
                    length = int(content_length) if content_length is not None else None
                    if response.headers.get("Content-Encoding", "identity") != "identity":
                        raise InvalidDownloadResponse("unexpected encoded model response")
                    if response.status == 206:
                        match = re.fullmatch(
                            r"bytes (\d+)-(\d+)/(\d+)",
                            response.headers.get("Content-Range", ""),
                        )
                        if match is None:
                            raise InvalidDownloadResponse("missing or invalid Content-Range")
                        start, end, total = map(int, match.groups())
                        if (
                            start != offset or end < start or end >= total
                            or (length is not None and length != end - start + 1)
                        ):
                            raise InvalidDownloadResponse("Content-Range does not match requested offset")
                        expected_end = end + 1
                    elif response.status == 200:
                        # An origin/proxy may ignore Range: replace the partial,
                        # rather than appending a second complete response to it.
                        offset = 0
                        total = length
                        expected_end = length
                    else:
                        raise InvalidDownloadResponse(f"unexpected HTTP status {response.status}")

                    with partial.open("ab" if offset else "wb") as output:
                        reader = getattr(response, "read1", response.read)
                        for chunk in iter(lambda: reader(1024 * 1024), b""):
                            output.write(chunk)
                    actual_size = partial.stat().st_size
                    if expected_end is not None and actual_size != expected_end:
                        raise OSError(f"interrupted body: received {actual_size}, expected {expected_end} bytes")
                    if total is not None and actual_size != total:
                        raise OSError(f"partial response: received {actual_size} of {total} bytes")
                if expected_sha256:
                    verify_model(partial, expected_sha256, expected_size)
                elif not partial.stat().st_size:
                    raise ModelIntegrityError("downloaded file is empty")
                publish()
                return
            except urllib.error.HTTPError as exc:
                last_error = exc
                if exc.code == 416:
                    # A previous process can finish the bytes but stop before
                    # rename. Only a matching digest makes that partial usable.
                    complete = re.fullmatch(r"bytes \*/(\d+)", exc.headers.get("Content-Range", ""))
                    if expected_sha256 and partial.exists() and complete and int(complete[1]) == offset:
                        try:
                            verify_model(partial, expected_sha256, expected_size)
                        except ModelIntegrityError:
                            pass
                        else:
                            exc.close()
                            publish()
                            return
                    partial.unlink(missing_ok=True)
                elif exc.code not in (408, 425, 429) and not 500 <= exc.code < 600:
                    disabled_sources.add(source)
                exc.close()
            except (ModelIntegrityError, InvalidDownloadResponse) as exc:
                last_error = exc
                partial.unlink(missing_ok=True)
            except (OSError, urllib.error.URLError, http.client.HTTPException) as exc:
                last_error = exc
                # Retain bytes and identity for the next source/attempt/job.
            print(
                f"[photo-face-model] {destination.name}: {last_error}; trying next available source",
                file=sys.stderr, flush=True,
            )
        if len(disabled_sources) == len(sources):
            break
        if attempt != attempts:
            time.sleep(min(2 ** (attempt - 1), 8))
    retained = partial.stat().st_size if partial.exists() else 0
    raise RuntimeError(
        f"{destination.name}: download failed after {request_count} requests; "
        f"retained {retained} partial bytes for retry"
    ) from last_error


def verify_model(
    path: Path,
    expected_sha256: str,
    expected_size: int | None,
) -> None:
    size = path.stat().st_size
    if expected_size is not None and size != expected_size:
        raise ModelIntegrityError(
            f"{path.name}: size mismatch: got {size}, expected {expected_size}"
        )
    actual_sha256 = sha256_file(path)
    if actual_sha256 != expected_sha256:
        raise ModelIntegrityError(
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


def download_text(url: str, destination: Path, expected_sha256: str) -> str:
    download(url, destination, expected_sha256=expected_sha256)
    return destination.read_text(encoding="utf-8")


def write_runtime_text_assets(model_dir: Path) -> None:
    try:
        verify_model(model_dir / "imagenet1k_labels.txt", IMAGENET_LABELS_SHA256, None)
        verify_model(model_dir / "crnn_cn_charset.txt", CRNN_CHARSET_SHA256, None)
        return
    except (FileNotFoundError, ModelIntegrityError):
        pass
    mobilenet_source = download_text(
        ZOO_RAW + "/models/image_classification_mobilenet/mobilenet.py",
        model_dir / ".mobilenet_source.py",
        "8baaadee63e6deabb5b1063c8338092f1cdf79f6a8377d614dbb47751ce7b55c",
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
        "349e7262b1d1e87041d56cad30d062685acec5dce9e9f333f030bdc36d283004",
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
    verify_model(model_dir / "imagenet1k_labels.txt", IMAGENET_LABELS_SHA256, None)
    verify_model(model_dir / "crnn_cn_charset.txt", CRNN_CHARSET_SHA256, None)
    (model_dir / ".mobilenet_source.py").unlink(missing_ok=True)
    (model_dir / ".crnn_source.py").unlink(missing_ok=True)


def model_metadata_text() -> str:
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
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Fetch or verify pinned Photo Intelligence runtime assets")
    parser.add_argument("model_dir", nargs="?", default="/models", type=Path)
    parser.add_argument("license_dir", nargs="?", default="/licenses", type=Path)
    parser.add_argument("--verify-only", action="store_true", help="Verify all cached assets without network access or changes")
    args = parser.parse_args(argv)
    model_dir, license_dir = args.model_dir, args.license_dir
    metadata = license_dir / "OPENCV_ZOO_SOURCE.txt"
    if args.verify_only:
        for item in FILES:
            verify_model(model_dir / item["name"], item["sha256"], item["size"])
        verify_model(model_dir / "imagenet1k_labels.txt", IMAGENET_LABELS_SHA256, None)
        verify_model(model_dir / "crnn_cn_charset.txt", CRNN_CHARSET_SHA256, None)
        for item in LICENSES:
            verify_model(license_dir / item["name"], item["sha256"], None)
        if metadata.read_text(encoding="utf-8") != model_metadata_text():
            raise ModelIntegrityError("OPENCV_ZOO_SOURCE.txt: cached model provenance mismatch")
        print("[photo-face-model] verified all pinned runtime assets without network access")
        return 0

    model_dir.mkdir(parents=True, exist_ok=True)
    license_dir.mkdir(parents=True, exist_ok=True)
    for item in FILES:
        download(
            item["url"], model_dir / item["name"],
            expected_sha256=item["sha256"], expected_size=item["size"],
        )
    write_runtime_text_assets(model_dir)
    for item in LICENSES:
        download(item["url"], license_dir / item["name"], expected_sha256=item["sha256"])
    metadata.write_text(model_metadata_text(), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
