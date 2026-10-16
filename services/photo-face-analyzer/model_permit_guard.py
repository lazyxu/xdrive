"""Offline-only permit verifier fixture. No production code instantiates it."""
from __future__ import annotations

import json
import re
import time
from collections.abc import Callable, Mapping

import admission_permit


class OfflineModelPermitGuard:
    """Trusted expected policy data come from tests, never request headers."""

    def __init__(
        self, *,
        key_hex: str,
        deployment_epoch: str,
        expected_model_id: str,
        expected_revision: int,
        allowed_server_ids: frozenset[str],
        replay: admission_permit.ReplayCache | None = None,
        clock: Callable[[], int] | None = None,
    ) -> None:
        self._key = key_hex
        self._deployment_epoch = deployment_epoch
        self._model_id = expected_model_id
        self._revision = expected_revision
        self._members = allowed_server_ids
        self._replay = replay if replay is not None else admission_permit.ReplayCache()
        self._clock = clock if clock is not None else lambda: int(time.time())

    def __call__(
        self, method: str, path: str, body: bytes,
        headers: Mapping[str, str],
    ) -> bool:
        if not isinstance(headers, dict):
            return False
        raw = headers.get("x-xdrive-model-permit")
        if not isinstance(raw, str) or not (0 < len(raw) <= 2048):
            return False
        # Reject HTTP control characters and duplicate JSON fields.
        if not raw.startswith("{") or re.search(r"[\x00-\x1f\x7f]", raw):
            return False

        def unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
            result: dict[str, object] = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError("duplicate model permit field")
                result[key] = value
            return result

        try:
            permit = json.loads(raw, object_pairs_hook=unique_object)
            now = self._clock()
        except (TypeError, ValueError, OverflowError):
            return False
        return admission_permit.verify_v1(
            self._key, permit, method=method, path=path, body=body,
            model_id=self._model_id, deployment_epoch=self._deployment_epoch,
            expected_revision=self._revision,
            allowed_server_ids=self._members, now=now, replay=self._replay,
        )
