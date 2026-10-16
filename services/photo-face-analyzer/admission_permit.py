"""Non-deployed private model inference permit v1 codec.

Only schema, bounded MAC verification and replay primitives live here.
Nothing in AnalyzerHandler invokes this module yet. Do not advertise fleet
admission or allow operator freeze/stop based on a valid test permit.
"""
from __future__ import annotations

import hashlib
import hmac
import re
import threading
from typing import Mapping

DOMAIN = "xdrive.photo.model-permit.v1"
VERSION = 1
MAX_LIFETIME_SECONDS = 30
MAX_FUTURE_SKEW_SECONDS = 5
MAX_REPLAY_ENTRIES = 32768
EMPTY_SHA256 = hashlib.sha256(b"").hexdigest()
FIELDS = (
    "version", "deployment_epoch", "server_id", "model_id", "revision",
    "nonce", "issued_at", "expires_at", "method", "path", "body_sha256",
)
MODEL_ROUTES = frozenset({
    ("GET", "/v1/face-detector-canary"),
    ("GET", "/v1/smart-model-canary"),
    ("GET", "/v1/semantic-image-canary"),
    ("GET", "/v1/creative-cutout-canary"),
    ("POST", "/v1/analyze"),
    ("POST", "/v1/smart-analyze"),
    ("POST", "/v1/semantic-image"),
    ("POST", "/v1/semantic-text"),
    ("POST", "/v1/creative-generate"),
})


def _key_bytes(key_hex: str) -> bytes:
    if not isinstance(key_hex, str) or not re.fullmatch(r"[0-9a-f]{64}", key_hex):
        raise ValueError("model permit key format invalid")
    return bytes.fromhex(key_hex)


def canonical_v1(claims: Mapping[str, object]) -> bytes:
    """Reject ambiguities: exact fields, fixed ASCII shape and finite lifespan."""
    if not isinstance(claims, dict) or set(claims) != set(FIELDS):
        raise ValueError("model permit shape invalid")
    for field in ("deployment_epoch", "server_id", "model_id", "nonce"):
        if not isinstance(claims[field], str) or not re.fullmatch(
            r"[0-9a-f]{32}", claims[field]
        ):
            raise ValueError("model permit identity invalid")
    if not isinstance(claims["body_sha256"], str) or not re.fullmatch(
        r"[0-9a-f]{64}", claims["body_sha256"]
    ):
        raise ValueError("model permit body digest invalid")
    for field in ("version", "revision", "issued_at", "expires_at"):
        if type(claims[field]) is not int:
            raise ValueError("model permit integer invalid")
    if claims["version"] != VERSION or not (0 < claims["revision"] < 1 << 60):
        raise ValueError("model permit revision invalid")
    issued = claims["issued_at"]
    expires = claims["expires_at"]
    if issued < 0 or not (0 < expires - issued <= MAX_LIFETIME_SECONDS):
        raise ValueError("model permit window invalid")
    method, path = claims["method"], claims["path"]
    if not isinstance(method, str) or not isinstance(path, str):
        raise ValueError("model permit route invalid")
    if (method, path) not in MODEL_ROUTES:
        raise ValueError("model permit route not admitted")
    if method == "GET" and claims["body_sha256"] != EMPTY_SHA256:
        raise ValueError("model permit GET body must be empty")
    return (
        "\n".join((DOMAIN, *(str(claims[k]) for k in FIELDS))) + "\n"
    ).encode("ascii")


def sign_v1(key_hex: str, claims: dict[str, object]) -> dict[str, object]:
    """A codec ONLY; caller must later prove a live DB lease before signing."""
    message = canonical_v1(claims)
    mac = hmac.new(_key_bytes(key_hex), message, hashlib.sha256).hexdigest()
    return {**claims, "mac": mac}


class ReplayCache:
    """Bounded model-process memory; saturation fails closed, not LRU eviction."""
    def __init__(self, capacity: int = MAX_REPLAY_ENTRIES) -> None:
        if type(capacity) is not int or not (0 < capacity <= MAX_REPLAY_ENTRIES):
            raise ValueError("invalid model permit replay cache capacity")
        self._capacity = capacity
        self._lock = threading.Lock()
        self._seen: dict[tuple[str, str], int] = {}

    def consume(self, server_id: str, nonce: str, expires_at: int, now: int) -> bool:
        key = (server_id, nonce)
        with self._lock:
            self._seen = {k: exp for k, exp in self._seen.items() if exp > now}
            if key in self._seen or len(self._seen) >= self._capacity:
                return False
            self._seen[key] = expires_at
            return True


def verify_v1(
    key_hex: str,
    permit: object,
    *,
    method: str,
    path: str,
    body: bytes,
    model_id: str,
    deployment_epoch: str,
    expected_revision: int,
    allowed_server_ids: frozenset[str],
    now: int,
    replay: ReplayCache,
) -> bool:
    """A testable primitive, NOT wired to the private Unix HTTP handler."""
    if type(now) is not int or not isinstance(body, bytes) or not isinstance(replay, ReplayCache):
        return False
    if type(expected_revision) is not int or not (0 < expected_revision < 1 << 60):
        return False
    if not isinstance(allowed_server_ids, frozenset) or not allowed_server_ids:
        return False
    if not isinstance(permit, dict) or set(permit) != set(FIELDS) | {"mac"}:
        return False
    try:
        mac = permit["mac"]
        if not isinstance(mac, str) or not re.fullmatch(r"[0-9a-f]{64}", mac):
            return False
        claims = {k: permit[k] for k in FIELDS}
        message = canonical_v1(claims)
        expected = hmac.new(_key_bytes(key_hex), message, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(mac, expected):
            return False
        if claims["method"] != method or claims["path"] != path:
            return False
        if claims["body_sha256"] != hashlib.sha256(body).hexdigest():
            return False
        if (claims["model_id"] != model_id or
                claims["deployment_epoch"] != deployment_epoch or
                claims["revision"] != expected_revision):
            return False
        if claims["server_id"] not in allowed_server_ids:
            return False
        if claims["issued_at"] > now + MAX_FUTURE_SKEW_SECONDS or now >= claims["expires_at"]:
            return False
    except (ValueError, TypeError, KeyError):
        return False
    return replay.consume(
        claims["server_id"], claims["nonce"], claims["expires_at"], now
    )
