from __future__ import annotations

from contextlib import contextmanager
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest import mock
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fetch_models


@contextmanager
def download_server(reply):
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append((self.path, self.headers.get("Range")))
            status, body, headers = reply(self.path, self.headers, len(requests))
            self.send_response(status)
            for name, value in headers.items():
                self.send_header(name, str(value))
            self.end_headers()
            self.wfile.write(body)
            self.wfile.flush()
            self.close_connection = True

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01})
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", requests
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.destination = Path(self.directory.name) / "model.onnx"
        self.payload = b"pinned model contents\n" * 10000
        self.prefix = self.payload[:65536]
        self.enterContext(mock.patch.dict(os.environ, {
            "HF_ENDPOINT": "",
            "XDRIVE_MODEL_DOWNLOAD_ATTEMPTS": "2",
            "XDRIVE_MODEL_DOWNLOAD_TIMEOUT": "2",
            "no_proxy": "127.0.0.1",
            "NO_PROXY": "127.0.0.1",
        }))
        self.enterContext(mock.patch.object(fetch_models.time, "sleep"))

    def interrupted_then_resumed(self, path, headers, number):
        if number == 1:
            return 200, self.prefix, {"Content-Length": len(self.payload)}
        offset = int(headers.get("Range", "bytes=0-").split("=")[1].split("-")[0])
        return 206, self.payload[offset:], {
            "Content-Length": len(self.payload) - offset,
            "Content-Range": f"bytes {offset}-{len(self.payload)-1}/{len(self.payload)}",
        }

    def test_interrupted_body_is_resumed_before_publishing(self):
        with download_server(self.interrupted_then_resumed) as (base, requests):
            fetch_models.download(base + "/model", self.destination, attempts=2)
        self.assertEqual(self.destination.read_bytes(), self.payload)
        self.assertEqual(requests, [("/model", None), ("/model", "bytes=65536-")])

    def test_failed_invocation_keeps_partial_bytes_for_next_job(self):
        with download_server(self.interrupted_then_resumed) as (base, requests):
            with self.assertRaises(RuntimeError):
                fetch_models.download(base + "/model", self.destination, attempts=1)
            self.assertFalse(self.destination.exists())
            self.assertEqual(self.destination.with_name("model.onnx.part").read_bytes(), self.prefix)
            fetch_models.download(base + "/model", self.destination, attempts=1)
        self.assertEqual(self.destination.read_bytes(), self.payload)
        self.assertEqual(requests[-1], ("/model", "bytes=65536-"))

    def test_ignored_range_restarts_instead_of_appending(self):
        def reply(path, headers, number):
            if number == 1:
                return self.interrupted_then_resumed(path, headers, number)
            return 200, self.payload, {"Content-Length": len(self.payload)}

        with download_server(reply) as (base, requests):
            fetch_models.download(base + "/model", self.destination, attempts=2)
        self.assertEqual(self.destination.read_bytes(), self.payload)
        self.assertEqual(requests[-1], ("/model", "bytes=65536-"))

    def test_wrong_content_range_is_rejected_without_publishing(self):
        def reply(path, headers, number):
            if number == 1:
                return self.interrupted_then_resumed(path, headers, number)
            return 206, self.payload, {
                "Content-Length": len(self.payload),
                "Content-Range": f"bytes 0-{len(self.payload)-1}/{len(self.payload)}",
            }

        with download_server(reply) as (base, _):
            with self.assertRaises(RuntimeError):
                fetch_models.download(base + "/model", self.destination, attempts=2)
        self.assertFalse(self.destination.exists())

    def test_hash_mismatch_retries_without_publishing_bad_bytes(self):
        self.destination.write_bytes(b"previous file")

        def reply(path, headers, number):
            self.assertEqual(self.destination.read_bytes(), b"previous file")
            body = b"wrong model" if number == 1 else self.payload
            return 200, body, {"Content-Length": len(body)}

        with download_server(reply) as (base, requests):
            fetch_models.download(
                base + "/model", self.destination, attempts=2,
                expected_sha256=hashlib.sha256(self.payload).hexdigest(),
            )
        self.assertEqual(self.destination.read_bytes(), self.payload)
        self.assertEqual(requests, [("/model", None), ("/model", None)])

    def test_verified_cached_model_does_not_contact_network(self):
        self.destination.write_bytes(self.payload)
        with download_server(lambda *args: (503, b"", {})) as (base, requests):
            fetch_models.download(
                base + "/model", self.destination,
                expected_sha256=hashlib.sha256(self.payload).hexdigest(),
            )
        self.assertEqual(self.destination.read_bytes(), self.payload)
        self.assertEqual(requests, [])

    def test_failed_mirror_immediately_falls_back_to_origin(self):
        def reply(path, headers, number):
            if path == "/mirror":
                return 503, b"", {"Content-Length": 0}
            return 200, self.payload, {"Content-Length": len(self.payload)}

        with download_server(reply) as (base, requests):
            with mock.patch.object(fetch_models, "download_urls", return_value=[base + "/mirror", base + "/origin"]):
                fetch_models.download(base + "/canonical", self.destination, attempts=1)
        self.assertEqual(self.destination.read_bytes(), self.payload)
        self.assertEqual(requests, [("/mirror", None), ("/origin", None)])

    def test_tls_connection_reset_uses_next_source(self):
        real_urlopen = fetch_models.urllib.request.urlopen
        attempted = []

        def urlopen(request, **kwargs):
            attempted.append(request.full_url)
            if request.full_url.endswith("/mirror"):
                raise urllib.error.URLError(ConnectionResetError(104, "Connection reset by peer"))
            return real_urlopen(request, **kwargs)

        with download_server(lambda *args: (200, self.payload, {"Content-Length": len(self.payload)})) as (base, _):
            with mock.patch.object(fetch_models, "download_urls", return_value=[base + "/mirror", base + "/origin"]), mock.patch.object(fetch_models.urllib.request, "urlopen", side_effect=urlopen):
                fetch_models.download(base + "/canonical", self.destination, attempts=1)
        self.assertEqual(self.destination.read_bytes(), self.payload)
        self.assertEqual(attempted, [base + "/mirror", base + "/origin"])

    def test_hf_endpoint_keeps_pinned_path_and_official_fallback(self):
        url = "https://huggingface.co/owner/model/resolve/immutable/onnx/model.onnx"
        with mock.patch.dict(os.environ, {"HF_ENDPOINT": "https://mirror.example/hf/"}):
            self.assertEqual(fetch_models.download_urls(url), [
                "https://mirror.example/hf/owner/model/resolve/immutable/onnx/model.onnx", url,
            ])
            other = "https://raw.githubusercontent.com/owner/repo/commit/LICENSE"
            self.assertEqual(fetch_models.download_urls(other), [other])

    def test_changed_model_identity_discards_partial_from_older_version(self):
        with download_server(self.interrupted_then_resumed) as (base, requests):
            with self.assertRaises(RuntimeError):
                fetch_models.download(base + "/old", self.destination, attempts=1)
            fetch_models.download(base + "/new", self.destination, attempts=1)
        self.assertEqual(self.destination.read_bytes(), self.payload)
        self.assertEqual(requests[-1], ("/new", None))

    def test_corrupt_partial_identity_restarts_cleanly(self):
        self.destination.with_name("model.onnx.part").write_bytes(b"unverified stale partial")
        self.destination.with_name("model.onnx.part.key").write_bytes(b"\xff\xfe")
        with download_server(lambda *args: (200, self.payload, {"Content-Length": len(self.payload)})) as (base, requests):
            fetch_models.download(base + "/model", self.destination, attempts=1)
        self.assertEqual(self.destination.read_bytes(), self.payload)
        self.assertEqual(requests, [("/model", None)])

    def test_range_not_satisfiable_restarts_cleanly(self):
        def reply(path, headers, number):
            if number == 1:
                return self.interrupted_then_resumed(path, headers, number)
            if number == 2:
                return 416, b"", {"Content-Range": "bytes */1", "Content-Length": 0}
            return 200, self.payload, {"Content-Length": len(self.payload)}

        with download_server(reply) as (base, requests):
            fetch_models.download(base + "/model", self.destination, attempts=3)
        self.assertEqual(self.destination.read_bytes(), self.payload)
        self.assertEqual(requests, [("/model", None), ("/model", "bytes=65536-"), ("/model", None)])

    def test_non_retryable_status_has_bounded_requests(self):
        with download_server(lambda *args: (404, b"", {"Content-Length": 0})) as (base, requests):
            with self.assertRaises(RuntimeError):
                fetch_models.download(base + "/missing", self.destination, attempts=5)
        self.assertFalse(self.destination.exists())
        self.assertEqual(requests, [("/missing", None)])


class ModelBundleTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.model_dir = Path(self.directory.name) / "models"
        self.license_dir = Path(self.directory.name) / "licenses"
        self.model_dir.mkdir()
        self.license_dir.mkdir()

    def test_verify_only_rejects_missing_asset_without_network(self):
        with mock.patch.object(fetch_models.urllib.request, "urlopen", side_effect=AssertionError("offline verifier tried network")):
            with self.assertRaises(FileNotFoundError):
                fetch_models.main([str(self.model_dir), str(self.license_dir), "--verify-only"])

    def test_verify_only_validates_models_text_licenses_and_provenance(self):
        model = b"fixture model"
        license_text = b"fixture license"
        labels = b"label\n"
        charset = b"abc"
        fixture_model = {"name": "model.onnx", "url": "https://example.invalid/model", "sha256": hashlib.sha256(model).hexdigest(), "size": len(model)}
        fixture_license = {"name": "LICENSE.txt", "url": "https://example.invalid/LICENSE", "sha256": hashlib.sha256(license_text).hexdigest()}
        self.enterContext(mock.patch.object(fetch_models, "FILES", [fixture_model]))
        self.enterContext(mock.patch.object(fetch_models, "LICENSES", [fixture_license]))
        self.enterContext(mock.patch.object(fetch_models, "IMAGENET_LABELS_SHA256", hashlib.sha256(labels).hexdigest()))
        self.enterContext(mock.patch.object(fetch_models, "CRNN_CHARSET_SHA256", hashlib.sha256(charset).hexdigest()))
        for name, data in {"model.onnx": model, "imagenet1k_labels.txt": labels, "crnn_cn_charset.txt": charset}.items():
            (self.model_dir / name).write_bytes(data)
        (self.license_dir / "LICENSE.txt").write_bytes(license_text)
        provenance = (
            "Pinned models used by xDrive Photo Intelligence\n"
            "repository: https://github.com/opencv/opencv_zoo\n"
            f"opencv_zoo_commit: {fetch_models.OPENCV_ZOO_COMMIT}\n"
            f"siglip_onnx_commit: {fetch_models.SIGLIP_ONNX_COMMIT}\n"
            f"siglip_tokenizer_commit: {fetch_models.SIGLIP_TOKENIZER_COMMIT}\n\n"
            f"model.onnx\nsha256: {fixture_model['sha256']}\nsize: {len(model)}\n"
        )
        (self.license_dir / "OPENCV_ZOO_SOURCE.txt").write_text(provenance)
        args = [str(self.model_dir), str(self.license_dir), "--verify-only"]
        with mock.patch.object(fetch_models.urllib.request, "urlopen", side_effect=AssertionError("offline verifier tried network")):
            self.assertEqual(fetch_models.main(args), 0)
            for path in [self.model_dir / "model.onnx", self.model_dir / "imagenet1k_labels.txt", self.model_dir / "crnn_cn_charset.txt", self.license_dir / "LICENSE.txt", self.license_dir / "OPENCV_ZOO_SOURCE.txt"]:
                original = path.read_bytes()
                path.write_bytes(b"corrupt cached bytes")
                with self.subTest(path=path.name), self.assertRaises(RuntimeError):
                    fetch_models.main(args)
                path.write_bytes(original)


if __name__ == "__main__":
    unittest.main()
