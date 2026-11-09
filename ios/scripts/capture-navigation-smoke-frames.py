#!/usr/bin/env python3
"""Capture time-scoped iOS Simulator frames during real native navigation tests.

A settled screenshot plus an accessible tab rail cannot rule out a brief blank
content frame while switching child routes. Collect several actual Simulator
frames per selected test, rather than just one after the app has settled.
This is diagnostic evidence, NOT a 60/120fps pass or a signed-device result.

Run only in the disposable CI synthetic-Owner simulator. No real tokens,
customer photos, private Server documents or physical devices are collected.
"""
import json
import pathlib
import re
import subprocess
import sys
import time

if len(sys.argv) != 4:
    raise SystemExit("usage: capture-navigation-smoke-frames.py SIM LOG OUT_DIR")
simulator, log_name, output_name = sys.argv[1:4]
log = pathlib.Path(log_name)
output = pathlib.Path(output_name)
output.mkdir(parents=True, exist_ok=True)

# Capture several moments after route start. High-frequency video tracing and
# physically measured FPS remain separate from these low-overhead stills.
FRAME_OFFSETS_SECONDS = (0.5, 1.5, 3.5)
TARGETS = {
    # Tab/source/section/sheet/background: real production native SwiftUI.
    "testRapidGalleryFilesTabOscillationPreservesBothShells",
    "testGalleryFilesAlternationRetainsNonBlankSettledFrames",
    "testFilesQuickRailAlternatingSectionsReturnsToBrowse",
    "testGallerySourcesAlternateWithoutLosingSourceRail",
    "testRepeatedFilterDismissalRestoresSameGallery",
    "testGalleryBackgroundResumeKeepsNativeSourceAndPixels",
    "testFilesBackgroundResumeKeepsQuickRailAndPixels",
    "testLocalPhotoSourceRetainsGalleryAfterFilesForegroundRoundtrip",
    # Denied children: capture before AX snapshots that may hang.
    "testOfflineOwnerCloudFilesBackKeepsHomeAndDoesNotExit",
    "testSyntheticOwnerRecentlyDeletedReturnKeepsFilesHomeMounted",
    "testCloudFilesRepeatedOfflineRetryRetainsRecoverableChildPage",
    "testRecentlyDeletedRepeatedOfflineRetryRetainsRecoverableChildPage",
    "testGalleryPeopleAfterOfflineFilesErrorReturnHasNoSettledBlank",
    "testCloudFolderNoSessionIsSmallNativeRecoveryInsteadOfFilesList",
    "testRecentlyDeletedNoSessionDoesNotMountDestructiveRows",
    "testAlternatingDeniedCloudAndTrashChildrenKeepsHomeRail",
    "testRecentShortcutNoSessionShowsRecoverableNativeChild",
    "testFavoritesShortcutNoSessionShowsRecoverableNativeChild",
    "testRecentAfterTrashDeniedReturnKeepsGalleryAvailable",
    "testFavoritesAfterCloudDeniedReturnKeepsGalleryAvailable",
}
start = re.compile(r"Test Case '-\\[[^\\]]+\\s+(test\\w+)\\]' started\\.")
finish = re.compile(r"Test Case '-\\[[^\\]]+\\s+(test\\w+)\\]' (?:passed|failed)\\b")
attempts = {}
active = set()
scheduled = []
cursor = 0
manifest = output / "frame-trace.jsonl"

while True:
    if log.exists():
        with log.open("r", errors="replace") as stream:
            stream.seek(cursor)
            lines = stream.readlines()
            cursor = stream.tell()
        for line in lines:
            match = start.search(line)
            if match and match.group(1) in TARGETS:
                name = match.group(1)
                count = attempts.get(name, 0)
                if count >= 2:
                    continue
                count += 1
                attempts[name] = count
                key = (name, count)
                active.add(key)
                began = time.monotonic()
                for index, delay in enumerate(FRAME_OFFSETS_SECONDS):
                    scheduled.append((began + delay, key, index, delay))
                continue
            ended = finish.search(line)
            if ended:
                name = ended.group(1)
                for key in tuple(active):
                    if key[0] == name:
                        active.discard(key)

    now = time.monotonic()
    due, scheduled = (
        [entry for entry in scheduled if entry[0] <= now],
        [entry for entry in scheduled if entry[0] > now],
    )
    for _, key, index, delay in due:
        # A completed XCTest must never get screenshots of the NEXT test.
        if key not in active:
            continue
        name, count = key
        destination = output / f"{name}-{count}-frame{index + 1}.png"
        ok = False
        try:
            subprocess.run(
                ["xcrun", "simctl", "io", simulator, "screenshot", str(destination)],
                timeout=25, check=True, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            ok = True
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired,
                FileNotFoundError):
            pass
        with manifest.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps({
                "test": name, "attempt": count, "frame": index + 1,
                "scheduled_after_start_seconds": delay,
                "captured": ok, "file": destination.name if ok else None,
            }, ensure_ascii=False) + "\\n")
    time.sleep(0.3)
