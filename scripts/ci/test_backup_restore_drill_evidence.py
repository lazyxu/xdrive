import datetime as dt
import json
import os
import tempfile
import unittest

from verify_backup_restore_drill_evidence import (
    FIELDS, read_evidence, validate_evidence,
)

BASE = "a" * 40
HEAD = "b" * 40
CHECKOUT = "c" * 40


def good_record():
    now = dt.datetime.now(dt.timezone.utc)
    return {
        "protocol": "xdrive-isolated-backup-restore-drill-v1",
        "environment": "ci_ephemeral_docker",
        "production_verified": False,
        "result": "passed",
        "database_rows_recovered": True,
        "postgresql_post_snapshot_probe_absent": True,
        "legacy_file_bytes_restored": True,
        "cas_sha256_file_bytes_restored": True,
        "v1_restore_tested": True,
        "v2_first_generation_restore_tested": True,
        "v2_retained_after_manual_prune_restore_tested": True,
        "ci_checkout_sha": CHECKOUT,
        "ci_source_head_sha": HEAD,
        "observed_at_utc": now.isoformat(),
    }


class IsolatedRestoreDrillEvidenceTest(unittest.TestCase):
    def test_valid_merge_checkout_is_not_identical_to_source_head(self):
        value = good_record()
        self.assertEqual(set(value), FIELDS)
        self.assertIsNone(validate_evidence(value, CHECKOUT, HEAD, [BASE, HEAD]))

    def test_prod_claim_false_stage_and_sha_mismatch_all_fail_closed(self):
        for key, replacement in [
            ("production_verified", True),
            ("cas_sha256_file_bytes_restored", False),
            ("v1_restore_tested", 1),
            ("ci_checkout_sha", BASE),
            ("ci_source_head_sha", BASE),
            ("environment", "operator_production"),
            ("result", "failed"),
        ]:
            with self.subTest(key=key):
                value = good_record()
                value[key] = replacement
                with self.assertRaises(ValueError):
                    validate_evidence(value, CHECKOUT, HEAD, [BASE, HEAD])

    def test_forged_parent_or_stale_timestamp_is_rejected(self):
        value = good_record()
        for parents in ([], [BASE], [BASE, BASE]):
            with self.assertRaises(ValueError):
                validate_evidence(value, CHECKOUT, HEAD, parents)
        value["observed_at_utc"] = "2020-01-01T00:00:00+00:00"
        with self.assertRaises(ValueError):
            validate_evidence(value, CHECKOUT, HEAD, [BASE, HEAD])

    def test_extra_fields_duplicate_json_or_symlink_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "evidence.json")
            value = good_record()
            value["private_host_path"] = "/root/.xd"
            with open(path, "w", encoding="utf-8") as stream:
                json.dump(value, stream)
            with self.assertRaises(ValueError):
                validate_evidence(read_evidence(path), CHECKOUT, HEAD, [BASE, HEAD])
            with open(path, "w", encoding="utf-8") as stream:
                stream.write('{"result":"passed","result":"passed"}')
            with self.assertRaises(ValueError):
                read_evidence(path)
            alias = os.path.join(directory, "alias.json")
            os.symlink(path, alias)
            with self.assertRaises(OSError):
                read_evidence(alias)

    def test_production_proof_is_never_created_by_ci(self):
        value = good_record()
        self.assertIs(value["production_verified"], False)
        self.assertIsNone(validate_evidence(value, CHECKOUT, HEAD, [BASE, HEAD]))
