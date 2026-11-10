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
# Short tap-adjacent samples, still not a video/FPS measurement.
TAP_FRAME_OFFSETS_SECONDS = (0.15, 0.55)
# Cover late repeated transitions, not just the first three taps.
# Bounded per test to avoid exhausting storage on rapid 16-cycle suites.
TAP_CAPTURE_NUMBERS = frozenset((1, 2, 4, 8, 12, 16))
TARGETS = {
    # Tab/source/section/sheet/background: real production native SwiftUI.
    "testRapidGalleryFilesTabOscillationPreservesBothShells",
    "testGalleryFilesAlternationRetainsNonBlankSettledFrames",
    "testFilesQuickRailAlternatingSectionsReturnsToBrowse",
    "testGallerySourcesAlternateWithoutLosingSourceRail",
    "testRepeatedFilterDismissalRestoresSameGallery",
    "testGalleryBackgroundResumeKeepsNativeSourceAndPixels",
    "testGalleryFourUnchangedForegroundCyclesPreserveWallAndPixels",
    "testGalleryDismissedFilterThenForegroundDoesNotRebuildWall",
    "testGalleryPeopleBackThenForegroundKeepsVerifiedWall",
    "testGallerySourceChangeThenUnchangedForegroundKeepsLatestGeneration",
    "testGalleryFilesRoundTripThenForegroundKeepsWallGeneration",
    "testGalleryForegroundAfterDeniedCloudFilesDoesNotLeakOrRebuild",
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
    "testDeniedChildBackgroundResumeRetainsExplicitRecoveryAndGallery",
    "testSignedOutOwnerCannotExposeCloudLocationAfterRelaunch",
    "testNoSessionCloudReturnAfterGalleryAlbumRoundtrip",
    "testNoSessionTrashReturnAfterGalleryFilterDismissal",
    "testRepeatedDeniedCloudDoesNotRenderProtectedRowsOrRetry",
    "testRepeatedDeniedTrashDoesNotRenderDestructiveRowsOrRetry",
    "testRecentShortcutNoSessionShowsReadOnlyNativeRecovery",
    "testFavoritesShortcutNoSessionShowsReadOnlyNativeRecovery",
    "testRecentAfterTrashDeniedKeepsGalleryMounted",
    "testFavoritesAfterCloudDeniedKeepsGalleryMounted",
    "testRecentFavoritesQuickRailDeniedThenAlbumsRemainUsable",
    "testRecentFavoritesRepeatedDenialsNeverRetainOldScope",
    "testRecentFavoritesErrorScreensHaveActualSimulatorEvidence",
    "testNoSessionCloudAndTrashErrorPagesAreNotSolidBlankScreens",
    "testNoSessionRecentFavoritesDeniedPagesAreNotSolidBlankScreens",
    "testNoSessionCloudTrashRapidBackDoesNotRepushOldChild",
    "testTrashDenialAcrossRepeatedForegroundActivationsStaysReadOnly",
    "testFilesQuickRailThenCloudDenialKeepsProtectedGridAbsent",
    "testCloudDenialGalleryFilterFilesReturnCanReenterDeniedChild",
    "testTrashDenialPeopleBackThenTrashDenialDoesNotLeakRows",
    "testCloudAndTrashDenialsCaptureVisibleNativeRecoveryScreens",
    "testRapidGalleryFilesAlternationKeepsBothNativeShellsAndPixels",
    "testGalleryAlbumsOriginalsAndUnifiedRoundTripsKeepPixels",
    "testGalleryFilterDismissThenFilesReturnDoesNotBlankTheWall",
    "testFilesRecentFavoritesBrowseRapidSwitchRetainsReadableRail",
    "testNoSessionCloudDenialReturnsToFilesAndGalleryWithoutBlankPage",
    "testGalleryPeopleChildBackThenFilesReturnRetainsVisualHierarchy",
}
NAV_TARGETS = {
    "testGalleryFourUnchangedForegroundCyclesPreserveWallAndPixels",
    "testGalleryDismissedFilterThenForegroundDoesNotRebuildWall",
    "testGalleryPeopleBackThenForegroundKeepsVerifiedWall",
    "testGallerySourceChangeThenUnchangedForegroundKeepsLatestGeneration",
    "testGalleryFilesRoundTripThenForegroundKeepsWallGeneration",
    "testGalleryForegroundAfterDeniedCloudFilesDoesNotLeakOrRebuild",
    "testCloudDeniedThenAlbumFilterFilesRoundTripKeepsRealShells",
    "testTrashDeniedRetryThenFilesRailAndGalleryReturnKeepsPixels",
    "testGalleryPeopleThenCloudDeniedAndGalleryReturnNoSettledBlank",
    "testRepeatedForegroundResumesAlternatingGalleryAndFilesNoBlank",
    "testLocalPhotosSourceSurvivesFilesMineAndGalleryRoundTrip",
    "testFilesSearchThenGalleryFilterAndBackKeepsBothRoutes",
    "testRecentShortcutNoSessionShowsReadOnlyNativeRecovery",
    "testFavoritesShortcutNoSessionShowsReadOnlyNativeRecovery",
    "testRecentAfterTrashDeniedKeepsGalleryMounted",
    "testFavoritesAfterCloudDeniedKeepsGalleryMounted",
    "testRecentFavoritesQuickRailDeniedThenAlbumsRemainUsable",
    "testRecentFavoritesRepeatedDenialsNeverRetainOldScope",
    "testRecentFavoritesErrorScreensHaveActualSimulatorEvidence",
    "testNoSessionCloudAndTrashErrorPagesAreNotSolidBlankScreens",
    "testNoSessionRecentFavoritesDeniedPagesAreNotSolidBlankScreens",
    "testNoSessionCloudTrashRapidBackDoesNotRepushOldChild",
    "testRapidGalleryFilesTabOscillationPreservesBothShells",
    "testRapidGalleryFilesAlternationKeepsBothNativeShellsAndPixels",
    "testGalleryAlbumsOriginalsAndUnifiedRoundTripsKeepPixels",
    "testGalleryFilterDismissThenFilesReturnDoesNotBlankTheWall",
    "testFilesRecentFavoritesBrowseRapidSwitchRetainsReadableRail",
    "testNoSessionCloudDenialReturnsToFilesAndGalleryWithoutBlankPage",
    "testGalleryPeopleChildBackThenFilesReturnRetainsVisualHierarchy",
    # Native PhotoKit route tests were previously present in the XCTest class
    # but were missing from the screenshot observer's target set.
    "testLocalPhotoGalleryFilesRoundTripsKeepRealNativePixels",
    "testLocalPhotoGalleryForegroundAndFilesReturnRemainNonBlank",
    # Each new live Gallery generation test additionally captures nearby
    # Simulator frames; screenshots are diagnostic, not a measured FPS.
    "testUnifiedWallGenerationPersistsThroughSixFilesTabRoundTrips",
    "testUnifiedWallGenerationPersistsAfterRecentFavoritesBrowseNavigation",
    "testUnifiedWallGenerationPersistsAfterFilterCancelAndFilesReturn",
    "testUnifiedWallGenerationPersistsAfterPeopleChildAndFilesReturn",
    "testUnifiedWallGenerationPersistsAfterBackgroundAndFilesReturn",
    "testUnifiedWallGenerationPersistsAfterFilesSearchSubmitAndReturn",
    "testUnifiedWallGenerationPersistsAfterDeniedCloudChildAndReturn",
}
TARGETS.update(NAV_TARGETS)
tap_start = re.compile(r"IOS_NATIVE_NAV_TAP_START route=(native-ios-[a-z0-9-]+)")
start = re.compile(r"Test Case '-\[[^\]]+\s+(test\w+)\]' started\.")
finish = re.compile(r"Test Case '-\[[^\]]+\s+(test\w+)\]' (?:passed|failed)\b")
attempts = {}
active = set()
scheduled = []
tap_scheduled = []
tap_counts = {}
current_case = None
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
                current_case = key
                began = time.monotonic()
                for index, delay in enumerate(FRAME_OFFSETS_SECONDS):
                    scheduled.append((began + delay, key, index, delay))
                continue
            tapped = tap_start.search(line)
            if (tapped and current_case in active
                    and current_case[0] in NAV_TARGETS):
                # Count ALL taps; otherwise late regression frames can never
                # be captured after three navigations, including on 8 cycles.
                count = tap_counts.get(current_case, 0) + 1
                tap_counts[current_case] = count
                if count in TAP_CAPTURE_NUMBERS:
                    now_tap = time.monotonic()
                    for frame, delay in enumerate(TAP_FRAME_OFFSETS_SECONDS):
                        tap_scheduled.append((
                            now_tap + delay, current_case, count,
                            frame, delay, tapped.group(1)
                        ))
            ended = finish.search(line)
            if ended:
                name = ended.group(1)
                for key in tuple(active):
                    if key[0] == name:
                        active.discard(key)
                        if current_case == key:
                            current_case = None

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
            }, ensure_ascii=False) + "\n")
    tap_due, tap_scheduled = (
        [entry for entry in tap_scheduled if entry[0] <= now],
        [entry for entry in tap_scheduled if entry[0] > now],
    )
    for _, key, tap_count, frame, delay, route in tap_due:
        # A stale tap cannot capture frames from the next XCTest case.
        if key not in active:
            continue
        name, count = key
        destination = output / (
            f"{name}-{count}-tap{tap_count}-{route}-frame{frame + 1}.png"
        )
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
                "test": name, "attempt": count, "route": route,
                "tap_number": tap_count, "frame": frame + 1,
                "scheduled_after_tap_seconds": delay,
                "capture_mode": "tap-adjacent",
                "captured": ok, "file": destination.name if ok else None,
            }, ensure_ascii=False) + "\n")
    # 300ms log polling is too coarse for a scheduled +150ms tap sample.
    # This improves diagnostic proximity, but simctl PNGs are NOT FPS video.
    time.sleep(0.075)
