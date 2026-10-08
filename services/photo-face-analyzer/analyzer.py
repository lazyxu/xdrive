#!/usr/bin/env python3

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import http.client
import json
import math
import os
from pathlib import Path
import re
import signal
import socket
import socketserver
import stat
import sys
import threading
import time
from typing import Any
from urllib.parse import parse_qs, urlsplit

import cv2 as cv
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

from creative import (
    CREATIVE_PIPELINE_VERSION,
    CREATIVE_PROTOCOL_VERSION,
    CreativeRuntime,
)

PROTOCOL_VERSION = 1
ANALYZER_NAME = "xdrive-opencv-yunet-sface"
YUNET_MODEL_NAME = "face_detection_yunet_2023mar.onnx"
YUNET_MODEL_VERSION = "2023mar"
YUNET_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
YUNET_LICENSE = "MIT"
YUNET_LICENSE_URL = (
    "https://github.com/opencv/opencv_zoo/tree/"
    "47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_detection_yunet"
)

SFACE_MODEL_NAME = "face_recognition_sface_2021dec.onnx"
SFACE_MODEL_VERSION = "2021dec"
SFACE_SHA256 = "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"
SFACE_LICENSE = "Apache-2.0"
SFACE_LICENSE_URL = (
    "https://github.com/opencv/opencv_zoo/tree/"
    "47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_recognition_sface"
)

SMART_PROTOCOL_VERSION = 1
SMART_ANALYZER_NAME = "xdrive-opencv-mobilenetv2-ppocr-crnn"

MOBILENET_MODEL_NAME = "image_classification_mobilenetv2_2022apr.onnx"
MOBILENET_MODEL_VERSION = "2022apr"
MOBILENET_SHA256 = "c0c3f76d93fa3fd6580652a45618618a220fced18babf65774ed169de0432ad5"
MOBILENET_LICENSE = "Apache-2.0"
MOBILENET_LICENSE_URL = (
    "https://github.com/opencv/opencv_zoo/tree/"
    "47534e27c9851bb1128ccc0102f1145e27f23f98/models/image_classification_mobilenet"
)

PPOCR_MODEL_NAME = "text_detection_cn_ppocrv3_2023may.onnx"
PPOCR_MODEL_VERSION = "ppocrv3-2023may"
PPOCR_SHA256 = "03f550c6b406fda8bf54bd8327815f6c7e2edd98cea02348c93d879254366587"
PPOCR_LICENSE = "Apache-2.0"
PPOCR_LICENSE_URL = (
    "https://github.com/opencv/opencv_zoo/tree/"
    "47534e27c9851bb1128ccc0102f1145e27f23f98/models/text_detection_ppocr"
)

CRNN_MODEL_NAME = "text_recognition_CRNN_CN_2021nov.onnx"
CRNN_MODEL_VERSION = "CN-2021nov"
CRNN_SHA256 = "c760bf82d684b87dfabb288e6c0f92d41a8cd6c1780661ca2c3cd10c2065a9ba"
CRNN_LICENSE = "Apache-2.0"
CRNN_LICENSE_URL = (
    "https://github.com/opencv/opencv_zoo/tree/"
    "47534e27c9851bb1128ccc0102f1145e27f23f98/models/text_recognition_crnn"
)

SMART_VISUAL_TOP_K = 5
SMART_VISUAL_MIN_CONFIDENCE = 0.03
SMART_OCR_INPUT_SIZE = (736, 736)
SMART_OCR_MAX_CANDIDATES = 64
SMART_OCR_LANGUAGE = "zh-en"
SMART_OCR_MAX_TEXT_CHARS = 8192

SEMANTIC_PROTOCOL_VERSION = 1
SEMANTIC_ANALYZER_NAME = "xdrive-siglip2-base-patch16-224-int8"
SEMANTIC_VISION_NAME = "siglip2_vision_int8.onnx"
SEMANTIC_TEXT_NAME = "siglip2_text_int8.onnx"
SEMANTIC_TOKENIZER_NAME = "siglip2_tokenizer.json"
SEMANTIC_VISION_SHA256 = "0dd31785a2713f1113ef2272472165c69d580473dae38d7b47568ac587795e70"
SEMANTIC_TEXT_SHA256 = "3a0603d3a00c05a80a6ded4743c16aaac7b1e62cdcc7e362e7ce418659b96400"
SEMANTIC_TOKENIZER_SHA256 = "cb9140fae3ac5122c972d37adf83e1248471a38147ad76f8215c8872c6fd8322"
SEMANTIC_MODEL_VERSION = "siglip2-base-patch16-224-int8-ba1f3b0"
SEMANTIC_LICENSE = "Apache-2.0"
SEMANTIC_LICENSE_URL = "https://huggingface.co/google/siglip2-base-patch16-224"
SEMANTIC_DIMENSIONS = 768
SEMANTIC_FORMAT = "i8norm-v1"
SEMANTIC_IMAGE_SIZE = 224
SEMANTIC_TEXT_TOKENS = 64
SEMANTIC_PIPELINE_VERSION = (
    f"onnxruntime-{ort.__version__}-cpu-{SEMANTIC_MODEL_VERSION}"
    "-rgb224-rescale255-mean05-std05-i8norm-v1"
)

EMBEDDING_FORMAT = "f32le"
EMBEDDING_DIMENSIONS = 128

CONFIDENCE_THRESHOLD = 0.9
NMS_THRESHOLD = 0.3
TOP_K = 5000
MAX_FACES = 256
MAX_REQUEST_BYTES = 64 * 1024
MAX_PREVIEW_BYTES = 32 * 1024 * 1024
PREVIEW_PATH_RE = re.compile(r"^/api/v1/media-analysis-preview/[1-9][0-9]*$")
CREATIVE_PREVIEW_PATH_RE = re.compile(r"^/api/v1/media-creative-preview/[1-9][0-9]*$")

PIPELINE_VERSION = (
    f"opencv-{cv.__version__}-cpu-yunet2023mar"
    f"-conf{CONFIDENCE_THRESHOLD:g}-nms{NMS_THRESHOLD:g}-topk{TOP_K}"
    "-sface2021dec-aligncrop-l2-clip-v1"
)

SMART_PIPELINE_VERSION = (
    f"opencv-{cv.__version__}-cpu-mobilenetv2-2022apr"
    "-ppocrv3-cn-2023may-crnn-cn-2021nov-v2-label-index"
)


class RequestError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


class UnixHTTPConnection(http.client.HTTPConnection):
    def __init__(self, socket_path: str, timeout: float = 10.0) -> None:
        super().__init__("localhost", timeout=timeout)
        self.socket_path = socket_path

    def connect(self) -> None:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(self.timeout)
        sock.connect(self.socket_path)
        self.sock = sock


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def default_port(scheme: str) -> int:
    return 443 if scheme == "https" else 80


def origin_key(value: str) -> tuple[str, str, int]:
    parsed = urlsplit(value.strip())
    scheme = parsed.scheme.lower()
    if scheme not in ("http", "https"):
        raise ValueError("origin must use http or https")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("origin must not contain credentials")
    if not parsed.hostname:
        raise ValueError("origin host is required")
    if parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise ValueError("origin must not contain path, query, or fragment")
    try:
        port = parsed.port or default_port(scheme)
    except ValueError as exc:
        raise ValueError("origin port is invalid") from exc
    return scheme, parsed.hostname.lower(), port


def normalize_origin(value: str) -> str:
    scheme, host, port = origin_key(value)
    display_host = f"[{host}]" if ":" in host else host
    if port == default_port(scheme):
        return f"{scheme}://{display_host}"
    return f"{scheme}://{display_host}:{port}"


def validate_task(task: dict[str, Any], allowed_origin: str) -> dict[str, Any]:
    required = {
        "preview_url",
        "preview_version",
        "preview_edge",
        "input_fingerprint",
    }
    if set(task) != required:
        raise RequestError(400, "invalid analysis task fields")

    preview_url = task.get("preview_url")
    fingerprint = task.get("input_fingerprint")
    preview_version = task.get("preview_version")
    preview_edge = task.get("preview_edge")
    if not isinstance(preview_url, str) or not preview_url:
        raise RequestError(400, "invalid preview URL")
    if not isinstance(fingerprint, str) or not fingerprint or len(fingerprint) > 128:
        raise RequestError(400, "invalid input fingerprint")
    if (
        isinstance(preview_version, bool)
        or not isinstance(preview_version, int)
        or preview_version <= 0
    ):
        raise RequestError(400, "invalid preview version")
    if (
        isinstance(preview_edge, bool)
        or not isinstance(preview_edge, int)
        or preview_edge <= 0
        or preview_edge > 4096
    ):
        raise RequestError(400, "invalid preview edge")

    parsed = urlsplit(preview_url)
    if (
        parsed.scheme.lower() not in ("http", "https")
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
    ):
        raise RequestError(400, "invalid preview URL")
    try:
        preview_origin = (
            parsed.scheme.lower(),
            parsed.hostname.lower(),
            parsed.port or default_port(parsed.scheme.lower()),
        )
    except ValueError as exc:
        raise RequestError(400, "invalid preview URL") from exc
    if preview_origin != origin_key(allowed_origin):
        raise RequestError(400, "preview URL origin is not allowed")
    if not PREVIEW_PATH_RE.fullmatch(parsed.path):
        raise RequestError(400, "preview URL path is not allowed")
    try:
        query = parse_qs(parsed.query, keep_blank_values=True, strict_parsing=True)
    except ValueError as exc:
        raise RequestError(400, "preview URL query is invalid") from exc
    if set(query) != {"ticket"} or len(query["ticket"]) != 1 or not query["ticket"][0]:
        raise RequestError(400, "preview URL ticket is invalid")

    return {
        "preview_url": preview_url,
        "preview_version": preview_version,
        "preview_edge": preview_edge,
        "input_fingerprint": fingerprint,
    }


def fetch_preview(task: dict[str, Any], allowed_origin: str) -> np.ndarray:
    task = validate_task(task, allowed_origin)
    parsed = urlsplit(task["preview_url"])
    port = parsed.port or default_port(parsed.scheme.lower())
    connection_class = (
        http.client.HTTPSConnection
        if parsed.scheme.lower() == "https"
        else http.client.HTTPConnection
    )
    connection = connection_class(parsed.hostname, port=port, timeout=15)
    try:
        path = parsed.path + ("?" + parsed.query if parsed.query else "")
        connection.request(
            "GET",
            path,
            headers={
                "Accept": "image/jpeg",
                "User-Agent": "xdrive-photo-face/1",
                "Connection": "close",
            },
        )
        response = connection.getresponse()
        if response.status != 200:
            raise RequestError(502, "analysis preview fetch failed")

        content_length = response.getheader("Content-Length")
        if content_length:
            try:
                if int(content_length) > MAX_PREVIEW_BYTES:
                    raise RequestError(502, "analysis preview is too large")
            except ValueError as exc:
                raise RequestError(502, "analysis preview length is invalid") from exc

        content_type = (response.getheader("Content-Type") or "").split(";", 1)[0]
        if content_type.strip().lower() != "image/jpeg":
            raise RequestError(502, "analysis preview is not JPEG")
        if response.getheader("X-XDrive-Analysis-Preview-Version") != str(
            task["preview_version"]
        ):
            raise RequestError(502, "analysis preview version mismatch")
        if response.getheader("X-XDrive-Analysis-Preview-Edge") != str(
            task["preview_edge"]
        ):
            raise RequestError(502, "analysis preview edge mismatch")
        expected_etag = '"' + task["input_fingerprint"] + '"'
        if response.getheader("ETag") != expected_etag:
            raise RequestError(502, "analysis preview fingerprint mismatch")

        data = response.read(MAX_PREVIEW_BYTES + 1)
        if len(data) > MAX_PREVIEW_BYTES:
            raise RequestError(502, "analysis preview is too large")
    except RequestError:
        raise
    except Exception as exc:
        raise RequestError(502, "analysis preview fetch failed") from exc
    finally:
        connection.close()

    encoded = np.frombuffer(data, dtype=np.uint8)
    image = cv.imdecode(encoded, cv.IMREAD_COLOR)
    if image is None or image.ndim != 3 or image.shape[2] != 3:
        raise RequestError(502, "analysis preview JPEG cannot be decoded")
    height, width = image.shape[:2]
    if width <= 0 or height <= 0 or max(width, height) > task["preview_edge"]:
        raise RequestError(502, "analysis preview dimensions are invalid")
    return image


def validate_creative_preview_task(
    task: dict[str, Any],
    allowed_origin: str,
) -> dict[str, Any]:
    required = {
        "preview_url",
        "preview_version",
        "preview_edge",
        "input_fingerprint",
    }
    if set(task) != required:
        raise RequestError(400, "invalid creative preview task fields")
    preview_url = task.get("preview_url")
    fingerprint = task.get("input_fingerprint")
    preview_version = task.get("preview_version")
    preview_edge = task.get("preview_edge")
    if not isinstance(preview_url, str) or not preview_url:
        raise RequestError(400, "invalid creative preview URL")
    if not isinstance(fingerprint, str) or not fingerprint or len(fingerprint) > 128:
        raise RequestError(400, "invalid creative input fingerprint")
    if isinstance(preview_version, bool) or not isinstance(preview_version, int) or preview_version <= 0:
        raise RequestError(400, "invalid creative preview version")
    if (
        isinstance(preview_edge, bool)
        or not isinstance(preview_edge, int)
        or preview_edge <= 0
        or preview_edge > 4096
    ):
        raise RequestError(400, "invalid creative preview edge")
    parsed = urlsplit(preview_url)
    if (
        parsed.scheme.lower() not in ("http", "https")
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
    ):
        raise RequestError(400, "invalid creative preview URL")
    try:
        preview_origin = (
            parsed.scheme.lower(),
            parsed.hostname.lower(),
            parsed.port or default_port(parsed.scheme.lower()),
        )
    except ValueError as exc:
        raise RequestError(400, "invalid creative preview URL") from exc
    if preview_origin != origin_key(allowed_origin):
        raise RequestError(400, "creative preview URL origin is not allowed")
    if not CREATIVE_PREVIEW_PATH_RE.fullmatch(parsed.path):
        raise RequestError(400, "creative preview URL path is not allowed")
    try:
        query = parse_qs(parsed.query, keep_blank_values=True, strict_parsing=True)
    except ValueError as exc:
        raise RequestError(400, "creative preview URL query is invalid") from exc
    if set(query) != {"ticket"} or len(query["ticket"]) != 1 or not query["ticket"][0]:
        raise RequestError(400, "creative preview URL ticket is invalid")
    return {
        "preview_url": preview_url,
        "preview_version": preview_version,
        "preview_edge": preview_edge,
        "input_fingerprint": fingerprint,
    }


def fetch_creative_preview(
    task: dict[str, Any],
    allowed_origin: str,
) -> np.ndarray:
    task = validate_creative_preview_task(task, allowed_origin)
    parsed = urlsplit(task["preview_url"])
    port = parsed.port or default_port(parsed.scheme.lower())
    connection_class = (
        http.client.HTTPSConnection
        if parsed.scheme.lower() == "https"
        else http.client.HTTPConnection
    )
    connection = connection_class(parsed.hostname, port=port, timeout=15)
    try:
        path = parsed.path + ("?" + parsed.query if parsed.query else "")
        connection.request(
            "GET",
            path,
            headers={
                "Accept": "image/jpeg",
                "User-Agent": "xdrive-photo-creative/1",
                "Connection": "close",
            },
        )
        response = connection.getresponse()
        if response.status != 200:
            raise RequestError(502, "creative preview fetch failed")
        content_length = response.getheader("Content-Length")
        if content_length:
            try:
                if int(content_length) > MAX_PREVIEW_BYTES:
                    raise RequestError(502, "creative preview is too large")
            except ValueError as exc:
                raise RequestError(502, "creative preview length is invalid") from exc
        content_type = (response.getheader("Content-Type") or "").split(";", 1)[0]
        if content_type.strip().lower() != "image/jpeg":
            raise RequestError(502, "creative preview is not JPEG")
        if response.getheader("X-XDrive-Creative-Preview-Version") != str(task["preview_version"]):
            raise RequestError(502, "creative preview version mismatch")
        if response.getheader("X-XDrive-Creative-Preview-Edge") != str(task["preview_edge"]):
            raise RequestError(502, "creative preview edge mismatch")
        if response.getheader("ETag") != '"' + task["input_fingerprint"] + '"':
            raise RequestError(502, "creative preview fingerprint mismatch")
        data = response.read(MAX_PREVIEW_BYTES + 1)
        if len(data) > MAX_PREVIEW_BYTES:
            raise RequestError(502, "creative preview is too large")
    except RequestError:
        raise
    except Exception as exc:
        raise RequestError(502, "creative preview fetch failed") from exc
    finally:
        connection.close()
    encoded = np.frombuffer(data, dtype=np.uint8)
    image = cv.imdecode(encoded, cv.IMREAD_COLOR)
    if image is None or image.ndim != 3 or image.shape[2] != 3:
        raise RequestError(502, "creative preview JPEG cannot be decoded")
    height, width = image.shape[:2]
    if width <= 0 or height <= 0 or max(width, height) > task["preview_edge"]:
        raise RequestError(502, "creative preview dimensions are invalid")
    return image


class FaceRuntime:
    def __init__(
        self,
        yunet_path: str | None = None,
        sface_path: str | None = None,
    ) -> None:
        self.yunet_path = Path(
            yunet_path
            or os.environ.get(
                "XD_FACE_YUNET_MODEL",
                f"/models/{YUNET_MODEL_NAME}",
            )
        )
        self.sface_path = Path(
            sface_path
            or os.environ.get(
                "XD_FACE_SFACE_MODEL",
                f"/models/{SFACE_MODEL_NAME}",
            )
        )
        self._verify_model(self.yunet_path, YUNET_SHA256)
        self._verify_model(self.sface_path, SFACE_SHA256)

        self.detector = cv.FaceDetectorYN.create(
            model=str(self.yunet_path),
            config="",
            input_size=(320, 320),
            score_threshold=CONFIDENCE_THRESHOLD,
            nms_threshold=NMS_THRESHOLD,
            top_k=TOP_K,
            backend_id=cv.dnn.DNN_BACKEND_OPENCV,
            target_id=cv.dnn.DNN_TARGET_CPU,
        )
        self.recognizer = cv.FaceRecognizerSF.create(
            model=str(self.sface_path),
            config="",
            backend_id=cv.dnn.DNN_BACKEND_OPENCV,
            target_id=cv.dnn.DNN_TARGET_CPU,
        )
        self.lock = threading.Lock()

    @staticmethod
    def _verify_model(path: Path, expected_sha256: str) -> None:
        if not path.is_file():
            raise RuntimeError(f"required face model is missing: {path.name}")
        actual = sha256_file(path)
        if actual != expected_sha256:
            raise RuntimeError(
                f"face model sha256 mismatch for {path.name}: got {actual}"
            )

    def info(self) -> dict[str, Any]:
        return {
            "protocol_version": PROTOCOL_VERSION,
            "name": ANALYZER_NAME,
            "pipeline_version": PIPELINE_VERSION,
            "detector": {
                "name": "YuNet",
                "version": YUNET_MODEL_VERSION,
                "sha256": YUNET_SHA256,
                "license": YUNET_LICENSE,
                "license_url": YUNET_LICENSE_URL,
            },
            "embedding": {
                "name": "SFace",
                "version": SFACE_MODEL_VERSION,
                "sha256": SFACE_SHA256,
                "license": SFACE_LICENSE,
                "license_url": SFACE_LICENSE_URL,
            },
            "embedding_format": EMBEDDING_FORMAT,
            "embedding_dimensions": EMBEDDING_DIMENSIONS,
            "runtime": {
                "framework": "opencv_dnn",
                "version": cv.__version__,
                "device": "cpu",
            },
        }

    def _embedding(self, image: np.ndarray, face14: np.ndarray) -> np.ndarray:
        aligned = self.recognizer.alignCrop(image, face14.astype(np.float32))
        feature = self.recognizer.feature(aligned)
        vector = np.asarray(feature, dtype=np.float32).reshape(-1)
        if vector.size != EMBEDDING_DIMENSIONS:
            raise RuntimeError(
                f"SFace returned {vector.size} dimensions; "
                f"expected {EMBEDDING_DIMENSIONS}"
            )
        if not np.isfinite(vector).all():
            raise RuntimeError("SFace returned non-finite embedding values")
        norm = float(np.linalg.norm(vector))
        if not math.isfinite(norm) or norm <= 1e-12:
            raise RuntimeError("SFace returned a zero-norm embedding")
        vector = vector / np.float32(norm)
        if not np.isfinite(vector).all():
            raise RuntimeError("SFace normalization produced non-finite values")
        return vector.astype("<f4", copy=False)

    @staticmethod
    def _normalized_geometry(
        face: np.ndarray,
        width: int,
        height: int,
    ) -> tuple[dict[str, float], list[dict[str, float]]] | None:
        x, y, box_width, box_height = [float(value) for value in face[:4]]
        x0 = min(max(x, 0.0), float(width))
        y0 = min(max(y, 0.0), float(height))
        x1 = min(max(x + box_width, 0.0), float(width))
        y1 = min(max(y + box_height, 0.0), float(height))
        if x1 <= x0 or y1 <= y0:
            return None

        box = {
            "x": x0 / width,
            "y": y0 / height,
            "width": (x1 - x0) / width,
            "height": (y1 - y0) / height,
        }
        raw_landmarks = np.asarray(face[4:14], dtype=np.float32).reshape(5, 2)
        landmarks = [
            {
                "x": min(max(float(point[0]), 0.0), float(width)) / width,
                "y": min(max(float(point[1]), 0.0), float(height)) / height,
            }
            for point in raw_landmarks
        ]
        return box, landmarks

    def analyze(self, image: np.ndarray) -> list[dict[str, Any]]:
        height, width = image.shape[:2]
        if width <= 0 or height <= 0:
            raise RuntimeError("analysis image dimensions are invalid")

        with self.lock:
            self.detector.setInputSize((width, height))
            _, faces = self.detector.detect(image)
            if faces is None:
                return []
            if len(faces) > MAX_FACES:
                raise RuntimeError(
                    f"YuNet returned {len(faces)} faces; maximum is {MAX_FACES}"
                )

            output: list[dict[str, Any]] = []
            for face in faces:
                row = np.asarray(face, dtype=np.float32).reshape(-1)
                if row.size < 15 or not np.isfinite(row[:15]).all():
                    raise RuntimeError("YuNet returned an invalid detection")
                geometry = self._normalized_geometry(row, width, height)
                if geometry is None:
                    continue
                confidence = float(row[14])
                if confidence < 0.0 or confidence > 1.0:
                    raise RuntimeError("YuNet returned invalid confidence")
                vector = self._embedding(image, row[:14])
                output.append(
                    {
                        "box": geometry[0],
                        "landmarks": geometry[1],
                        "confidence": confidence,
                        "embedding": base64.b64encode(vector.tobytes()).decode(
                            "ascii"
                        ),
                    }
                )
            return output


class SmartRuntime:
    def __init__(
        self,
        classifier_path: str | None = None,
        detector_path: str | None = None,
        recognizer_path: str | None = None,
        labels_path: str | None = None,
        charset_path: str | None = None,
    ) -> None:
        self.classifier_path = Path(
            classifier_path
            or os.environ.get(
                "XD_SMART_CLASSIFIER_MODEL",
                f"/models/{MOBILENET_MODEL_NAME}",
            )
        )
        self.detector_path = Path(
            detector_path
            or os.environ.get(
                "XD_SMART_OCR_DETECTOR_MODEL",
                f"/models/{PPOCR_MODEL_NAME}",
            )
        )
        self.recognizer_path = Path(
            recognizer_path
            or os.environ.get(
                "XD_SMART_OCR_RECOGNIZER_MODEL",
                f"/models/{CRNN_MODEL_NAME}",
            )
        )
        self.labels_path = Path(
            labels_path
            or os.environ.get(
                "XD_SMART_IMAGENET_LABELS",
                "/models/imagenet1k_labels.txt",
            )
        )
        self.charset_path = Path(
            charset_path
            or os.environ.get(
                "XD_SMART_OCR_CHARSET",
                "/models/crnn_cn_charset.txt",
            )
        )

        FaceRuntime._verify_model(self.classifier_path, MOBILENET_SHA256)
        FaceRuntime._verify_model(self.detector_path, PPOCR_SHA256)
        FaceRuntime._verify_model(self.recognizer_path, CRNN_SHA256)

        self.labels = [
            value.strip()
            for value in self.labels_path.read_text(encoding="utf-8").splitlines()
            if value.strip()
        ]
        if len(self.labels) != 1000:
            raise RuntimeError(
                f"ImageNet label count is {len(self.labels)}, expected 1000"
            )
        self.charset = self.charset_path.read_text(encoding="utf-8")
        if len(self.charset) < 3900:
            raise RuntimeError("CRNN CN charset is incomplete")

        self.classifier = cv.dnn.readNet(str(self.classifier_path))
        self.classifier.setPreferableBackend(cv.dnn.DNN_BACKEND_OPENCV)
        self.classifier.setPreferableTarget(cv.dnn.DNN_TARGET_CPU)

        detector_net = cv.dnn.readNet(str(self.detector_path))
        detector_net.setPreferableBackend(cv.dnn.DNN_BACKEND_OPENCV)
        detector_net.setPreferableTarget(cv.dnn.DNN_TARGET_CPU)
        self.text_detector = cv.dnn_TextDetectionModel_DB(detector_net)
        self.text_detector.setBinaryThreshold(0.3)
        self.text_detector.setPolygonThreshold(0.5)
        self.text_detector.setUnclipRatio(2.0)
        self.text_detector.setMaxCandidates(200)
        self.text_detector.setInputSize(SMART_OCR_INPUT_SIZE)
        self.text_detector.setInputMean((123.675, 116.28, 103.53))
        self.text_detector.setInputScale(
            1.0 / 255.0 / np.array([0.229, 0.224, 0.225])
        )

        self.text_recognizer = cv.dnn.readNet(str(self.recognizer_path))
        self.text_recognizer.setPreferableBackend(cv.dnn.DNN_BACKEND_OPENCV)
        self.text_recognizer.setPreferableTarget(cv.dnn.DNN_TARGET_CPU)
        self.lock = threading.Lock()
        self._ocr_target_vertices = np.array(
            [[0, 31], [0, 0], [99, 0], [99, 31]],
            dtype=np.float32,
        )

    def info(self) -> dict[str, Any]:
        runtime = {
            "framework": "opencv_dnn",
            "version": cv.__version__,
            "device": "cpu",
        }
        return {
            "protocol_version": SMART_PROTOCOL_VERSION,
            "name": SMART_ANALYZER_NAME,
            "pipeline_version": SMART_PIPELINE_VERSION,
            "classifier": {
                "name": "MobileNetV2",
                "version": MOBILENET_MODEL_VERSION,
                "sha256": MOBILENET_SHA256,
                "license": MOBILENET_LICENSE,
                "license_url": MOBILENET_LICENSE_URL,
            },
            "text_detector": {
                "name": "PP-OCRv3",
                "version": PPOCR_MODEL_VERSION,
                "sha256": PPOCR_SHA256,
                "license": PPOCR_LICENSE,
                "license_url": PPOCR_LICENSE_URL,
            },
            "text_recognizer": {
                "name": "CRNN-CN",
                "version": CRNN_MODEL_VERSION,
                "sha256": CRNN_SHA256,
                "license": CRNN_LICENSE,
                "license_url": CRNN_LICENSE_URL,
            },
            "ocr_language": SMART_OCR_LANGUAGE,
            "runtime": runtime,
        }

    def _classify(self, image: np.ndarray) -> list[dict[str, Any]]:
        rgb = cv.cvtColor(image, cv.COLOR_BGR2RGB)
        resized = cv.resize(rgb, (256, 256), interpolation=cv.INTER_AREA)
        crop = resized[16:240, 16:240, :].astype(np.float32)
        normalized = (
            crop / 255.0
            - np.array([0.485, 0.456, 0.406], dtype=np.float32)
        ) / np.array([0.229, 0.224, 0.225], dtype=np.float32)
        blob = normalized.transpose(2, 0, 1)[np.newaxis, :, :, :]
        self.classifier.setInput(blob.astype(np.float32))
        output = np.asarray(self.classifier.forward(), dtype=np.float32).reshape(-1)
        if output.size != len(self.labels) or not np.isfinite(output).all():
            raise RuntimeError("MobileNet classifier returned invalid output")
        if (
            float(output.min()) < 0.0
            or float(output.max()) > 1.0
            or abs(float(output.sum()) - 1.0) > 0.05
        ):
            stable = output - float(output.max())
            probabilities = np.exp(stable)
            probabilities /= max(float(probabilities.sum()), 1e-12)
        else:
            probabilities = output
        indices = np.argsort(probabilities)[::-1][:SMART_VISUAL_TOP_K]
        labels: list[dict[str, Any]] = []
        for raw_index in indices:
            index = int(raw_index)
            confidence = float(probabilities[index])
            if confidence < SMART_VISUAL_MIN_CONFIDENCE:
                continue
            labels.append(
                {
                    "index": index,
                    "label": self.labels[index],
                    "confidence": confidence,
                }
            )
        return labels

    def _decode_text(self, output: np.ndarray) -> str:
        chars: list[str] = []
        previous = -1
        for step in np.asarray(output):
            values = np.asarray(step).reshape(-1)
            index = int(np.argmax(values))
            if index != 0 and index != previous:
                charset_index = index - 1
                if 0 <= charset_index < len(self.charset):
                    chars.append(self.charset[charset_index])
            previous = index
        return "".join(chars).strip()

    def _recognize_text(
        self,
        image: np.ndarray,
        box: np.ndarray,
    ) -> str:
        vertices = np.asarray(box, dtype=np.float32).reshape((4, 2))
        transform = cv.getPerspectiveTransform(
            vertices,
            self._ocr_target_vertices,
        )
        cropped = cv.warpPerspective(image, transform, (100, 32))
        blob = cv.dnn.blobFromImage(
            cropped,
            size=(100, 32),
            mean=127.5,
            scalefactor=1 / 127.5,
        )
        self.text_recognizer.setInput(blob)
        return self._decode_text(self.text_recognizer.forward())

    def _ocr(self, image: np.ndarray) -> str:
        resized = cv.resize(image, SMART_OCR_INPUT_SIZE, interpolation=cv.INTER_AREA)
        boxes, scores = self.text_detector.detect(resized)
        if boxes is None or len(boxes) == 0:
            return ""
        candidates: list[tuple[float, float, np.ndarray, float]] = []
        for box, score in zip(boxes, scores):
            points = np.asarray(box, dtype=np.float32).reshape((4, 2))
            candidates.append(
                (
                    float(points[:, 1].mean()),
                    float(points[:, 0].mean()),
                    points,
                    float(score),
                )
            )
        candidates.sort(key=lambda item: (item[0], item[1]))
        texts: list[str] = []
        for _, _, points, _ in candidates[:SMART_OCR_MAX_CANDIDATES]:
            text = self._recognize_text(resized, points)
            if text:
                texts.append(text)
        return " ".join(texts).strip()[:SMART_OCR_MAX_TEXT_CHARS]

    def analyze(self, image: np.ndarray) -> dict[str, Any]:
        if image.ndim != 3 or image.shape[2] != 3:
            raise RuntimeError("smart analysis image dimensions are invalid")
        with self.lock:
            return {
                "labels": self._classify(image),
                "ocr_text": self._ocr(image),
                "ocr_language": SMART_OCR_LANGUAGE,
            }


class SemanticRuntime:
    def __init__(
        self,
        vision_path: str | None = None,
        text_path: str | None = None,
        tokenizer_path: str | None = None,
    ) -> None:
        self.vision_path = Path(
            vision_path
            or os.environ.get(
                "XD_SEMANTIC_VISION_MODEL",
                f"/models/{SEMANTIC_VISION_NAME}",
            )
        )
        self.text_path = Path(
            text_path
            or os.environ.get(
                "XD_SEMANTIC_TEXT_MODEL",
                f"/models/{SEMANTIC_TEXT_NAME}",
            )
        )
        self.tokenizer_path = Path(
            tokenizer_path
            or os.environ.get(
                "XD_SEMANTIC_TOKENIZER",
                f"/models/{SEMANTIC_TOKENIZER_NAME}",
            )
        )
        for path, expected in (
            (self.vision_path, SEMANTIC_VISION_SHA256),
            (self.text_path, SEMANTIC_TEXT_SHA256),
            (self.tokenizer_path, SEMANTIC_TOKENIZER_SHA256),
        ):
            if not path.is_file():
                raise RuntimeError(f"required semantic model file is missing: {path.name}")
            actual = sha256_file(path)
            if actual != expected:
                raise RuntimeError(
                    f"semantic model sha256 mismatch for {path.name}: got {actual}"
                )

        options = ort.SessionOptions()
        options.intra_op_num_threads = max(1, min(4, os.cpu_count() or 1))
        options.inter_op_num_threads = 1
        providers = ["CPUExecutionProvider"]
        self.vision = ort.InferenceSession(
            str(self.vision_path),
            sess_options=options,
            providers=providers,
        )
        self.text = ort.InferenceSession(
            str(self.text_path),
            sess_options=options,
            providers=providers,
        )
        self.tokenizer = Tokenizer.from_file(str(self.tokenizer_path))
        self.tokenizer.enable_truncation(max_length=SEMANTIC_TEXT_TOKENS)
        self.tokenizer.enable_padding(
            length=SEMANTIC_TEXT_TOKENS,
            pad_id=1,
            pad_token="</s>",
        )
        self.lock = threading.Lock()
        self._validate_contract()

    @staticmethod
    def _session_contract(
        session: ort.InferenceSession,
        input_name: str,
        output_name: str,
    ) -> None:
        inputs = {item.name: item for item in session.get_inputs()}
        outputs = {item.name: item for item in session.get_outputs()}
        if input_name not in inputs:
            raise RuntimeError(f"semantic model input {input_name} is missing")
        if output_name not in outputs:
            raise RuntimeError(f"semantic model output {output_name} is missing")

    def _validate_contract(self) -> None:
        self._session_contract(self.vision, "pixel_values", "pooler_output")
        self._session_contract(self.text, "input_ids", "pooler_output")

    def info(self) -> dict[str, Any]:
        model_common = {
            "name": "SigLIP2 Base Patch16 224",
            "version": SEMANTIC_MODEL_VERSION,
            "license": SEMANTIC_LICENSE,
            "license_url": SEMANTIC_LICENSE_URL,
        }
        return {
            "protocol_version": SEMANTIC_PROTOCOL_VERSION,
            "name": SEMANTIC_ANALYZER_NAME,
            "pipeline_version": SEMANTIC_PIPELINE_VERSION,
            "vision_model": {
                **model_common,
                "sha256": SEMANTIC_VISION_SHA256,
            },
            "text_model": {
                **model_common,
                "sha256": SEMANTIC_TEXT_SHA256,
            },
            "tokenizer_sha256": SEMANTIC_TOKENIZER_SHA256,
            "embedding_format": SEMANTIC_FORMAT,
            "embedding_dimensions": SEMANTIC_DIMENSIONS,
            "runtime": {
                "framework": "onnxruntime",
                "version": ort.__version__,
                "device": "cpu",
            },
        }

    @staticmethod
    def _quantize(vector: np.ndarray) -> dict[str, Any]:
        value = np.asarray(vector, dtype=np.float32).reshape(-1)
        if value.size != SEMANTIC_DIMENSIONS or not np.isfinite(value).all():
            raise RuntimeError("semantic model returned invalid embedding")
        norm = float(np.linalg.norm(value))
        if not math.isfinite(norm) or norm <= 1e-12:
            raise RuntimeError("semantic model returned zero-norm embedding")
        value = value / np.float32(norm)
        quantized = np.clip(np.rint(value * 127.0), -127, 127).astype(np.int8)
        return {
            "embedding": base64.b64encode(quantized.tobytes()).decode("ascii"),
            "format": SEMANTIC_FORMAT,
            "dimensions": SEMANTIC_DIMENSIONS,
        }

    @staticmethod
    def _image_tensor(image: np.ndarray) -> np.ndarray:
        rgb = cv.cvtColor(image, cv.COLOR_BGR2RGB)
        resized = cv.resize(
            rgb,
            (SEMANTIC_IMAGE_SIZE, SEMANTIC_IMAGE_SIZE),
            interpolation=cv.INTER_LINEAR,
        )
        value = resized.astype(np.float32) / 255.0
        value = (value - 0.5) / 0.5
        return value.transpose(2, 0, 1)[np.newaxis, :, :, :].astype(np.float32)

    def embed_image(self, image: np.ndarray) -> dict[str, Any]:
        tensor = self._image_tensor(image)
        with self.lock:
            output = self.vision.run(
                ["pooler_output"],
                {"pixel_values": tensor},
            )[0]
        return self._quantize(output)

    def embed_text(self, text: str) -> dict[str, Any]:
        text = text.strip()
        if not text or len(text) > 1024:
            raise RequestError(400, "invalid semantic text")
        encoded = self.tokenizer.encode(text)
        input_ids = np.asarray([encoded.ids], dtype=np.int64)
        with self.lock:
            output = self.text.run(
                ["pooler_output"],
                {"input_ids": input_ids},
            )[0]
        return self._quantize(output)


class AnalyzerState:
    def __init__(
        self,
        runtime: FaceRuntime,
        smart_runtime: SmartRuntime,
        semantic_runtime: SemanticRuntime,
        creative_runtime: CreativeRuntime,
        preview_origin: str,
        token: str,
    ) -> None:
        self.runtime = runtime
        self.smart_runtime = smart_runtime
        self.semantic_runtime = semantic_runtime
        self.creative_runtime = creative_runtime
        self.preview_origin = normalize_origin(preview_origin)
        self.token = token.strip()


class ThreadingUnixHTTPServer(
    socketserver.ThreadingMixIn,
    socketserver.UnixStreamServer,
):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        socket_path: str,
        handler_class: type["AnalyzerHandler"],
        state: AnalyzerState,
    ) -> None:
        self.state = state
        super().__init__(socket_path, handler_class)


class AnalyzerHandler(socketserver.StreamRequestHandler):
    server: ThreadingUnixHTTPServer

    def handle(self) -> None:
        try:
            request_line = self.rfile.readline(8192)
            if not request_line:
                return
            if len(request_line) >= 8192:
                self._write_json(414, {"error": "request line too large"})
                return
            try:
                method, target, version = request_line.decode("ascii").strip().split()
            except ValueError:
                self._write_json(400, {"error": "invalid HTTP request"})
                return
            if version not in ("HTTP/1.0", "HTTP/1.1"):
                self._write_json(505, {"error": "unsupported HTTP version"})
                return

            headers: dict[str, str] = {}
            while True:
                line = self.rfile.readline(8192)
                if not line:
                    raise RequestError(400, "incomplete HTTP headers")
                if len(line) >= 8192:
                    raise RequestError(431, "HTTP header is too large")
                if line in (b"\r\n", b"\n"):
                    break
                decoded = line.decode("iso-8859-1").rstrip("\r\n")
                if ":" not in decoded:
                    raise RequestError(400, "invalid HTTP header")
                key, value = decoded.split(":", 1)
                headers[key.strip().lower()] = value.strip()

            self._authorize(headers)
            if method == "GET" and target == "/v1/info":
                self._require_protocol(
                    headers,
                    "x-xdrive-face-protocol",
                    PROTOCOL_VERSION,
                    "face",
                )
                self._write_json(200, self.server.state.runtime.info())
                return
            if method == "GET" and target == "/v1/smart-info":
                self._require_protocol(
                    headers,
                    "x-xdrive-smart-protocol",
                    SMART_PROTOCOL_VERSION,
                    "smart",
                )
                self._write_json(200, self.server.state.smart_runtime.info())
                return
            if method == "GET" and target == "/v1/semantic-info":
                self._require_protocol(
                    headers,
                    "x-xdrive-semantic-protocol",
                    SEMANTIC_PROTOCOL_VERSION,
                    "semantic",
                )
                self._write_json(200, self.server.state.semantic_runtime.info())
                return
            if method == "GET" and target == "/v1/creative-info":
                self._require_protocol(
                    headers,
                    "x-xdrive-creative-protocol",
                    CREATIVE_PROTOCOL_VERSION,
                    "creative",
                )
                self._write_json(200, self.server.state.creative_runtime.info())
                return
            if method == "POST" and target in (
                "/v1/analyze",
                "/v1/smart-analyze",
                "/v1/semantic-image",
                "/v1/semantic-text",
                "/v1/creative-generate",
            ):
                if target == "/v1/analyze":
                    self._require_protocol(
                        headers,
                        "x-xdrive-face-protocol",
                        PROTOCOL_VERSION,
                        "face",
                    )
                elif target == "/v1/smart-analyze":
                    self._require_protocol(
                        headers,
                        "x-xdrive-smart-protocol",
                        SMART_PROTOCOL_VERSION,
                        "smart",
                    )
                elif target == "/v1/creative-generate":
                    self._require_protocol(
                        headers,
                        "x-xdrive-creative-protocol",
                        CREATIVE_PROTOCOL_VERSION,
                        "creative",
                    )
                else:
                    self._require_protocol(
                        headers,
                        "x-xdrive-semantic-protocol",
                        SEMANTIC_PROTOCOL_VERSION,
                        "semantic",
                    )
                content_type = headers.get("content-type", "").split(";", 1)[0]
                if content_type.strip().lower() != "application/json":
                    raise RequestError(415, "content type must be application/json")
                raw_length = headers.get("content-length")
                if raw_length is None:
                    raise RequestError(411, "content length is required")
                try:
                    length = int(raw_length)
                except ValueError as exc:
                    raise RequestError(400, "invalid content length") from exc
                if length <= 0 or length > MAX_REQUEST_BYTES:
                    raise RequestError(413, "request body is too large")
                payload = self.rfile.read(length)
                if len(payload) != length:
                    raise RequestError(400, "incomplete request body")
                try:
                    task = json.loads(payload)
                except json.JSONDecodeError as exc:
                    raise RequestError(400, "invalid JSON body") from exc
                if not isinstance(task, dict):
                    raise RequestError(400, "analysis task must be an object")
                if target == "/v1/semantic-text":
                    text = task.get("text")
                    if set(task) != {"text"} or not isinstance(text, str):
                        raise RequestError(400, "invalid semantic text request")
                    self._write_json(
                        200,
                        self.server.state.semantic_runtime.embed_text(text),
                    )
                    return
                if target == "/v1/creative-generate":
                    common = {
                        "preview_url",
                        "preview_version",
                        "preview_edge",
                        "input_fingerprint",
                    }
                    if not common.issubset(task):
                        raise RequestError(400, "creative request is missing preview fields")
                    try:
                        if task.get("kind") in {"movie", "collage"}:
                            collection_key = (
                                "movie_frames"
                                if task.get("kind") == "movie"
                                else "collage_images"
                            )
                            raw_images = task.get(collection_key)
                            if not isinstance(raw_images, list):
                                raise ValueError(
                                    f"creative {task.get('kind')} images must be an array"
                                )
                            images = []
                            for raw_image in raw_images:
                                if not isinstance(raw_image, dict) or not common.issubset(raw_image):
                                    raise ValueError(
                                        f"creative {task.get('kind')} image is missing preview fields"
                                    )
                                preview_task = {key: raw_image[key] for key in common}
                                images.append(
                                    fetch_creative_preview(
                                        preview_task,
                                        self.server.state.preview_origin,
                                    )
                                )
                            if task.get("kind") == "movie":
                                data, mime_type, width, height = (
                                    self.server.state.creative_runtime.generate_movie(
                                        images,
                                        task,
                                    )
                                )
                            else:
                                data, mime_type, width, height = (
                                    self.server.state.creative_runtime.generate_collage(
                                        images,
                                        task,
                                    )
                                )
                        else:
                            preview_task = {key: task[key] for key in common}
                            image = fetch_creative_preview(
                                preview_task,
                                self.server.state.preview_origin,
                            )
                            data, mime_type, width, height = (
                                self.server.state.creative_runtime.generate(image, task)
                            )
                    except ValueError as exc:
                        raise RequestError(400, str(exc)) from exc
                    self._write_json(
                        200,
                        {
                            "data": base64.b64encode(data).decode("ascii"),
                            "mime_type": mime_type,
                            "width": width,
                            "height": height,
                        },
                    )
                    return
                image = fetch_preview(task, self.server.state.preview_origin)
                if target == "/v1/analyze":
                    faces = self.server.state.runtime.analyze(image)
                    self._write_json(200, {"faces": faces})
                elif target == "/v1/smart-analyze":
                    self._write_json(
                        200,
                        self.server.state.smart_runtime.analyze(image),
                    )
                else:
                    self._write_json(
                        200,
                        self.server.state.semantic_runtime.embed_image(image),
                    )
                return
            raise RequestError(404, "not found")
        except RequestError as exc:
            self._write_json(exc.status, {"error": exc.message})
        except Exception as exc:
            print(
                f"photo-intelligence request failed: {type(exc).__name__}: {exc}",
                file=sys.stderr,
                flush=True,
            )
            self._write_json(500, {"error": "analysis failed"})

    @staticmethod
    def _require_protocol(
        headers: dict[str, str],
        header: str,
        expected: int,
        label: str,
    ) -> None:
        if headers.get(header) != str(expected):
            raise RequestError(
                400,
                f"{label} analyzer protocol version mismatch",
            )

    def _authorize(self, headers: dict[str, str]) -> None:
        expected = self.server.state.token
        if not expected:
            return
        value = headers.get("authorization", "")
        prefix = "Bearer "
        supplied = value[len(prefix) :] if value.startswith(prefix) else ""
        if not supplied or not hmac.compare_digest(supplied, expected):
            raise RequestError(401, "invalid analyzer token")

    def _write_binary(
        self,
        status: int,
        body: bytes,
        content_type: str,
        headers: dict[str, str] | None = None,
    ) -> None:
        reason = "OK" if status == 200 else "Error"
        response = (
            f"HTTP/1.1 {status} {reason}\r\n"
            f"Content-Type: {content_type}\r\n"
            f"Content-Length: {len(body)}\r\n"
            "Cache-Control: no-store\r\n"
        )
        for key, value in (headers or {}).items():
            response += f"{key}: {value}\r\n"
        response += "Connection: close\r\n\r\n"
        try:
            self.wfile.write(response.encode("ascii"))
            self.wfile.write(body)
            self.wfile.flush()
        except OSError:
            pass

    def _write_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        reason = {
            200: "OK",
            400: "Bad Request",
            401: "Unauthorized",
            404: "Not Found",
            411: "Length Required",
            413: "Payload Too Large",
            414: "URI Too Long",
            415: "Unsupported Media Type",
            431: "Request Header Fields Too Large",
            500: "Internal Server Error",
            502: "Bad Gateway",
            505: "HTTP Version Not Supported",
        }.get(status, "Error")
        response = (
            f"HTTP/1.1 {status} {reason}\r\n"
            "Content-Type: application/json; charset=utf-8\r\n"
            f"Content-Length: {len(body)}\r\n"
            "Cache-Control: no-store\r\n"
            "Connection: close\r\n"
            "\r\n"
        ).encode("ascii")
        try:
            self.wfile.write(response)
            self.wfile.write(body)
            self.wfile.flush()
        except OSError:
            pass


def synthetic_image(width: int = 320, height: int = 240) -> np.ndarray:
    y, x = np.indices((height, width), dtype=np.uint16)
    image = np.empty((height, width, 3), dtype=np.uint8)
    image[..., 0] = ((x * 3 + y) % 251).astype(np.uint8)
    image[..., 1] = ((x + y * 2) % 241).astype(np.uint8)
    image[..., 2] = ((x * 2 + y * 3) % 239).astype(np.uint8)
    return image


def self_test(
    runtime: FaceRuntime,
    smart_runtime: SmartRuntime,
    semantic_runtime: SemanticRuntime,
    creative_runtime: CreativeRuntime,
) -> None:
    image = synthetic_image()
    runtime.detector.setInputSize((image.shape[1], image.shape[0]))
    runtime.detector.detect(image)

    face = np.array(
        [
            55.0,
            35.0,
            180.0,
            190.0,
            100.0,
            95.0,
            190.0,
            95.0,
            145.0,
            135.0,
            105.0,
            180.0,
            185.0,
            180.0,
        ],
        dtype=np.float32,
    )
    vector = runtime._embedding(image, face)
    if vector.size != EMBEDDING_DIMENSIONS or not np.isfinite(vector).all():
        raise RuntimeError("SFace self-test returned invalid embedding")
    norm = float(np.linalg.norm(vector))
    if abs(norm - 1.0) > 1e-4:
        raise RuntimeError(f"SFace self-test embedding norm is {norm}")
    smart_image = np.zeros((240, 320, 3), dtype=np.uint8)
    smart = smart_runtime.analyze(smart_image)
    if not isinstance(smart.get("labels"), list):
        raise RuntimeError("smart-search self-test returned invalid labels")
    if not isinstance(smart.get("ocr_text"), str):
        raise RuntimeError("smart-search self-test returned invalid OCR text")
    ocr_probe = smart_runtime._recognize_text(
        np.zeros((32, 100, 3), dtype=np.uint8),
        smart_runtime._ocr_target_vertices,
    )
    if not isinstance(ocr_probe, str):
        raise RuntimeError("CRNN self-test returned invalid text")
    semantic_image = semantic_runtime.embed_image(
        np.zeros((SEMANTIC_IMAGE_SIZE, SEMANTIC_IMAGE_SIZE, 3), dtype=np.uint8)
    )
    semantic_text = semantic_runtime.embed_text("a photo of a dog")
    if len(base64.b64decode(semantic_image["embedding"])) != SEMANTIC_DIMENSIONS:
        raise RuntimeError("semantic image self-test returned invalid embedding")
    if len(base64.b64decode(semantic_text["embedding"])) != SEMANTIC_DIMENSIONS:
        raise RuntimeError("semantic text self-test returned invalid embedding")
    creative_image = np.zeros((256, 256, 3), dtype=np.uint8)
    cv.rectangle(creative_image, (72, 48), (184, 220), (255, 255, 255), -1)
    cutout_png, _, cutout_width, cutout_height = creative_runtime.generate(
        creative_image,
        {
            "kind": "cutout",
            "cutout_mode": "object",
            "points": [{"x": 0.5, "y": 0.5, "foreground": True}],
        },
    )
    erase_png, _, erase_width, erase_height = creative_runtime.generate(
        creative_image,
        {
            "kind": "erase",
            "strokes": [{
                "radius": 0.03,
                "points": [{"x": 0.5, "y": 0.5}, {"x": 0.55, "y": 0.55}],
            }],
        },
    )
    movie_mp4, movie_mime, movie_width, movie_height = (
        creative_runtime.generate_movie(
            [creative_image, cv.flip(creative_image, 1)],
            {
                "kind": "movie",
                "frame_duration_ms": 1000,
                "transition_ms": 0,
            },
        )
    )
    collage_jpeg, collage_mime, collage_width, collage_height = (
        creative_runtime.generate_collage(
            [creative_image, cv.flip(creative_image, 1)],
            {
                "kind": "collage",
                "collage_template": "grid",
            },
        )
    )
    if (
        not cutout_png.startswith(b"\x89PNG\r\n\x1a\n")
        or cutout_width != 256
        or cutout_height != 256
        or not erase_png.startswith(b"\x89PNG\r\n\x1a\n")
        or erase_width != 256
        or erase_height != 256
        or movie_mime != "video/mp4"
        or b"ftyp" not in movie_mp4[:64]
        or movie_width != 1920
        or movie_height != 1080
        or collage_mime != "image/jpeg"
        or not collage_jpeg.startswith(b"\xff\xd8\xff")
        or collage_width != 2048
        or collage_height != 2048
    ):
        raise RuntimeError("creative self-test returned invalid output")
    print(
        json.dumps(
            {
                "ok": True,
                "opencv": cv.__version__,
                "pipeline_version": PIPELINE_VERSION,
                "smart_pipeline_version": SMART_PIPELINE_VERSION,
                "creative_pipeline_version": creative_runtime.info()["pipeline_version"],
                "semantic_pipeline_version": SEMANTIC_PIPELINE_VERSION,
                "embedding_dimensions": int(vector.size),
                "smart_label_count": len(smart["labels"]),
                "semantic_dimensions": SEMANTIC_DIMENSIONS,
                "creative_pipeline_version": CREATIVE_PIPELINE_VERSION,
                "creative_cutout_bytes": len(cutout_png),
                "creative_erase_bytes": len(erase_png),
                "creative_movie_bytes": len(movie_mp4),
                "creative_collage_bytes": len(collage_jpeg),
            },
            separators=(",", ":"),
        )
    )


def benchmark(
    runtime: FaceRuntime,
    smart_runtime: SmartRuntime,
    iterations: int,
) -> None:
    if iterations <= 0 or iterations > 100:
        raise ValueError("benchmark iterations must be between 1 and 100")
    image = synthetic_image(1280, 720)
    face = np.array(
        [
            320.0,
            120.0,
            420.0,
            480.0,
            430.0,
            285.0,
            625.0,
            285.0,
            530.0,
            380.0,
            455.0,
            505.0,
            605.0,
            505.0,
        ],
        dtype=np.float32,
    )

    smart_image = np.zeros_like(image)
    runtime.detector.setInputSize((image.shape[1], image.shape[0]))
    runtime.detector.detect(image)
    runtime._embedding(image, face)
    smart_runtime.analyze(smart_image)

    detector_times = []
    embedding_times = []
    smart_times = []
    for _ in range(iterations):
        started = time.perf_counter()
        runtime.detector.detect(image)
        detector_times.append((time.perf_counter() - started) * 1000.0)

        started = time.perf_counter()
        runtime._embedding(image, face)
        embedding_times.append((time.perf_counter() - started) * 1000.0)

        started = time.perf_counter()
        smart_runtime.analyze(smart_image)
        smart_times.append((time.perf_counter() - started) * 1000.0)

    print(
        json.dumps(
            {
                "opencv": cv.__version__,
                "pipeline_version": PIPELINE_VERSION,
                "iterations": iterations,
                "detector_ms_avg": sum(detector_times) / len(detector_times),
                "embedding_ms_avg": sum(embedding_times) / len(embedding_times),
                "smart_search_ms_avg": sum(smart_times) / len(smart_times),
                "device": "cpu",
            },
            separators=(",", ":"),
        )
    )


def healthcheck(socket_path: str, token: str) -> None:
    checks = (
        ("/v1/info", "X-XDrive-Face-Protocol", PROTOCOL_VERSION),
        (
            "/v1/smart-info",
            "X-XDrive-Smart-Protocol",
            SMART_PROTOCOL_VERSION,
        ),
        (
            "/v1/semantic-info",
            "X-XDrive-Semantic-Protocol",
            SEMANTIC_PROTOCOL_VERSION,
        ),
        (
            "/v1/creative-info",
            "X-XDrive-Creative-Protocol",
            CREATIVE_PROTOCOL_VERSION,
        ),
    )
    for target, protocol_header, protocol_version in checks:
        connection = UnixHTTPConnection(socket_path, timeout=5)
        headers = {
            "Connection": "close",
            protocol_header: str(protocol_version),
        }
        if token.strip():
            headers["Authorization"] = "Bearer " + token.strip()
        try:
            connection.request("GET", target, headers=headers)
            response = connection.getresponse()
            body = response.read(MAX_REQUEST_BYTES)
            if response.status != 200:
                raise RuntimeError(
                    f"analyzer health status for {target} is {response.status}"
                )
            payload = json.loads(body)
            if payload.get("protocol_version") != protocol_version:
                raise RuntimeError(
                    f"analyzer protocol version mismatch for {target}"
                )
        finally:
            connection.close()


def serve(args: argparse.Namespace) -> None:
    socket_path = args.socket
    preview_origin = args.preview_origin
    if not preview_origin:
        raise RuntimeError("XD_FACE_PREVIEW_ORIGIN is required")
    state = AnalyzerState(
        runtime=FaceRuntime(),
        smart_runtime=SmartRuntime(),
        semantic_runtime=SemanticRuntime(),
        creative_runtime=CreativeRuntime(),
        preview_origin=preview_origin,
        token=args.token,
    )

    path = Path(socket_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        mode = path.stat().st_mode
        if not stat.S_ISSOCK(mode):
            raise RuntimeError(f"refusing to replace non-socket path: {path}")
        path.unlink()

    server = ThreadingUnixHTTPServer(socket_path, AnalyzerHandler, state)
    os.chmod(socket_path, 0o660)

    def request_shutdown(signum: int, frame: Any) -> None:
        del signum, frame
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, request_shutdown)
    signal.signal(signal.SIGINT, request_shutdown)
    print(
        json.dumps(
            {
                "event": "photo_face_analyzer_started",
                "socket": socket_path,
                "preview_origin": state.preview_origin,
                "pipeline_version": PIPELINE_VERSION,
                "smart_pipeline_version": SMART_PIPELINE_VERSION,
            },
            separators=(",", ":"),
        ),
        flush=True,
    )
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()
        try:
            if path.exists() and stat.S_ISSOCK(path.stat().st_mode):
                path.unlink()
        except FileNotFoundError:
            pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="xDrive Photo Intelligence face analyzer")
    parser.add_argument(
        "--socket",
        default=os.environ.get(
            "XD_FACE_SOCKET",
            "/run/xdrive-photo-face/photo-face.sock",
        ),
    )
    parser.add_argument(
        "--preview-origin",
        default=os.environ.get("XD_FACE_PREVIEW_ORIGIN", ""),
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("XD_FACE_ANALYZER_TOKEN", ""),
    )
    parser.add_argument("--healthcheck", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--benchmark", action="store_true")
    parser.add_argument("--iterations", type=int, default=3)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.healthcheck:
        healthcheck(args.socket, args.token)
        return 0

    if args.self_test:
        self_test(
            FaceRuntime(),
            SmartRuntime(),
            SemanticRuntime(),
            CreativeRuntime(),
        )
        return 0
    if args.benchmark:
        benchmark(FaceRuntime(), SmartRuntime(), args.iterations)
        return 0

    serve(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
