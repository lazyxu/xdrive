#!/usr/bin/env python3
"""Import actual EXIF-GPS JPEGs into a real iOS Simulator Photos library.

Progress output is per completed, verified simctl command; an unsuccessful or
timed-out batch is never counted as imported. The later independent PHAsset
enumeration is still mandatory: command exit zero is NOT proof that PhotoKit
indexed the files.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import time
from typing import Callable


def import_gps_photos(
    source: Path,
    simulator: str,
    expected: int,
    batch_size: int = 400,
    timeout_seconds: int = 900,
    *,
    runner: Callable = subprocess.run,
    clock: Callable = time.monotonic,
) -> int:
    if not simulator or not simulator.strip():
        raise ValueError("Simulator UDID must not be empty")
    if expected <= 0 or batch_size < 1 or batch_size > 1000 or timeout_seconds < 1:
        raise ValueError("Invalid positive import count, batch size or timeout")
    if not source.is_dir():
        raise ValueError("Real GPS source directory does not exist")

    files = sorted(source.glob("gps-*.jpg"))
    if len(files) != expected or not all(x.is_file() for x in files):
        raise ValueError(
            f"Real EXIF-GPS source count mismatch: found {len(files)}, expected {expected}"
        )
    beginning = clock()
    imported = 0
    for batch_index, offset in enumerate(range(0, expected, batch_size), start=1):
        batch = files[offset:offset + batch_size]
        started = clock()
        command = ["xcrun", "simctl", "addmedia", simulator,
                   *(str(item) for item in batch)]
        try:
            runner(
                command, check=True, timeout=timeout_seconds,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            )
        except subprocess.TimeoutExpired as exc:
            print(f"MAP_P0_IMPORT_TIMEOUT batch={batch_index} "
                  f"completed_before_batch={imported} total={expected}",
                  flush=True)
            raise RuntimeError("A real simctl PhotoKit import batch timed out") from exc
        except subprocess.CalledProcessError as exc:
            print(f"MAP_P0_IMPORT_FAILED batch={batch_index} "
                  f"completed_before_batch={imported} total={expected} "
                  f"exit_code={exc.returncode}", flush=True)
            raise RuntimeError("A real simctl PhotoKit import batch failed") from exc
        imported += len(batch)
        print(
            f"MAP_P0_IMPORT_BATCH_COMPLETE batch={batch_index} "
            f"imported={imported} expected={expected} "
            f"batch_seconds={clock() - started:.3f} "
            f"total_seconds={clock() - beginning:.3f}",
            flush=True,
        )
    if imported != expected:
        raise RuntimeError("Incomplete real PhotoKit import requests")
    print(
        f"MAP_P0_REAL_EXIF_IMPORT requested={expected} imported={imported} "
        "status=simctl-accepted; independent-PHAsset-count-still-required",
        flush=True,
    )
    return imported


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", required=True, type=Path)
    parser.add_argument("--simulator", required=True)
    parser.add_argument("--count", required=True, type=int)
    parser.add_argument("--batch-size", type=int, default=400)
    parser.add_argument("--timeout-seconds", type=int, default=900)
    args = parser.parse_args()
    import_gps_photos(args.source_dir, args.simulator, args.count,
                      args.batch_size, args.timeout_seconds)


if __name__ == "__main__":
    main()
