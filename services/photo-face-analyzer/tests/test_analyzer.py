from __future__ import annotations

import base64
import hashlib
import http.client
import io
import json
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
import wave

import cv2 as cv
import numpy as np

import analyzer


class PreviewHandler(BaseHTTPRequestHandler):
    image_bytes = b""
    fingerprint = ""
    music_bytes = b""
    music_fingerprint = ""
    redirect = False

    def do_GET(self) -> None:
        if self.redirect:
            self.send_response(302)
            self.send_header("Location", "/redirected")
            self.end_headers()
            return
        analysis = self.path.startswith("/api/v1/media-analysis-preview/42?ticket=")
        creative = self.path.startswith("/api/v1/media-creative-preview/42?ticket=")
        music = self.path.startswith("/api/v1/file-preview/99?ticket=")
        if not analysis and not creative and not music:
            self.send_error(404)
            return
        self.send_response(200)
        if music:
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(self.music_bytes)))
            self.send_header(
                "ETag",
                '"file-preview-' + self.music_fingerprint + '"',
            )
            self.end_headers()
            self.wfile.write(self.music_bytes)
            return
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(self.image_bytes)))
        self.send_header("ETag", '"' + self.fingerprint + '"')
        if creative:
            self.send_header("X-XDrive-Creative-Preview-Version", "1")
            self.send_header("X-XDrive-Creative-Preview-Edge", "2048")
        else:
            self.send_header("X-XDrive-Analysis-Preview-Version", "1")
            self.send_header("X-XDrive-Analysis-Preview-Edge", "1280")
        self.end_headers()
        self.wfile.write(self.image_bytes)

    def log_message(self, format: str, *args: object) -> None:
        del format, args


class AnalyzerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.runtime = analyzer.FaceRuntime()
        cls.smart_runtime = analyzer.SmartRuntime()
        cls.semantic_runtime = analyzer.SemanticRuntime()
        cls.creative_runtime = analyzer.CreativeRuntime()
        blank = np.zeros((240, 320, 3), dtype=np.uint8)
        ok, encoded = cv.imencode(".jpg", blank)
        if not ok:
            raise RuntimeError("failed to encode test JPEG")
        PreviewHandler.image_bytes = encoded.tobytes()
        music_buffer = io.BytesIO()
        with wave.open(music_buffer, "wb") as stream:
            stream.setnchannels(1)
            stream.setsampwidth(2)
            stream.setframerate(8000)
            stream.writeframes(b"\x00\x00" * 8000)
        cls.music_bytes = music_buffer.getvalue()
        PreviewHandler.music_bytes = cls.music_bytes
        PreviewHandler.music_fingerprint = hashlib.sha256(cls.music_bytes).hexdigest()
        cls.preview_server = ThreadingHTTPServer(
            ("127.0.0.1", 0),
            PreviewHandler,
        )
        cls.preview_thread = threading.Thread(
            target=cls.preview_server.serve_forever,
            daemon=True,
        )
        cls.preview_thread.start()
        cls.preview_origin = (
            f"http://127.0.0.1:{cls.preview_server.server_port}"
        )

    @classmethod
    def tearDownClass(cls) -> None:
        cls.preview_server.shutdown()
        cls.preview_server.server_close()
        cls.preview_thread.join(timeout=5)

    def test_healthcheck_instance_digest_is_bounded_and_nonreversible(self) -> None:
        session_id = "0123456789abcdef0123456789abcdef"
        digest = analyzer.healthcheck_session_digest(session_id)
        self.assertEqual(
            digest, hashlib.sha256(session_id.encode("ascii")).hexdigest()
        )
        self.assertRegex(digest, r"^[0-9a-f]{64}$")
        self.assertNotEqual(digest, session_id)
        for invalid in ("", "abc", "A" * 32, "a" * 33, "g" * 32):
            with self.assertRaises(ValueError):
                analyzer.healthcheck_session_digest(invalid)

    def test_process_boot_session_identity_changes_and_is_shared(self) -> None:
        first = analyzer.AnalyzerState(
            self.runtime, self.smart_runtime, self.semantic_runtime,
            self.creative_runtime, self.preview_origin, "secret",
        )
        second = analyzer.AnalyzerState(
            self.runtime, self.smart_runtime, self.semantic_runtime,
            self.creative_runtime, self.preview_origin, "secret",
        )
        self.assertRegex(first.runtime_instance_id, r"^[0-9a-f]{32}$")
        self.assertNotEqual(first.runtime_instance_id, second.runtime_instance_id)
        self.assertEqual(
            first.info_with_session(self.runtime.info())["runtime_instance_id"],
            first.info_with_session(self.semantic_runtime.info())["runtime_instance_id"],
        )
        self.assertNotIn("runtime_instance_id", self.runtime.info())

    def test_host_only_apply_ack_is_process_bound_and_not_a_task_effect(self) -> None:
        host_token = "a" * 64
        request_id = "0123456789abcdef01234567"
        second_id = "fedcba987654321001234567"
        state = analyzer.AnalyzerState(
            self.runtime, self.smart_runtime, self.semantic_runtime,
            self.creative_runtime, self.preview_origin, "ordinary-token",
            host_apply_token=host_token,
        )
        digest = analyzer.healthcheck_session_digest(state.runtime_instance_id)

        def host_ack_exchange(
            socket_path: str, supplied: str | None, payload_bytes: bytes,
            protocol: str = "1",
        ) -> tuple[int, dict]:
            # Send headers and the short body as ONE Unix-stream write.
            # Unauthorized/invalid-protocol peers correctly reject after
            # headers, so a split http.client write can race with the server's
            # early close and raise BrokenPipeError before reading HTTP 401.
            # Do not move production authentication behind body reads.
            lines = [
                "POST /v1/host-apply-ack HTTP/1.1",
                "Host: localhost",
                "Connection: close",
                "Content-Type: application/json",
                "Content-Length: " + str(len(payload_bytes)),
                "X-XDrive-Host-Apply-Protocol: " + protocol,
            ]
            if supplied is not None:
                lines.append("Authorization: Bearer " + supplied)
            raw_request = ("\r\n".join(lines) + "\r\n\r\n").encode("ascii") + payload_bytes
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(3)
                client.connect(socket_path)
                client.sendall(raw_request)
                response = http.client.HTTPResponse(client)
                response.begin()
                return response.status, json.loads(response.read())

        with tempfile.TemporaryDirectory() as tmp:
            socket_path = str(Path(tmp) / "host-apply.sock")
            server = analyzer.ThreadingUnixHTTPServer(
                socket_path, analyzer.AnalyzerHandler, state
            )
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()

            def invoke(token: str | None, payload: dict | None = None,
                       protocol: str = "1") -> tuple[int, dict]:
                encoded = json.dumps(payload).encode("utf-8") if payload is not None else b""
                return host_ack_exchange(socket_path, token, encoded, protocol)

            def info(path: str, protocol: str) -> dict:
                connection = analyzer.UnixHTTPConnection(socket_path)
                try:
                    connection.request("GET", path, headers={
                        "Authorization": "Bearer ordinary-token",
                        protocol: "1",
                    })
                    response = connection.getresponse()
                    self.assertEqual(response.status, 200)
                    return json.loads(response.read())
                finally:
                    connection.close()

            receipt = {
                "request_id": request_id,
                "revision": 2,
                "runtime_instance_sha256": digest,
            }
            try:
                self.assertNotIn(
                    "host_apply_receipt", info("/v1/info", "X-XDrive-Face-Protocol")
                )
                for wrong_token in (None, "ordinary-token", "b" * 64):
                    status, payload = invoke(wrong_token, receipt)
                    self.assertEqual(status, 401)
                    self.assertNotIn(host_token, str(payload))
                status, _ = invoke(host_token, {
                    **receipt, "runtime_instance_sha256": "0" * 64
                })
                self.assertEqual(status, 409)
                status, _ = invoke(host_token, {**receipt, "revision": True})
                self.assertEqual(status, 400)
                status, _ = invoke(host_token, {**receipt, "extra": True})
                self.assertEqual(status, 400)
                status, _ = invoke(host_token, {**receipt, "padding": "x" * 300})
                self.assertEqual(status, 413)
                duplicate_json = (
                    '{"request_id":"' + request_id + '","request_id":"' + request_id
                    + '","revision":2,"runtime_instance_sha256":"' + digest + '"}'
                ).encode("utf-8")
                duplicate_status, _ = host_ack_exchange(
                    socket_path, host_token, duplicate_json
                )
                self.assertEqual(duplicate_status, 400)
                status, _ = invoke(host_token, receipt, protocol="2")
                self.assertEqual(status, 400)
                self.assertNotIn(
                    "host_apply_receipt", info("/v1/info", "X-XDrive-Face-Protocol")
                )
                status, payload = invoke(host_token, receipt)
                self.assertEqual(status, 200)
                self.assertTrue(payload["acknowledged"])
                self.assertEqual(payload["runtime_instance_sha256"], digest)
                self.assertNotIn("runtime_instance_id", payload)
                self.assertNotIn(host_token, str(payload))
                for route, protocol in (
                    ("/v1/info", "X-XDrive-Face-Protocol"),
                    ("/v1/smart-info", "X-XDrive-Smart-Protocol"),
                    ("/v1/semantic-info", "X-XDrive-Semantic-Protocol"),
                    ("/v1/creative-info", "X-XDrive-Creative-Protocol"),
                ):
                    model_info = info(route, protocol)
                    self.assertEqual(
                        model_info["host_apply_receipt"],
                        {"revision": 2, "request_id": request_id},
                    )
                self.assertEqual(invoke(host_token, receipt)[0], 200)
                self.assertEqual(invoke(
                    host_token, {**receipt, "request_id": second_id}
                )[0], 409)
                self.assertEqual(invoke(
                    host_token, {**receipt, "revision": 1}
                )[0], 409)
                self.assertEqual(
                    info("/v1/info", "X-XDrive-Face-Protocol")["host_apply_receipt"],
                    {"revision": 2, "request_id": request_id},
                )
                self.assertEqual(invoke(
                    host_token, {**receipt, "request_id": second_id, "revision": 3}
                )[0], 200)
            finally:
                server.shutdown()
                server.server_close()
                worker.join(timeout=5)

        restarted = analyzer.AnalyzerState(
            self.runtime, self.smart_runtime, self.semantic_runtime,
            self.creative_runtime, self.preview_origin, "ordinary-token",
            host_apply_token=host_token,
        )
        self.assertNotEqual(state.runtime_instance_id, restarted.runtime_instance_id)
        self.assertNotIn("host_apply_receipt", restarted.info_with_session(
            self.runtime.info()
        ))
        default_state = analyzer.AnalyzerState(
            self.runtime, self.smart_runtime, self.semantic_runtime,
            self.creative_runtime, self.preview_origin, "ordinary-token",
        )
        self.assertFalse(default_state.host_apply_token)
        with tempfile.TemporaryDirectory() as disabled_tmp:
            socket_path = str(Path(disabled_tmp) / "host-apply-disabled.sock")
            server = analyzer.ThreadingUnixHTTPServer(
                socket_path, analyzer.AnalyzerHandler, default_state
            )
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                disabled_status, _ = host_ack_exchange(
                    socket_path, host_token, json.dumps(receipt).encode("utf-8")
                )
                self.assertEqual(disabled_status, 404)
            finally:
                server.shutdown()
                server.server_close()
                worker.join(timeout=5)
        for wrong in ("x", "A" * 64, "0" * 63, "a" * 64 + " "):
            with self.assertRaises(ValueError):
                analyzer.AnalyzerState(
                    self.runtime, self.smart_runtime, self.semantic_runtime,
                    self.creative_runtime, self.preview_origin,
                    "ordinary-token", host_apply_token=wrong,
                )

    def test_model_manifest_and_dimensions(self) -> None:
        info = self.runtime.info()
        self.assertEqual(info["protocol_version"], 1)
        self.assertEqual(info["embedding_dimensions"], 128)
        self.assertEqual(info["embedding_format"], "f32le")
        self.assertEqual(info["runtime"]["framework"], "opencv_dnn")
        self.assertEqual(info["runtime"]["version"], cv.__version__)
        self.assertEqual(info["runtime"]["device"], "cpu")
        self.assertEqual(
            info["detector"]["sha256"],
            analyzer.YUNET_SHA256,
        )
        self.assertEqual(
            info["embedding"]["sha256"],
            analyzer.SFACE_SHA256,
        )
        self.assertIn("aligncrop-l2", info["pipeline_version"])

        smart = self.smart_runtime.info()
        self.assertEqual(smart["protocol_version"], 1)
        self.assertEqual(smart["ocr_language"], "zh-en")
        self.assertEqual(
            smart["classifier"]["sha256"],
            analyzer.MOBILENET_SHA256,
        )
        self.assertEqual(
            smart["text_detector"]["sha256"],
            analyzer.PPOCR_SHA256,
        )
        self.assertEqual(
            smart["text_recognizer"]["sha256"],
            analyzer.CRNN_SHA256,
        )

        creative = self.creative_runtime.info()
        self.assertEqual(creative["protocol_version"], 1)
        self.assertEqual(
            creative["capabilities"],
            [
                "cutout",
                "cutout_refine",
                "erase",
                "movie",
                "movie_templates",
                "movie_music",
                "collage",
            ],
        )
        self.assertIn("ffmpeg", creative["pipeline_version"])
        self.assertEqual(len(creative["segment_model"]["sha256"]), 64)

        semantic = self.semantic_runtime.info()
        self.assertEqual(semantic["protocol_version"], 1)
        self.assertEqual(
            semantic["embedding_dimensions"],
            analyzer.SEMANTIC_DIMENSIONS,
        )
        self.assertEqual(semantic["embedding_format"], "i8norm-v1")
        self.assertEqual(
            semantic["vision_model"]["sha256"],
            analyzer.SEMANTIC_VISION_SHA256,
        )
        self.assertEqual(
            semantic["text_model"]["sha256"],
            analyzer.SEMANTIC_TEXT_SHA256,
        )
        self.assertEqual(
            semantic["tokenizer_sha256"],
            analyzer.SEMANTIC_TOKENIZER_SHA256,
        )
        self.assertEqual(semantic["runtime"]["framework"], "onnxruntime")
        self.assertEqual(semantic["runtime"]["device"], "cpu")

    def test_task_requires_exact_preview_origin_and_path(self) -> None:
        task = {
            "preview_url": (
                self.preview_origin
                + "/api/v1/media-analysis-preview/42?ticket=abc"
            ),
            "preview_version": 1,
            "preview_edge": 1280,
            "input_fingerprint": "media-analysis-test-v1-1280",
        }
        validated = analyzer.validate_task(task, self.preview_origin)
        self.assertEqual(validated["preview_edge"], 1280)

        wrong_origin = dict(task)
        wrong_origin["preview_url"] = (
            "http://example.invalid/api/v1/media-analysis-preview/42?ticket=abc"
        )
        with self.assertRaises(analyzer.RequestError):
            analyzer.validate_task(wrong_origin, self.preview_origin)

        wrong_path = dict(task)
        wrong_path["preview_url"] = self.preview_origin + "/api/v1/media/items/42"
        with self.assertRaises(analyzer.RequestError):
            analyzer.validate_task(wrong_path, self.preview_origin)

        extra_query = dict(task)
        extra_query["preview_url"] = (
            self.preview_origin
            + "/api/v1/media-analysis-preview/42?ticket=abc&other=value"
        )
        with self.assertRaises(analyzer.RequestError):
            analyzer.validate_task(extra_query, self.preview_origin)

    def test_preview_fetch_requires_contract_headers_and_no_redirect(self) -> None:
        fingerprint = "media-analysis-test-v1-1280"
        PreviewHandler.fingerprint = fingerprint
        PreviewHandler.redirect = False
        task = {
            "preview_url": (
                self.preview_origin
                + "/api/v1/media-analysis-preview/42?ticket=abc"
            ),
            "preview_version": 1,
            "preview_edge": 1280,
            "input_fingerprint": fingerprint,
        }
        image = analyzer.fetch_preview(task, self.preview_origin)
        self.assertEqual(image.shape[:2], (240, 320))

        mismatch = dict(task)
        mismatch["input_fingerprint"] = "different-fingerprint"
        with self.assertRaises(analyzer.RequestError):
            analyzer.fetch_preview(mismatch, self.preview_origin)

        PreviewHandler.redirect = True
        try:
            with self.assertRaises(analyzer.RequestError):
                analyzer.fetch_preview(task, self.preview_origin)
        finally:
            PreviewHandler.redirect = False

    def test_unix_socket_protocol_end_to_end(self) -> None:
        fingerprint = "media-analysis-test-v1-1280"
        PreviewHandler.fingerprint = fingerprint
        task = {
            "preview_url": (
                self.preview_origin
                + "/api/v1/media-analysis-preview/42?ticket=abc"
            ),
            "preview_version": 1,
            "preview_edge": 1280,
            "input_fingerprint": fingerprint,
        }

        with tempfile.TemporaryDirectory() as tmp:
            socket_path = str(Path(tmp) / "photo-face.sock")
            state = analyzer.AnalyzerState(
                self.runtime,
                self.smart_runtime,
                self.semantic_runtime,
                self.creative_runtime,
                self.preview_origin,
                "secret",
            )
            server = analyzer.ThreadingUnixHTTPServer(
                socket_path,
                analyzer.AnalyzerHandler,
                state,
            )
            thread = threading.Thread(
                target=server.serve_forever,
                daemon=True,
            )
            thread.start()
            try:
                # Real healthcheck verifies all four fixed Info endpoints
                # respond from the same process-boot session.
                analyzer.healthcheck(socket_path, "secret")
                unauthorized = analyzer.UnixHTTPConnection(socket_path)
                unauthorized.request("GET", "/v1/info")
                response = unauthorized.getresponse()
                response.read()
                self.assertEqual(response.status, 401)
                unauthorized.close()

                connection = analyzer.UnixHTTPConnection(socket_path)
                connection.request(
                    "GET",
                    "/v1/info",
                    headers={
                        "Authorization": "Bearer secret",
                        "X-XDrive-Face-Protocol": "1",
                    },
                )
                response = connection.getresponse()
                info = json.loads(response.read())
                self.assertEqual(response.status, 200)
                self.assertEqual(info["embedding_dimensions"], 128)
                self.assertEqual(info["runtime"]["device"], "cpu")
                self.assertEqual(info["runtime_instance_id"], state.runtime_instance_id)
                connection.close()

                payload = json.dumps(task).encode("utf-8")
                connection = analyzer.UnixHTTPConnection(socket_path)
                connection.request(
                    "POST",
                    "/v1/analyze",
                    body=payload,
                    headers={
                        "Authorization": "Bearer secret",
                        "Content-Type": "application/json",
                        "Content-Length": str(len(payload)),
                        "X-XDrive-Face-Protocol": "1",
                    },
                )
                response = connection.getresponse()
                result = json.loads(response.read())
                self.assertEqual(response.status, 200)
                self.assertIsInstance(result["faces"], list)
                self.assertLessEqual(len(result["faces"]), analyzer.MAX_FACES)
                connection.close()

                # Fixed YuNet detector executes on synthetic non-person
                # pixels without receiving user previews or media bytes.
                for path, protocol, body, expected in (
                    ("/v1/face-detector-canary", "0", None, 400),
                    ("/v1/face-detector-canary?preview_url=private", "1", None, 404),
                    ("/v1/face-detector-canary", "1", b"{}", 400),
                ):
                    check = analyzer.UnixHTTPConnection(socket_path)
                    check.request(
                        "GET", path, body=body,
                        headers={
                            "Authorization": "Bearer secret",
                            "X-XDrive-Face-Protocol": protocol,
                        },
                    )
                    response = check.getresponse()
                    response.read()
                    self.assertEqual(response.status, expected)
                    check.close()

                unauth_face = analyzer.UnixHTTPConnection(socket_path)
                unauth_face.request(
                    "GET", "/v1/face-detector-canary",
                    headers={"X-XDrive-Face-Protocol": "1"},
                )
                response = unauth_face.getresponse()
                response.read()
                self.assertEqual(response.status, 401)
                unauth_face.close()

                fixed_face = analyzer.UnixHTTPConnection(socket_path)
                fixed_face.request(
                    "GET", "/v1/face-detector-canary",
                    headers={
                        "Authorization": "Bearer secret",
                        "X-XDrive-Face-Protocol": "1",
                    },
                )
                response = fixed_face.getresponse()
                canary = json.loads(response.read())
                self.assertEqual(response.status, 200)
                self.assertIs(canary["detector_executed"], True)
                self.assertIsInstance(canary["face_count"], int)
                self.assertGreaterEqual(canary["face_count"], 0)
                self.assertLessEqual(canary["face_count"], analyzer.MAX_FACES)
                self.assertEqual(
                    set(canary), {"detector_executed", "face_count"}
                )
                fixed_face.close()

                connection = analyzer.UnixHTTPConnection(socket_path)
                connection.request(
                    "GET",
                    "/v1/smart-info",
                    headers={
                        "Authorization": "Bearer secret",
                        "X-XDrive-Smart-Protocol": "1",
                    },
                )
                response = connection.getresponse()
                smart_info = json.loads(response.read())
                self.assertEqual(response.status, 200)
                self.assertEqual(smart_info["ocr_language"], "zh-en")
                self.assertEqual(smart_info["runtime_instance_id"], state.runtime_instance_id)
                connection.close()

                connection = analyzer.UnixHTTPConnection(socket_path)
                connection.request(
                    "POST",
                    "/v1/smart-analyze",
                    body=payload,
                    headers={
                        "Authorization": "Bearer secret",
                        "Content-Type": "application/json",
                        "Content-Length": str(len(payload)),
                        "X-XDrive-Smart-Protocol": "1",
                    },
                )
                response = connection.getresponse()
                smart_result = json.loads(response.read())
                self.assertEqual(response.status, 200)
                self.assertIsInstance(smart_result["labels"], list)
                self.assertIsInstance(smart_result["ocr_text"], str)
                self.assertEqual(smart_result["ocr_language"], "zh-en")
                connection.close()

                connection = analyzer.UnixHTTPConnection(socket_path)
                connection.request(
                    "GET",
                    "/v1/semantic-info",
                    headers={
                        "Authorization": "Bearer secret",
                        "X-XDrive-Semantic-Protocol": "1",
                    },
                )
                response = connection.getresponse()
                semantic_info = json.loads(response.read())
                self.assertEqual(response.status, 200)
                self.assertEqual(
                    semantic_info["embedding_dimensions"],
                    analyzer.SEMANTIC_DIMENSIONS,
                )
                self.assertEqual(semantic_info["runtime_instance_id"], state.runtime_instance_id)
                connection.close()

                connection = analyzer.UnixHTTPConnection(socket_path)
                connection.request(
                    "POST",
                    "/v1/semantic-image",
                    body=payload,
                    headers={
                        "Authorization": "Bearer secret",
                        "Content-Type": "application/json",
                        "Content-Length": str(len(payload)),
                        "X-XDrive-Semantic-Protocol": "1",
                    },
                )
                response = connection.getresponse()
                semantic_image = json.loads(response.read())
                self.assertEqual(response.status, 200)
                self.assertEqual(
                    semantic_image["dimensions"],
                    analyzer.SEMANTIC_DIMENSIONS,
                )
                self.assertEqual(semantic_image["format"], "i8norm-v1")
                connection.close()

                # No user preview, task body or privileged model metadata.
                unauth = analyzer.UnixHTTPConnection(socket_path)
                unauth.request(
                    "GET", "/v1/semantic-image-canary",
                    headers={"X-XDrive-Semantic-Protocol": "1"},
                )
                response = unauth.getresponse()
                response.read()
                self.assertEqual(response.status, 401)
                unauth.close()

                wrong_version = analyzer.UnixHTTPConnection(socket_path)
                wrong_version.request(
                    "GET", "/v1/semantic-image-canary",
                    headers={
                        "Authorization": "Bearer secret",
                        "X-XDrive-Semantic-Protocol": "0",
                    },
                )
                response = wrong_version.getresponse()
                response.read()
                self.assertEqual(response.status, 400)
                wrong_version.close()

                query = analyzer.UnixHTTPConnection(socket_path)
                query.request(
                    "GET", "/v1/semantic-image-canary?preview_url=private",
                    headers={
                        "Authorization": "Bearer secret",
                        "X-XDrive-Semantic-Protocol": "1",
                    },
                )
                response = query.getresponse()
                response.read()
                self.assertEqual(response.status, 404)
                query.close()

                probe = analyzer.UnixHTTPConnection(socket_path)
                probe.request(
                    "GET", "/v1/semantic-image-canary",
                    headers={
                        "Authorization": "Bearer secret",
                        "X-XDrive-Semantic-Protocol": "1",
                    },
                )
                response = probe.getresponse()
                canary = json.loads(response.read())
                self.assertEqual(response.status, 200)
                self.assertEqual(canary["format"], "i8norm-v1")
                self.assertEqual(canary["dimensions"], analyzer.SEMANTIC_DIMENSIONS)
                vector_bytes = base64.b64decode(canary["embedding"])
                self.assertEqual(len(vector_bytes), analyzer.SEMANTIC_DIMENSIONS)
                self.assertTrue(any(vector_bytes))
                probe.close()

                text_payload = json.dumps(
                    {"text": "海边的狗"},
                    ensure_ascii=False,
                ).encode("utf-8")
                connection = analyzer.UnixHTTPConnection(socket_path)
                connection.request(
                    "POST",
                    "/v1/semantic-text",
                    body=text_payload,
                    headers={
                        "Authorization": "Bearer secret",
                        "Content-Type": "application/json",
                        "Content-Length": str(len(text_payload)),
                        "X-XDrive-Semantic-Protocol": "1",
                    },
                )
                response = connection.getresponse()
                semantic_text = json.loads(response.read())
                self.assertEqual(response.status, 200)
                self.assertEqual(
                    semantic_text["dimensions"],
                    analyzer.SEMANTIC_DIMENSIONS,
                )
                self.assertEqual(semantic_text["format"], "i8norm-v1")
                connection.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)


    def test_creative_music_fetch_requires_exact_contract(self) -> None:
        PreviewHandler.redirect = False
        PreviewHandler.music_fingerprint = hashlib.sha256(self.music_bytes).hexdigest()
        task = {
            "music_url": (
                self.preview_origin
                + "/api/v1/file-preview/99?ticket=music"
            ),
            "music_fingerprint": PreviewHandler.music_fingerprint,
        }
        self.assertEqual(
            analyzer.fetch_creative_music(task, self.preview_origin),
            self.music_bytes,
        )

        wrong_path = dict(task)
        wrong_path["music_url"] = (
            self.preview_origin
            + "/api/v1/media-creative-preview/42?ticket=music"
        )
        with self.assertRaises(analyzer.RequestError):
            analyzer.fetch_creative_music(wrong_path, self.preview_origin)

        wrong_fingerprint = dict(task)
        wrong_fingerprint["music_fingerprint"] = "c" * 64
        with self.assertRaises(analyzer.RequestError):
            analyzer.fetch_creative_music(
                wrong_fingerprint,
                self.preview_origin,
            )

        PreviewHandler.music_fingerprint = "c" * 64
        forged_header = dict(task)
        forged_header["music_fingerprint"] = "c" * 64
        with self.assertRaises(analyzer.RequestError):
            analyzer.fetch_creative_music(
                forged_header,
                self.preview_origin,
            )
        PreviewHandler.music_fingerprint = hashlib.sha256(self.music_bytes).hexdigest()


    def test_creative_runtime_cutout_and_erase(self) -> None:
        image = np.zeros((256, 256, 3), dtype=np.uint8)
        cv.rectangle(image, (70, 45), (185, 220), (255, 255, 255), -1)

        cutout, mime, width, height = self.creative_runtime.generate(
            image,
            {
                "kind": "cutout",
                "cutout_mode": "object",
                "cutout_expand": 0.01,
                "cutout_feather": 0.005,
                "points": [{"x": 0.5, "y": 0.5, "foreground": True}],
            },
        )
        self.assertEqual(mime, "image/png")
        self.assertEqual((width, height), (256, 256))
        self.assertTrue(cutout.startswith(b"\x89PNG\r\n\x1a\n"))

        mask = np.zeros((100, 100), dtype=np.uint8)
        mask[35:65, 35:65] = 255
        expanded = self.creative_runtime._refine_cutout_mask(mask, 0.02, 0.0)
        contracted = self.creative_runtime._refine_cutout_mask(mask, -0.02, 0.0)
        feathered = self.creative_runtime._refine_cutout_mask(mask, 0.0, 0.02)
        self.assertGreater(np.count_nonzero(expanded), np.count_nonzero(mask))
        self.assertLess(np.count_nonzero(contracted), np.count_nonzero(mask))
        self.assertTrue(np.any((feathered > 0) & (feathered < 255)))
        with self.assertRaises(ValueError):
            self.creative_runtime._refine_cutout_mask(mask, 0.031, 0.0)
        with self.assertRaises(ValueError):
            self.creative_runtime._refine_cutout_mask(mask, 0.0, 0.031)

        erase, mime, width, height = self.creative_runtime.generate(
            image,
            {
                "kind": "erase",
                "strokes": [{
                    "radius": 0.03,
                    "points": [{"x": 0.5, "y": 0.5}, {"x": 0.55, "y": 0.55}],
                }],
            },
        )
        self.assertEqual(mime, "image/png")
        self.assertEqual((width, height), (256, 256))
        self.assertTrue(erase.startswith(b"\x89PNG\r\n\x1a\n"))

        movie_images = [image, cv.flip(image, 1)]
        movie, mime, width, height = self.creative_runtime.generate_movie(
            movie_images,
            {
                "kind": "movie",
                "frame_duration_ms": 1000,
                "transition_ms": 0,
            },
        )
        self.assertEqual(mime, "video/mp4")
        self.assertEqual((width, height), (1920, 1080))
        self.assertIn(b"ftyp", movie[:64])
        for template in ("fill", "ken_burns"):
            movie, mime, width, height = self.creative_runtime.generate_movie(
                movie_images,
                {
                    "kind": "movie",
                    "movie_template": template,
                    "frame_duration_ms": 1000,
                    "transition_ms": 0,
                },
            )
            self.assertEqual(mime, "video/mp4")
            self.assertEqual((width, height), (1920, 1080))
            self.assertIn(b"ftyp", movie[:64])
        with self.assertRaises(ValueError):
            self.creative_runtime.generate_movie(
                movie_images,
                {
                    "kind": "movie",
                    "movie_template": "freeform",
                    "frame_duration_ms": 1000,
                    "transition_ms": 0,
                },
            )
        movie, mime, width, height = self.creative_runtime.generate_movie(
            movie_images,
            {
                "kind": "movie",
                "movie_template": "classic",
                "music_url": "http://example.invalid/api/v1/file-preview/99?ticket=x",
                "music_fingerprint": PreviewHandler.music_fingerprint,
                "frame_duration_ms": 1000,
                "transition_ms": 0,
            },
            self.music_bytes,
        )
        self.assertEqual(mime, "video/mp4")
        self.assertEqual((width, height), (1920, 1080))
        self.assertIn(b"ftyp", movie[:64])
        self.assertIn(b"mp4a", movie)
        with self.assertRaises(ValueError):
            self.creative_runtime.generate_movie(
                movie_images,
                {
                    "kind": "movie",
                    "movie_template": "classic",
                    "music_url": "http://example.invalid/api/v1/file-preview/99?ticket=x",
                    "music_fingerprint": "c" * 64,
                    "frame_duration_ms": 1000,
                    "transition_ms": 0,
                },
                self.music_bytes,
            )

        collage_images = [
            image,
            cv.flip(image, 1),
            cv.rotate(image, cv.ROTATE_90_CLOCKWISE),
        ]
        for template in ("grid", "featured", "columns", "rows"):
            collage, mime, width, height = self.creative_runtime.generate_collage(
                collage_images,
                {
                    "kind": "collage",
                    "collage_template": template,
                },
            )
            self.assertEqual(mime, "image/jpeg")
            self.assertEqual((width, height), (2048, 2048))
            self.assertTrue(collage.startswith(b"\xff\xd8\xff"))


    def test_creative_unix_socket_protocol_end_to_end(self) -> None:
        fingerprint = "creative-test-v1-2048"
        PreviewHandler.fingerprint = fingerprint
        PreviewHandler.redirect = False
        with tempfile.TemporaryDirectory() as tmp:
            socket_path = str(Path(tmp) / "creative.sock")
            state = analyzer.AnalyzerState(
                self.runtime,
                self.smart_runtime,
                self.semantic_runtime,
                self.creative_runtime,
                self.preview_origin,
                "secret",
            )
            server = analyzer.ThreadingUnixHTTPServer(
                socket_path,
                analyzer.AnalyzerHandler,
                state,
            )
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                connection = analyzer.UnixHTTPConnection(socket_path)
                connection.request(
                    "GET",
                    "/v1/creative-info",
                    headers={
                        "Authorization": "Bearer secret",
                        "X-XDrive-Creative-Protocol": "1",
                    },
                )
                response = connection.getresponse()
                info = json.loads(response.read())
                self.assertEqual(response.status, 200)
                self.assertEqual(info["runtime_instance_id"], state.runtime_instance_id)
                self.assertEqual(
                    info["capabilities"],
                    [
                        "cutout",
                        "cutout_refine",
                        "erase",
                        "movie",
                        "movie_templates",
                        "movie_music",
                        "collage",
                    ],
                )
                connection.close()

                task = {
                    "kind": "cutout",
                    "preview_url": (
                        self.preview_origin
                        + "/api/v1/media-creative-preview/42?ticket=abc"
                    ),
                    "preview_version": 1,
                    "preview_edge": 2048,
                    "input_fingerprint": fingerprint,
                    "cutout_mode": "object",
                    "cutout_expand": -0.01,
                    "cutout_feather": 0.01,
                    "points": [{"x": 0.5, "y": 0.5, "foreground": True}],
                }
                payload = json.dumps(task).encode("utf-8")
                connection = analyzer.UnixHTTPConnection(socket_path)
                connection.request(
                    "POST",
                    "/v1/creative-generate",
                    body=payload,
                    headers={
                        "Authorization": "Bearer secret",
                        "Content-Type": "application/json",
                        "Content-Length": str(len(payload)),
                        "X-XDrive-Creative-Protocol": "1",
                    },
                )
                response = connection.getresponse()
                result = json.loads(response.read())
                self.assertEqual(response.status, 200)
                self.assertEqual(result["mime_type"], "image/png")
                self.assertTrue(base64.b64decode(result["data"]).startswith(
                    b"\x89PNG\r\n\x1a\n"
                ))
                connection.close()

                movie_task = {
                    "kind": "movie",
                    "preview_url": (
                        self.preview_origin
                        + "/api/v1/media-creative-preview/42?ticket=abc"
                    ),
                    "preview_version": 1,
                    "preview_edge": 2048,
                    "input_fingerprint": fingerprint,
                    "movie_frames": [
                        {
                            "preview_url": (
                                self.preview_origin
                                + "/api/v1/media-creative-preview/42?ticket=abc"
                            ),
                            "preview_version": 1,
                            "preview_edge": 2048,
                            "input_fingerprint": fingerprint,
                        },
                        {
                            "preview_url": (
                                self.preview_origin
                                + "/api/v1/media-creative-preview/42?ticket=def"
                            ),
                            "preview_version": 1,
                            "preview_edge": 2048,
                            "input_fingerprint": fingerprint,
                        },
                    ],
                    "movie_template": "fill",
                    "music_url": (
                        self.preview_origin
                        + "/api/v1/file-preview/99?ticket=music"
                    ),
                    "music_fingerprint": PreviewHandler.music_fingerprint,
                    "frame_duration_ms": 1000,
                    "transition_ms": 0,
                }
                movie_payload = json.dumps(movie_task).encode("utf-8")
                connection = analyzer.UnixHTTPConnection(socket_path)
                connection.request(
                    "POST",
                    "/v1/creative-generate",
                    body=movie_payload,
                    headers={
                        "Authorization": "Bearer secret",
                        "Content-Type": "application/json",
                        "Content-Length": str(len(movie_payload)),
                        "X-XDrive-Creative-Protocol": "1",
                    },
                )
                response = connection.getresponse()
                movie_result = json.loads(response.read())
                self.assertEqual(response.status, 200)
                self.assertEqual(movie_result["mime_type"], "video/mp4")
                movie_bytes = base64.b64decode(movie_result["data"])
                self.assertIn(b"ftyp", movie_bytes[:64])
                self.assertIn(b"mp4a", movie_bytes)
                connection.close()

                collage_task = {
                    "kind": "collage",
                    "preview_url": (
                        self.preview_origin
                        + "/api/v1/media-creative-preview/42?ticket=abc"
                    ),
                    "preview_version": 1,
                    "preview_edge": 2048,
                    "input_fingerprint": fingerprint,
                    "collage_images": [
                        {
                            "preview_url": (
                                self.preview_origin
                                + "/api/v1/media-creative-preview/42?ticket=abc"
                            ),
                            "preview_version": 1,
                            "preview_edge": 2048,
                            "input_fingerprint": fingerprint,
                        },
                        {
                            "preview_url": (
                                self.preview_origin
                                + "/api/v1/media-creative-preview/42?ticket=def"
                            ),
                            "preview_version": 1,
                            "preview_edge": 2048,
                            "input_fingerprint": fingerprint,
                        },
                    ],
                    "collage_template": "grid",
                }
                collage_payload = json.dumps(collage_task).encode("utf-8")
                connection = analyzer.UnixHTTPConnection(socket_path)
                connection.request(
                    "POST",
                    "/v1/creative-generate",
                    body=collage_payload,
                    headers={
                        "Authorization": "Bearer secret",
                        "Content-Type": "application/json",
                        "Content-Length": str(len(collage_payload)),
                        "X-XDrive-Creative-Protocol": "1",
                    },
                )
                response = connection.getresponse()
                collage_result = json.loads(response.read())
                self.assertEqual(response.status, 200)
                self.assertEqual(collage_result["mime_type"], "image/jpeg")
                self.assertTrue(
                    base64.b64decode(collage_result["data"]).startswith(
                        b"\xff\xd8\xff"
                    )
                )
                self.assertEqual(collage_result["width"], 2048)
                self.assertEqual(collage_result["height"], 2048)
                connection.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
