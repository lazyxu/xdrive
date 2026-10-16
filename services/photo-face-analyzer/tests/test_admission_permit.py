"""Cross-language golden contract and negative-only model permit tests."""
from __future__ import annotations

import copy
import hashlib
import unittest
from concurrent.futures import ThreadPoolExecutor

import admission_permit as p

KEY = "ab" * 32
BODY = b'{"text":"hello"}'
EXPECTED_MAC = "2dfe4e035ef32e2ff7d947a9ffdfd4b8df07a869bce49818bed232866f00b2ce"
CLAIMS = {
    "version": 1,
    "deployment_epoch": "0123456789abcdef0123456789abcdef",
    "server_id": "1" * 32,
    "model_id": "2" * 32,
    "revision": 17,
    "nonce": "3" * 32,
    "issued_at": 1700000000,
    "expires_at": 1700000020,
    "method": "POST",
    "path": "/v1/semantic-text",
    "body_sha256": hashlib.sha256(BODY).hexdigest(),
}


class PrivateModelPermitTests(unittest.TestCase):
    def accept(self, permit: object, *, cache: p.ReplayCache | None = None,
               now: int = 1700000001, body: bytes = BODY, method: str = "POST",
               path: str = "/v1/semantic-text", model_id: str = "2" * 32,
               epoch: str = "0123456789abcdef0123456789abcdef",
               revision: int = 17,
               servers: frozenset[str] = frozenset({"1" * 32})) -> bool:
        return p.verify_v1(
            KEY, permit, method=method, path=path, body=body, now=now,
            model_id=model_id, deployment_epoch=epoch,
            expected_revision=revision,
            allowed_server_ids=servers, replay=cache or p.ReplayCache(),
        )

    def test_cross_language_golden_and_replay_denial(self) -> None:
        permit = p.sign_v1(KEY, CLAIMS)
        self.assertEqual(permit["mac"], EXPECTED_MAC)
        self.assertEqual(set(permit), set(p.FIELDS) | {"mac"})
        replay = p.ReplayCache()
        self.assertTrue(self.accept(permit, cache=replay))
        self.assertFalse(self.accept(permit, cache=replay))
        self.assertFalse(self.accept(permit, now=1700000020))
        self.assertFalse(self.accept(permit, now=1699999994))
        self.assertTrue(self.accept(permit, now=1699999995))

    def test_mac_tampering_route_scope_and_member_veto(self) -> None:
        original = p.sign_v1(KEY, CLAIMS)
        for kwargs in (
            {"body": b'{"text":"bye"}'},
            {"method": "GET"},
            {"path": "/v1/analyze"},
            {"model_id": "4" * 32},
            {"epoch": "5" * 32},
            {"revision": 18},
            {"revision": True},
            {"servers": frozenset({"6" * 32})},
            {"servers": frozenset()},
        ):
            with self.subTest(kwargs=kwargs):
                self.assertFalse(self.accept(original, **kwargs))
        for field, value in (
            ("nonce", "4" * 32), ("revision", 18),
            ("server_id", "7" * 32), ("path", "/v1/creative-generate"),
            ("expires_at", 1700000019),
        ):
            altered = copy.deepcopy(original)
            altered[field] = value
            self.assertFalse(self.accept(altered))
        extra = {**original, "extra": True}
        self.assertFalse(self.accept(extra))
        self.assertFalse(self.accept(None))

    def test_same_nonce_concurrent_model_verify_only_admits_once(self) -> None:
        signed = p.sign_v1(KEY, CLAIMS)
        replay = p.ReplayCache()
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(
                lambda _: self.accept(signed, cache=replay), range(32)
            ))
        self.assertEqual(results.count(True), 1)
        self.assertEqual(results.count(False), 31)

    def test_invalid_type_ttl_get_and_replay_saturation(self) -> None:
        for field, invalid in (
            ("version", True), ("revision", 0),
            ("revision", 1 << 60), ("issued_at", True),
            ("expires_at", CLAIMS["issued_at"] + 31),
            ("deployment_epoch", "X" * 32),
            ("server_id", "bad"), ("nonce", "z" * 32),
            ("method", "DELETE"), ("path", "/v1/info"),
            ("body_sha256", "Z" * 64),
        ):
            with self.subTest(field=field):
                values = {**CLAIMS, field: invalid}
                with self.assertRaises(ValueError):
                    p.sign_v1(KEY, values)
        for key in ("", "z" * 64, "AA" * 32, KEY[:-1]):
            with self.assertRaises(ValueError):
                p.sign_v1(key, CLAIMS)
        get_claims = {
            **CLAIMS, "method": "GET", "path": "/v1/smart-model-canary",
            "body_sha256": p.EMPTY_SHA256,
        }
        get_permit = p.sign_v1(KEY, get_claims)
        self.assertTrue(self.accept(
            get_permit, body=b"", method="GET", path="/v1/smart-model-canary",
        ))
        cache = p.ReplayCache(capacity=1)
        self.assertTrue(self.accept(p.sign_v1(KEY, CLAIMS), cache=cache))
        second = {**CLAIMS, "nonce": "8" * 32}
        self.assertFalse(self.accept(p.sign_v1(KEY, second), cache=cache))
        # Nonce storage expires only when the associated permit is no longer
        # acceptable; do not evict unexpired nonces to make room.
        newer = {**second, "issued_at": 1700000020, "expires_at": 1700000030}
        self.assertTrue(self.accept(p.sign_v1(KEY, newer), cache=cache, now=1700000021))
