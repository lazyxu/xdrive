from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest

import cv2 as cv
import numpy as np

import analyzer


class PreviewHandler(BaseHTTPRequestHandler):
    image_bytes = b""
    fingerprint = ""
    redirect = False

    def do_GET(self) -> None:
        if self.redirect:
            self.send_response(302)
            self.send_header("Location", "/redirected")
            self.end_headers()
            return
        if not self.path.startswith("/api/v1/media-analysis-preview/42?ticket="):
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header(
            "Content-Length",
            str(len(self.image_bytes)),
        )
        self.send_header(
            "ETag",
            '"' + self.fingerprint + '"',
        )
        self.send_header(
            "X-XDrive-Analysis-Preview-Version",
            "1",
        )
        self.send_header(
            "X-XDrive-Analysis-Preview-Edge",
            "1280",
        )
        self.end_headers()
        self.wfile.write(self.image_bytes)

    def log_message(self, format: str, *args: object) -> None:
        del format, args


class AnalyzerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.runtime = analyzer.FaceRuntime()
        blank = np.zeros((240, 320, 3), dtype=np.uint8)
        ok, encoded = cv.imencode(".jpg", blank)
        if not ok:
            raise RuntimeError("failed to encode test JPEG")
        PreviewHandler.image_bytes = encoded.tobytes()
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
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
