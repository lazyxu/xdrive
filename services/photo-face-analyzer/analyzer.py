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

EMBEDDING_FORMAT = "f32le"
EMBEDDING_DIMENSIONS = 128

CONFIDENCE_THRESHOLD = 0.9
NMS_THRESHOLD = 0.3
TOP_K = 5000
MAX_FACES = 256
MAX_REQUEST_BYTES = 64 * 1024
MAX_PREVIEW_BYTES = 32 * 1024 * 1024
PREVIEW_PATH_RE = re.compile(r"^/api/v1/media-analysis-preview/[1-9][0-9]*$")

PIPELINE_VERSION = (
    f"opencv-{cv.__version__}-cpu-yunet2023mar"
    f"-conf{CONFIDENCE_THRESHOLD:g}-nms{NMS_THRESHOLD:g}-topk{TOP_K}"
    "-sface2021dec-aligncrop-l2-clip-v1"
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
        raise RequestError(400, "invalid face analysis task fields")

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


class AnalyzerState:
    def __init__(
        self,
        runtime: FaceRuntime,
        preview_origin: str,
        token: str,
    ) -> None:
        self.runtime = runtime
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
            if headers.get("x-xdrive-face-protocol") != str(PROTOCOL_VERSION):
                raise RequestError(400, "face analyzer protocol version mismatch")
            if method == "GET" and target == "/v1/info":
                self._write_json(200, self.server.state.runtime.info())
                return
            if method == "POST" and target == "/v1/analyze":
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
                    raise RequestError(400, "face analysis task must be an object")
                image = fetch_preview(task, self.server.state.preview_origin)
                faces = self.server.state.runtime.analyze(image)
                self._write_json(200, {"faces": faces})
                return
            raise RequestError(404, "not found")
        except RequestError as exc:
            self._write_json(exc.status, {"error": exc.message})
        except Exception as exc:
            print(
                f"photo-face request failed: {type(exc).__name__}: {exc}",
                file=sys.stderr,
                flush=True,
            )
            self._write_json(500, {"error": "face analysis failed"})

    def _authorize(self, headers: dict[str, str]) -> None:
        expected = self.server.state.token
        if not expected:
            return
        value = headers.get("authorization", "")
        prefix = "Bearer "
        supplied = value[len(prefix) :] if value.startswith(prefix) else ""
        if not supplied or not hmac.compare_digest(supplied, expected):
            raise RequestError(401, "invalid analyzer token")

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


def self_test(runtime: FaceRuntime) -> None:
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
    print(
        json.dumps(
            {
                "ok": True,
                "opencv": cv.__version__,
                "pipeline_version": PIPELINE_VERSION,
                "embedding_dimensions": int(vector.size),
            },
            separators=(",", ":"),
        )
    )


def benchmark(runtime: FaceRuntime, iterations: int) -> None:
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

    runtime.detector.setInputSize((image.shape[1], image.shape[0]))
    runtime.detector.detect(image)
    runtime._embedding(image, face)

    detector_times = []
    embedding_times = []
    for _ in range(iterations):
        started = time.perf_counter()
        runtime.detector.detect(image)
        detector_times.append((time.perf_counter() - started) * 1000.0)

        started = time.perf_counter()
        runtime._embedding(image, face)
        embedding_times.append((time.perf_counter() - started) * 1000.0)

    print(
        json.dumps(
            {
                "opencv": cv.__version__,
                "pipeline_version": PIPELINE_VERSION,
                "iterations": iterations,
                "detector_ms_avg": sum(detector_times) / len(detector_times),
                "embedding_ms_avg": sum(embedding_times) / len(embedding_times),
                "device": "cpu",
            },
            separators=(",", ":"),
        )
    )


def healthcheck(socket_path: str, token: str) -> None:
    connection = UnixHTTPConnection(socket_path, timeout=5)
    headers = {
        "Connection": "close",
        "X-XDrive-Face-Protocol": str(PROTOCOL_VERSION),
    }
    if token.strip():
        headers["Authorization"] = "Bearer " + token.strip()
    try:
        connection.request("GET", "/v1/info", headers=headers)
        response = connection.getresponse()
        body = response.read(MAX_REQUEST_BYTES)
        if response.status != 200:
            raise RuntimeError(f"analyzer health status is {response.status}")
        payload = json.loads(body)
        if payload.get("protocol_version") != PROTOCOL_VERSION:
            raise RuntimeError("analyzer protocol version mismatch")
    finally:
        connection.close()


def serve(args: argparse.Namespace) -> None:
    socket_path = args.socket
    preview_origin = args.preview_origin
    if not preview_origin:
        raise RuntimeError("XD_FACE_PREVIEW_ORIGIN is required")
    state = AnalyzerState(
        runtime=FaceRuntime(),
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
        self_test(FaceRuntime())
        return 0
    if args.benchmark:
        benchmark(FaceRuntime(), args.iterations)
        return 0

    serve(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
