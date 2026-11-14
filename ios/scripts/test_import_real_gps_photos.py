#!/usr/bin/env python3
"""Tests for importing actual files: no mocked PhotoKit success claims."""
import subprocess
import tempfile
import unittest
from pathlib import Path

from import_real_gps_photos import import_gps_photos


class RealGPSImportContracts(unittest.TestCase):
    def make_source(self, root: Path, count: int) -> Path:
        directory = root / "photos"
        directory.mkdir()
        for i in range(count):
            (directory / f"gps-{i:06d}.jpg").write_bytes(b"fixture-only")
        return directory

    def test_every_real_file_is_passed_in_serial_bounded_batches(self):
        with tempfile.TemporaryDirectory() as temp:
            root = self.make_source(Path(temp), 5)
            commands = []

            def fake_runner(args, **kwargs):
                self.assertEqual(kwargs["timeout"], 7)
                self.assertTrue(kwargs["check"])
                commands.append(args)

            count = import_gps_photos(root, "SIM-UDID", 5, batch_size=2,
                                      timeout_seconds=7, runner=fake_runner)
            self.assertEqual(count, 5)
            self.assertEqual([len(args) - 4 for args in commands], [2, 2, 1])
            self.assertTrue(all(args[:4] == ["xcrun", "simctl", "addmedia", "SIM-UDID"]
                                for args in commands))
            imported = [Path(path).name for args in commands for path in args[4:]]
            self.assertEqual(imported,
                             [f"gps-{i:06d}.jpg" for i in range(5)])

    def test_wrong_file_count_never_invokes_simctl(self):
        with tempfile.TemporaryDirectory() as temp:
            source = self.make_source(Path(temp), 4)
            def forbidden(*args, **kwargs):
                self.fail("simctl must not be called with insufficient real JPEGs")
            with self.assertRaisesRegex(ValueError, "count mismatch"):
                import_gps_photos(source, "SIM-UDID", 5, runner=forbidden)

    def test_nonzero_simctl_is_a_hard_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            source = self.make_source(Path(temp), 2)
            def failed(args, **kwargs):
                raise subprocess.CalledProcessError(1, args, stderr="failure")
            with self.assertRaisesRegex(RuntimeError, "batch failed"):
                import_gps_photos(source, "SIM-UDID", 2, runner=failed)

    def test_timeout_does_not_invent_success(self):
        with tempfile.TemporaryDirectory() as temp:
            source = self.make_source(Path(temp), 1)
            def timed_out(args, **kwargs):
                raise subprocess.TimeoutExpired(args, 5)
            with self.assertRaisesRegex(RuntimeError, "batch timed out"):
                import_gps_photos(source, "SIM-UDID", 1, runner=timed_out)

    def test_requires_valid_simulator_and_bounded_size(self):
        with tempfile.TemporaryDirectory() as temp:
            source = self.make_source(Path(temp), 1)
            for simulator, batch_size in [("", 400), ("SIM", 0), ("SIM", 1001)]:
                with self.assertRaises(ValueError):
                    import_gps_photos(source, simulator, 1, batch_size=batch_size)


if __name__ == "__main__":
    unittest.main()
