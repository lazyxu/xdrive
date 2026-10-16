"""Negative-only private Unix ingress regression: no heavy model inference required.

Configured Bearer tokens must reject every model route *before* reading a POST
body or calling inference. This is NOT proof of a global SQL admission barrier:
the legacy token-unset configuration remains a separate stop blocker.
"""
from __future__ import annotations

import socket
import tempfile
import threading
import unittest
from unittest import mock
from pathlib import Path
from types import SimpleNamespace

import analyzer


INFO_GET = (
    "/v1/info",
    "/v1/smart-info",
    "/v1/semantic-info",
    "/v1/creative-info",
)
CANARY_GET = (
    "/v1/face-detector-canary",
    "/v1/smart-model-canary",
    "/v1/semantic-image-canary",
    "/v1/creative-cutout-canary",
)
INFERENCE_POST = (
    "/v1/analyze",
    "/v1/smart-analyze",
    "/v1/semantic-image",
    "/v1/semantic-text",
    "/v1/creative-generate",
)


def forbidden_status(
    socket_path: str,
    method: str,
    target: str,
    bearer: str | None,
    *,
    announce_unread_body: bool = False,
) -> int:
    headers = [
        f"{method} {target} HTTP/1.1",
        "Host: localhost",
        "Connection: close",
    ]
    if bearer is not None:
        headers.append("Authorization: Bearer " + bearer)
    if method == "POST":
        headers.extend((
            "Content-Type: application/json",
            # A large declared but unsent body verifies auth BEFORE reading.
            "Content-Length: 1024" if announce_unread_body else "Content-Length: 2",
        ))
    else:
        headers.append("Content-Length: 0")
    request = ("\r\n".join(headers) + "\r\n\r\n").encode("ascii")
    if method == "POST" and not announce_unread_body:
        request += b"{}"
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(3)
        client.connect(socket_path)
        client.sendall(request)
        with client.makefile("rb") as response:
            status_line = response.readline(256)
    parts = status_line.split(b" ", 2)
    if len(parts) != 3 or parts[0] != b"HTTP/1.1":
        raise AssertionError("malformed Unix HTTP status line")
    return int(parts[1])


class PrivateModelIngressTests(unittest.TestCase):
    def test_every_configured_private_inference_route_authenticates_before_body(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            socket_path = str(Path(tmp) / "private-ingress.sock")
            # Deliberately NO runtime members: if any route reaches inference,
            # the fake state fails instead of invoking a model or reading bytes.
            state = SimpleNamespace(
                token="ordinary-photo-secret",
                host_apply_token="host-only-ack-secret",
            )
            server = analyzer.ThreadingUnixHTTPServer(
                socket_path, analyzer.AnalyzerHandler, state,
            )
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                for method, route in (
                    *(( "GET", r) for r in INFO_GET + CANARY_GET),
                    *(( "POST", r) for r in INFERENCE_POST),
                ):
                    for bad in (None, "invalid-token", "host-only-ack-secret"):
                        with self.subTest(method=method, route=route, token=bad):
                            self.assertEqual(forbidden_status(
                                socket_path, method, route, bad,
                                announce_unread_body=(method == "POST"),
                            ), 401)
                # A model token must never authorize the separate Host ACK,
                # and the host token is NOT an ordinary analyzer permission.
                for bad in (None, "ordinary-photo-secret", "invalid-token"):
                    with self.subTest(route="/v1/host-apply-ack", token=bad):
                        self.assertEqual(forbidden_status(
                            socket_path, "POST", "/v1/host-apply-ack", bad,
                            announce_unread_body=True,
                        ), 401)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=3)

    def test_model_info_private_bearer_reports_negative_without_secret(self) -> None:
        for token, enabled in (("", False), ("dummy-model-private-token", True)):
            with self.subTest(enabled=enabled):
                state = analyzer.AnalyzerState(
                    None, None, None, None, "http://server:8080", token,
                )
                info = state.info_with_session({"protocol_version": 1})
                self.assertIs(info["private_bearer_auth_required"], enabled)
                self.assertEqual(
                    set(info), {
                        "protocol_version", "runtime_instance_id",
                        "private_bearer_auth_required",
                    "private_ingress_policy_mode",
                    },
                )
                self.assertNotIn("dummy-model-private-token", str(info))
                self.assertEqual(info["private_ingress_policy_mode"], "legacy")

    def test_opt_in_strict_model_bearer_policy_fails_closed_before_runtime_start(self) -> None:
        strong_token = "a" * 64
        other_host_token = "b" * 64
        self.assertEqual(
            analyzer.validate_private_ingress_policy("legacy", ""), "legacy"
        )
        self.assertEqual(
            analyzer.validate_private_ingress_policy(
                "require-bearer-v1", strong_token, other_host_token,
            ),
            "require-bearer-v1",
        )
        for bad_policy, token, host_token in (
            ("require-bearer-v1", "", ""),
            ("require-bearer-v1", "weak", ""),
            ("require-bearer-v1", "A" * 64, ""),
            ("require-bearer-v1", strong_token, strong_token),
            ("invalid", strong_token, ""),
            ("LEGACY", strong_token, ""),
            ("", strong_token, ""),
        ):
            with self.subTest(mode=bad_policy, token_configured=bool(token)):
                with self.assertRaises(ValueError):
                    analyzer.validate_private_ingress_policy(
                        bad_policy, token, host_token
                    )
        with tempfile.TemporaryDirectory() as tmp:
            socket_path = Path(tmp) / "must-not-create.sock"
            args = SimpleNamespace(
                socket=str(socket_path),
                preview_origin="http://server:8080",
                token="", private_ingress_policy="require-bearer-v1",
            )
            with mock.patch.object(
                analyzer, "FaceRuntime", side_effect=AssertionError("model loaded")
            ):
                with self.assertRaises(ValueError):
                    analyzer.serve(args)
            self.assertFalse(socket_path.exists())

    def test_strict_mode_info_and_existing_private_unix_bearer_enforcement(self) -> None:
        token = "c" * 64
        # Lightweight runtime stubs give real Info responses with zero model
        # initialization and no user image/text task execution.
        models = (
            analyzer.PROTOCOL_VERSION,
            analyzer.SMART_PROTOCOL_VERSION,
            analyzer.SEMANTIC_PROTOCOL_VERSION,
            analyzer.CREATIVE_PROTOCOL_VERSION,
        )
        runtimes = tuple(
            SimpleNamespace(info=lambda version=version: {"protocol_version": version})
            for version in models
        )
        state = analyzer.AnalyzerState(
            *runtimes, "http://server:8080", token,
            private_ingress_policy="require-bearer-v1",
        )
        info = state.info_with_session({"protocol_version": 1})
        self.assertIs(info["private_bearer_auth_required"], True)
        self.assertEqual(info["private_ingress_policy_mode"], "require-bearer-v1")
        self.assertNotIn(token, str(info))
        with tempfile.TemporaryDirectory() as tmp:
            socket_path = str(Path(tmp) / "strict-ingress.sock")
            server = analyzer.ThreadingUnixHTTPServer(
                socket_path, analyzer.AnalyzerHandler, state,
            )
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                for method, route in (
                    *(( "GET", r) for r in INFO_GET + CANARY_GET),
                    *(( "POST", r) for r in INFERENCE_POST),
                ):
                    for bad in (None, "incorrect"):
                        with self.subTest(method=method, route=route, bad=bad):
                            self.assertEqual(forbidden_status(
                                socket_path, method, route, bad,
                                announce_unread_body=(method == "POST"),
                            ), 401)
                session = analyzer.healthcheck(
                    socket_path, token, "require-bearer-v1"
                )
                self.assertEqual(session, state.runtime_instance_id)
                # Even a matching Bearer does not prove that the running model
                # has switched to the requested strict policy.
                state.private_ingress_policy = "legacy"
                with self.assertRaisesRegex(RuntimeError, "not confirmed"):
                    analyzer.healthcheck(
                        socket_path, token, "require-bearer-v1"
                    )
            finally:
                server.shutdown()
                server.server_close()
                worker.join(timeout=3)

    def test_missing_host_apply_token_never_grants_host_control(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            socket_path = str(Path(tmp) / "host-ack-unavailable.sock")
            state = SimpleNamespace(token="ordinary-photo-secret", host_apply_token="")
            server = analyzer.ThreadingUnixHTTPServer(
                socket_path, analyzer.AnalyzerHandler, state,
            )
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                self.assertEqual(forbidden_status(
                    socket_path, "POST", "/v1/host-apply-ack",
                    "ordinary-photo-secret", announce_unread_body=True,
                ), 404)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=3)
