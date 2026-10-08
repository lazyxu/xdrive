from __future__ import annotations

import base64
import hashlib
import io
import json
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
                "points": [{"x": 0.5, "y": 0.5, "foreground": True}],
            },
        )
        self.assertEqual(mime, "image/png")
        self.assertEqual((width, height), (256, 256))
        self.assertTrue(cutout.startswith(b"\x89PNG\r\n\x1a\n"))

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
                self.assertEqual(
                    info["capabilities"],
                    [
                "cutout",
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
