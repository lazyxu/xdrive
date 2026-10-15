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
