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
# Real macOS simctl screenshots required 1.23s P50 / 5.88s P95 across
# a 24-test no-session Simulator artifact. Frames captured long after
# their scheduled +150ms slot are not valid click-adjacent evidence.
MAX_CAPTURE_LAG_SECONDS = 0.75
# Even an on-time request may take seconds before the PNG represents a
# Simulator frame. Keep the original image, but never label the sample as
# reliable tap-adjacent evidence if simctl took longer than 2.5s.
MAX_CAPTURE_DURATION_SECONDS = 2.5
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
    # New native compositional Viewer/Files/Gallery continuity journeys.
    "testLocalPhotoDateSheetThenCloudDeniedFilesReturnsLocalChild",
    "testCloudOriginalsHelpThenFilesSearchKeyboardReturnsOriginalsChild",
    "testFilesOperationHistoryThenGalleryFilterReturnsSameNativeFilesRail",
    "testFilesQuickRailLandscapeThenGalleryOriginalsPortraitKeepsChildren",
    "testSyntheticOwnerAlbumsFilesForegroundRelaunchDoesNotRetainOldScope",
    "testFilesSearchGalleryPeopleBackAndQuickRailRemainAccessible",
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
    "testLocalPhotoTimelineDateSheetDismissThenFilesReturnKeepsContent",
    "testLocalPhotoWithFilesQuickSectionsPreservesLocalChild",
    "testCloudOriginalsFilesRapidReturnKeepsNativeChild",
    "testCloudOriginalsBackgroundFilesReturnKeepsNativeChild",
    "testCloudOriginalsHelpDismissFilesReturnKeepsChild",
    "testCloudOriginalsFilesQuickSectionsReturnKeepsChild",
    "testFilesOperationHistorySheetDenialThenGalleryRetainsNativePages",
    "testFilesOperationHistoryBackgroundThenFilesGalleryReturn",
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
MINIMAL_TARGETS = {
    # One late fallback frame and one first-tap frame per previously
    # uncovered journey. This avoids sampling only launch animations while
    # bounding work compared with the dedicated multi-tap route sampler.
    "testAlbumSourceReturnThroughFilesAndMineKeepsGalleryMounted",
    "testAlternatingGalleryFilesSettledFramesAcrossThreeTabs",
    "testFilesGalleryNativeRelaunchDoesNotLoseInitialPages",
    "testFilesHomeAfterRepeatedNativeGallerySourceChanges",
    "testFilesHomeDeepScrollTabReturnKeepsQuickNavigation",
    "testFilesRecentAndFavoritesRemainAvailableAfterForegroundReturn",
    "testFilesSearchFocusThenGalleryReturnPreservesShell",
    "testGalleryAlbumSourceWithLandscapeAndTabReturn",
    "testGalleryAlbumsAndOriginalsAfterForegroundResumeKeepSourceRail",
    "testGalleryAlbumsSurviveBackgroundAndSourceRoundTrip",
    "testGalleryFilesRotateLandscapeAndReturnPortrait",
    "testGalleryFilterCancelAfterRecentFavoritesToggle",
    "testGalleryFilterCancelAfterTabAndSourceRoundTrips",
    "testGalleryPeopleAfterFilesQuickRailReturnKeepsUnifiedWall",
    "testGalleryPeopleChildReturnRepeatsWithoutLosingGallerySource",
    "testGalleryUnchangedForegroundRetainsVerifiedWallGeneration",
    "testNativeFilesQuickRailAfterLandscapeGalleryReturnNoBlank",
    "testNativeLocalGalleryMenuRouteReturnsToUnifiedSource",
    "testNativeMineGalleryFilesSwitchAfterSourceChanges",
    "testOfflineOwnerGalleryPeopleChildBackRestoresSource",
    "testSyntheticOwnerFilesAndGalleryRelaunchDoesNotRetainOldScope",
    # Native MapKit Gallery route introduced on master. Both must be seen
    # by the same bounded Simulator frame observer after branch integration.
    "testUnifiedGalleryFilterMapOpensRealSharedMapAndReturnsWithoutBlank",
    "testUnifiedSourceFilterCannotClaimUnrepresentableMapMembership",
}
TARGETS.update(NAV_TARGETS)
TARGETS.update(MINIMAL_TARGETS)
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

def report_missed(key, starts, taps):
    """A finished XCTest must not silently lose its scheduled frame evidence."""
    if not starts and not taps:
        return
    with manifest.open("a", encoding="utf-8") as stream:
        for _, _, frame, delay in starts:
            stream.write(json.dumps({
                "test": key[0], "attempt": key[1], "frame": frame + 1,
                "capture_mode": "test-start", "scheduled_after_start_seconds": delay,
                "captured": False, "file": None, "reason": "test_finished_before_capture",
            }, ensure_ascii=False) + "\n")
        for _, _, tap, frame, delay, route in taps:
            stream.write(json.dumps({
                "test": key[0], "attempt": key[1], "route": route,
                "tap_number": tap, "frame": frame + 1,
                "capture_mode": "tap-adjacent", "scheduled_after_tap_seconds": delay,
                "captured": False, "file": None, "reason": "test_finished_before_capture",
            }, ensure_ascii=False) + "\n")

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
                offsets = FRAME_OFFSETS_SECONDS[-1:] if name in MINIMAL_TARGETS else FRAME_OFFSETS_SECONDS
                for index, delay in enumerate(offsets):
                    scheduled.append((began + delay, key, index, delay))
                continue
            tapped = tap_start.search(line)
            if (tapped and current_case in active
                    and (current_case[0] in NAV_TARGETS
                         or current_case[0] in MINIMAL_TARGETS)):
                # For the 21 minimally observed routes, capture the first
                # actual navigation tap rather than a near-initial splash.
                # Dedicated routes retain their original late-tap schedule.
                count = tap_counts.get(current_case, 0) + 1
                tap_counts[current_case] = count
                minimal = current_case[0] in MINIMAL_TARGETS
                if (minimal and count == 1) or (not minimal and count in TAP_CAPTURE_NUMBERS):
                    now_tap = time.monotonic()
                    delays = (0.55,) if minimal else TAP_FRAME_OFFSETS_SECONDS
                    for frame, delay in enumerate(delays):
                        tap_scheduled.append((
                            now_tap + delay, current_case, count,
                            frame, delay, tapped.group(1)
                        ))
            ended = finish.search(line)
            if ended:
                name = ended.group(1)
                for key in tuple(active):
                    if key[0] == name:
                        missed_starts = [event for event in scheduled if event[1] == key]
                        missed_taps = [event for event in tap_scheduled if event[1] == key]
                        report_missed(key, missed_starts, missed_taps)
                        scheduled = [event for event in scheduled if event[1] != key]
                        tap_scheduled = [event for event in tap_scheduled if event[1] != key]
                        active.discard(key)
                        if current_case == key:
                            current_case = None

    now = time.monotonic()
    due, scheduled = (
        [entry for entry in scheduled if entry[0] <= now],
        [entry for entry in scheduled if entry[0] > now],
    )
    for due_at, key, index, delay in due:
        # A completed XCTest must never get screenshots of the NEXT test.
        if key not in active:
            continue
        name, count = key
        destination = output / f"{name}-{count}-frame{index + 1}.png"
        ok = False
        capture_started = time.monotonic()
        if capture_started - due_at > MAX_CAPTURE_LAG_SECONDS:
            with manifest.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps({
                    "test": name, "attempt": count, "frame": index + 1,
                    "capture_mode": "test-start",
                    "scheduled_after_start_seconds": delay,
                    "capture_request_lag_seconds": round(capture_started - due_at, 4),
                    "captured": False, "file": None,
                    "reason": "capture_deadline_missed",
                }, ensure_ascii=False) + "\n")
            continue
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
        capture_completed = time.monotonic()
        with manifest.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps({
                "test": name, "attempt": count, "frame": index + 1,
                "scheduled_after_start_seconds": delay,
                "capture_request_lag_seconds": round(max(0, capture_started - due_at), 4),
                "capture_duration_seconds": round(capture_completed - capture_started, 4),
                "capture_reliable": ok and
                    capture_completed - capture_started <= MAX_CAPTURE_DURATION_SECONDS,
                "capture_unreliable_reason": "capture_too_slow" if ok and
                    capture_completed - capture_started > MAX_CAPTURE_DURATION_SECONDS else None,
                "captured": ok, "file": destination.name if ok else None,
            }, ensure_ascii=False) + "\n")
    tap_due, tap_scheduled = (
        [entry for entry in tap_scheduled if entry[0] <= now],
        [entry for entry in tap_scheduled if entry[0] > now],
    )
    for due_at, key, tap_count, frame, delay, route in tap_due:
        # A stale tap cannot capture frames from the next XCTest case.
        if key not in active:
            continue
        name, count = key
        destination = output / (
            f"{name}-{count}-tap{tap_count}-{route}-frame{frame + 1}.png"
        )
        ok = False
        capture_started = time.monotonic()
        if capture_started - due_at > MAX_CAPTURE_LAG_SECONDS:
            with manifest.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps({
                    "test": name, "attempt": count, "route": route,
                    "tap_number": tap_count, "frame": frame + 1,
                    "capture_mode": "tap-adjacent",
                    "scheduled_after_tap_seconds": delay,
                    "capture_request_lag_seconds": round(capture_started - due_at, 4),
                    "captured": False, "file": None,
                    "reason": "capture_deadline_missed",
                }, ensure_ascii=False) + "\n")
            continue
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
        capture_completed = time.monotonic()
        with manifest.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps({
                "test": name, "attempt": count, "route": route,
                "tap_number": tap_count, "frame": frame + 1,
                "scheduled_after_tap_seconds": delay,
                "capture_mode": "tap-adjacent",
                "capture_request_lag_seconds": round(max(0, capture_started - due_at), 4),
                "capture_duration_seconds": round(capture_completed - capture_started, 4),
                "capture_reliable": ok and
                    capture_completed - capture_started <= MAX_CAPTURE_DURATION_SECONDS,
                "capture_unreliable_reason": "capture_too_slow" if ok and
                    capture_completed - capture_started > MAX_CAPTURE_DURATION_SECONDS else None,
                "captured": ok, "file": destination.name if ok else None,
            }, ensure_ascii=False) + "\n")
    # 300ms log polling is too coarse for a scheduled +150ms tap sample.
    # This improves diagnostic proximity, but simctl PNGs are NOT FPS video.
    time.sleep(0.075)
