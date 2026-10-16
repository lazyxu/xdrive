"""True Unix HTTP handler tests for a test-injected, non-deployed permit gate."""
from __future__ import annotations

import hashlib
import http.client
import json
import socket
import tempfile
import threading
import unittest
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

import admission_permit
import analyzer
from model_permit_guard import OfflineModelPermitGuard

KEY = "ab" * 32
EPOCH = "0123456789abcdef0123456789abcdef"
SERVER_ID = "1" * 32
MODEL_ID = "2" * 32
NOW = 1700000001
BEARER = "ordinary-test-model-bearer"
ROUTES = (
    ("GET", "/v1/face-detector-canary"),
    ("GET", "/v1/smart-model-canary"),
    ("GET", "/v1/semantic-image-canary"),
    ("GET", "/v1/creative-cutout-canary"),
    ("POST", "/v1/analyze"),
    ("POST", "/v1/smart-analyze"),
    ("POST", "/v1/semantic-image"),
    ("POST", "/v1/semantic-text"),
    ("POST", "/v1/creative-generate"),
)


def header_for(path: str) -> str:
    if path in ("/v1/analyze", "/v1/face-detector-canary"):
        return "X-XDrive-Face-Protocol"
    if path in ("/v1/smart-analyze", "/v1/smart-model-canary"):
        return "X-XDrive-Smart-Protocol"
    if path.startswith("/v1/creative-"):
        return "X-XDrive-Creative-Protocol"
    return "X-XDrive-Semantic-Protocol"


@contextmanager
def server_fixture(state: object):
    with tempfile.TemporaryDirectory() as tmp:
        socket_path = str(Path(tmp) / "test-model.sock")
        server = analyzer.ThreadingUnixHTTPServer(
            socket_path, analyzer.AnalyzerHandler, state,
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield socket_path
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)


def request(
    socket_path: str, method: str, path: str, *,
    body: bytes | None = None, permit: str | None = None,
    duplicate_header: bool = False,
    bearer: str = BEARER,
) -> tuple[int, dict]:
    if body is None:
        body = b'{"text":"hello"}' if method == "POST" else b""
    lines = [
        f"{method} {path} HTTP/1.1",
        "Host: localhost",
        "Connection: close",
        "Authorization: Bearer " + bearer,
        header_for(path) + ": 1",
        f"Content-Length: {len(body)}",
    ]
    if method == "POST":
        lines.append("Content-Type: application/json")
    if permit is not None:
        lines.append("X-XDrive-Model-Permit: " + permit)
        if duplicate_header:
            lines.append("X-XDrive-Model-Permit: " + permit)
    data = ("\r\n".join(lines) + "\r\n\r\n").encode("ascii") + body
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(3)
        client.connect(socket_path)
        client.sendall(data)
        response = http.client.HTTPResponse(client)
        response.begin()
        return response.status, json.loads(response.read())


def signing_claim(method: str, path: str, body: bytes, nonce: str) -> dict:
    return {
        "version": 1,
        "deployment_epoch": EPOCH,
        "server_id": SERVER_ID,
        "model_id": MODEL_ID,
        "revision": 17,
        "nonce": nonce,
        "issued_at": NOW - 1,
        "expires_at": NOW + 9,
        "method": method,
        "path": path,
        "body_sha256": hashlib.sha256(body).hexdigest(),
    }


def signed(method: str, path: str, body: bytes, nonce: str = "3" * 32) -> str:
    return json.dumps(
        admission_permit.sign_v1(
            KEY, signing_claim(method, path, body, nonce),
        ), separators=(",", ":"),
    )


def new_guard(**overrides: object) -> OfflineModelPermitGuard:
    fields: dict[str, object] = {
        "key_hex": KEY,
        "deployment_epoch": EPOCH,
        "expected_model_id": MODEL_ID,
        "expected_revision": 17,
        "allowed_server_ids": frozenset({SERVER_ID}),
        "clock": lambda: NOW,
    }
    fields.update(overrides)
    return OfflineModelPermitGuard(**fields)


def fake_state(guard: object) -> SimpleNamespace:
    return SimpleNamespace(
        token=BEARER,
        host_apply_token="separate-host-only-token",
        model_permit_verifier=guard,
        smart_runtime=SimpleNamespace(
            probe_synthetic_visual_ocr=lambda: {"probe": "accepted"},
        ),
        semantic_runtime=SimpleNamespace(
            embed_text=lambda text: {"echo": text},
        ),
    )


class OfflineModelPermitHandlerTests(unittest.TestCase):
    def test_all_nine_model_routes_deny_without_injected_permit(self) -> None:
        with server_fixture(fake_state(new_guard())) as sock:
            for method, path in ROUTES:
                with self.subTest(method=method, path=path):
                    status, result = request(sock, method, path)
                    self.assertEqual(status, 403)
                    self.assertEqual(result, {"error": "model permit not authorized"})

    def test_fixed_canary_accept_once_then_deny_replay_and_tampering(self) -> None:
        path = "/v1/smart-model-canary"
        valid = signed("GET", path, b"")
        with server_fixture(fake_state(new_guard())) as sock:
            self.assertEqual(request(sock, "GET", path, permit=valid)[0], 200)
            self.assertEqual(request(sock, "GET", path, permit=valid)[0], 403)
            self.assertEqual(request(
                sock, "GET", path, permit=valid, duplicate_header=True,
            )[0], 400)
            changed = json.loads(valid)
            changed["revision"] = 18
            self.assertEqual(request(
                sock, "GET", path,
                permit=json.dumps(changed, separators=(",", ":")),
            )[0], 403)
            self.assertEqual(request(
                sock, "GET", path,
                permit=signed("GET", path, b"", nonce="4" * 32),
                bearer="incorrect-bearer",
            )[0], 401)
            duplicates = valid.replace(
                '"version":1,', '"version":1,"version":1,', 1,
            )
            self.assertEqual(request(
                sock, "GET", path, permit=duplicates,
            )[0], 403)

    def test_post_exact_body_and_replay_before_semantic_inference(self) -> None:
        path = "/v1/semantic-text"
        raw = b'{"text":"hello"}'
        permit = signed("POST", path, raw)
        with server_fixture(fake_state(new_guard())) as sock:
            self.assertEqual(request(
                sock, "POST", path, body=b'{"text":"changed"}',
                permit=permit,
            )[0], 403)
            status, output = request(
                sock, "POST", path, body=raw, permit=permit,
            )
            self.assertEqual(status, 200)
            self.assertEqual(output, {"echo": "hello"})
            self.assertEqual(request(
                sock, "POST", path, body=raw, permit=permit,
            )[0], 403)

    def test_legacy_no_verifier_preserves_existing_model_bearer(self) -> None:
        with server_fixture(fake_state(None)) as sock:
            self.assertEqual(request(
                sock, "GET", "/v1/smart-model-canary",
            )[0], 200)

    def test_untrusted_member_or_broken_verifier_fails_closed(self) -> None:
        route = "/v1/smart-model-canary"
        permit = signed("GET", route, b"")
        with server_fixture(fake_state(new_guard(
            allowed_server_ids=frozenset({"b" * 32}),
        ))) as sock:
            self.assertEqual(request(
                sock, "GET", route, permit=permit,
            )[0], 403)
        def fail(*args: object) -> bool:
            raise ValueError("private fixture failure")
        with server_fixture(fake_state(fail)) as sock:
            self.assertEqual(request(sock, "GET", route)[0], 403)
