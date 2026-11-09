#!/usr/bin/env python3
"""Capture a small number of CI-only iOS simulator frames DURING failing routes.

XCTAttachment --only-failures has returned an empty manifest when AX snapshot
queries timed out. A screenshot taken after xcodebuild exits only shows SpringBoard.
This observer watches the live XCTest log and captures real screen pixels during
the relevant tests without querying the accessibility hierarchy.

Run only in the disposable synthetic-Owner simulator harness. No real tokens,
customer photos, private Server documents or per-user devices are collected.
"""
import pathlib
import re
import subprocess
import sys
import time

simulator, log_name, output_name = sys.argv[1:4]
log = pathlib.Path(log_name)
output = pathlib.Path(output_name)
output.mkdir(parents=True, exist_ok=True)

TARGETS = {
    "testOfflineOwnerCloudFilesBackKeepsHomeAndDoesNotExit",
    "testSyntheticOwnerRecentlyDeletedReturnKeepsFilesHomeMounted",
    "testCloudFilesRepeatedOfflineRetryRetainsRecoverableChildPage",
    "testRecentlyDeletedRepeatedOfflineRetryRetainsRecoverableChildPage",
    "testGalleryPeopleAfterOfflineFilesErrorReturnHasNoSettledBlank",
    "testCloudFolderNoSessionIsSmallNativeRecoveryInsteadOfFilesList",
    "testRecentlyDeletedNoSessionDoesNotMountDestructiveRows",
    "testAlternatingDeniedCloudAndTrashChildrenKeepsHomeRail",
}
start = re.compile(r"Test Case '-\[[^\]]+\s+(test\w+)\]' started\.")
attempts = {}
scheduled = []
cursor = 0
while True:
    if log.exists():
        with log.open("r", errors="replace") as stream:
            stream.seek(cursor)
            lines = stream.readlines()
            cursor = stream.tell()
        for line in lines:
            match = start.search(line)
            if not match or match.group(1) not in TARGETS:
                continue
            name = match.group(1)
            count = attempts.get(name, 0)
            if count >= 2:
                continue
            attempts[name] = count + 1
            # The test opens the protected child ~8-10s after case start.
            # Save a frame before its AX snapshot's 120s timeout.
            scheduled.append((time.monotonic() + 12, name, count + 1))
    now = time.monotonic()
    due, scheduled = [x for x in scheduled if x[0] <= now], [
        x for x in scheduled if x[0] > now
    ]
    for _, name, count in due:
        destination = output / f"{name}-{count}.png"
        try:
            subprocess.run(
                ["xcrun", "simctl", "io", simulator, "screenshot", str(destination)],
                timeout=25, check=True, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired,
                FileNotFoundError):
            pass
    time.sleep(0.75)
