#!/usr/bin/env python3
"""Bounded real iOS Simulator Files/Gallery transition-video evidence.

watch: record *real* simctl H.264 clips while selected existing XCUITests run.
audit: decode sampled frames, reject missing tap-adjacent evidence and likely
solid-white flashes. Simulator 30 Hz samples are NOT signed-device 60/120 FPS.
No Owner data, fake media, or invented accessibility/tap events are created.
"""
import argparse
import json
import math
import pathlib
import re
import signal
import statistics
import subprocess
import sys
import time

TARGETS = frozenset({
    "testRapidGalleryFilesTabOscillationPreservesBothShells",
    "testFilesQuickRailAlternatingSectionsReturnsToBrowse",
    "testGalleryFilesAlternationRetainsNonBlankSettledFrames",
    "testFilesRecentFavoritesBrowseRapidSwitchRetainsReadableRail",
    "testFilesOperationHistorySheetDenialThenGalleryRetainsNativePages",
    "testGalleryFilterDismissThenFilesReturnDoesNotBlankTheWall",
    "testFilesSavedSearchesRepeatedDismissalAndGalleryRoundTrips",
    "testFilesOperationHistoryThenSavedSearchesKeepsBothSheetsIndependent",
    "testFilesCloudDenialThenQuickSectionsKeepNativeContent",
    "testLocalPhotoTimelineSheetRepeatedAfterFilesReturns",
    "testGalleryPeopleRepeatedBackAndFilesReentryKeepsContent",
    "testGallerySourceFilterAndOriginalsRepeatedFilesReturn",
    "testOriginalsHelpHistoryReturnWithoutGhostAlert",
    "testHistoryForegroundAlbumsReturnWithoutGhostSheet",
    "testLocalPhotoFavoritesRecentDateAfterFilesReturn",
    "testPeopleCloudDenialPeopleReentryKeepsContent",
    "testSavedSearchFilterHistorySheetsStayIndependent",
    "testAlbumsOriginalsFilesSectionRoundTripKeepsSource",
    "testLocalPhotoGalleryFilesRoundTripsKeepRealNativePixels",
    "testCloudOriginalsFilesRapidReturnKeepsNativeChild",
    "testCloudOriginalsHelpDismissFilesReturnKeepsChild",
    "testFilesOperationHistoryBackgroundThenFilesGalleryReturn",
    "testGalleryPeopleChildBackThenFilesReturnRetainsVisualHierarchy",
    "testNoSessionCloudDenialReturnsToFilesAndGalleryWithoutBlankPage",
    "testGalleryAlbumsOriginalsAndUnifiedRoundTripsKeepPixels",
    "testLocalPhotoTimelineDateSheetDismissThenFilesReturnKeepsContent",
    "testFilterPeopleDeniedCloudReturnKeepsVerifiedGalleryGeneration",
    "testFilesHistorySavedSearchesAcrossOriginalsHaveNoGhostSheets",
    "testOriginalsHelpTrashDeniedReturnDoesNotReopenAlert",
    "testLocalPhotoDateAndFilesSavedSheetReturnKeepsPhotoKitChild",
    "testMapModalFilesCloudDenialDoesNotRemountUnifiedWall",
    "testFilesSearchKeyboardGalleryPeopleReturnHasNoGhostOverlay",
    "testFilesHomeDeepScrollTabReturnKeepsQuickNavigation",
    "testFilesSearchFocusThenGalleryReturnPreservesShell",
    "testGalleryFilesRotateLandscapeAndReturnPortrait",
    "testGalleryPeopleAfterOfflineFilesErrorReturnHasNoSettledBlank",
    "testFilesSearchThenGalleryFilterAndBackKeepsBothRoutes",
    "testFilesHomeAfterRepeatedNativeGallerySourceChanges",
    "testGallerySourcesAlternateWithoutLosingSourceRail",
    "testRepeatedFilterDismissalRestoresSameGallery",
    "testGalleryFilterCancelAfterTabAndSourceRoundTrips",
    "testGalleryPeopleChildReturnRepeatsWithoutLosingGallerySource",
    "testFilesBackgroundResumeKeepsQuickRailAndPixels",
    "testLocalPhotoGalleryForegroundAndFilesReturnRemainNonBlank",
    "testFilesMoreOrganizerGalleryReturnPreservesBrowseHome",
    "testFilesQuickRailRotationPeopleReturnKeepsNativeShell",
    "testGalleryFilterFilesHistoryForegroundKeepsWallGeneration",
    "testLocalPhotoDateSheetFilesQuickSectionsThenReopen",
    "testGalleryMapFilesSavedSearchesReturnKeepsGeneration",
    "testGalleryPeopleFiltersFilesTrashDenialReturnWithoutGhost",
    "testFilesTrashDenialQuickRailBounceDoesNotReviveError",
    "testFilesSavedSearchesForegroundGalleryReturnTwoCycles",
    "testFilesHistoryForegroundGalleryPeopleBackRetiresSheet",
    "testGalleryMapRotateFilesReturnPreservesWallGeneration",
    "testGalleryOriginalsFilesCloudErrorSourceReturnKeepsSurface",
    "testLocalPhotoDateRotateFilesHistoryReturnsRealPhotoKit",
    "testFilesSizeFilterHorizontalGalleryReturn",
    "testFilesDateThenSizeFiltersKeepNoSessionGuard",
    "testFilesSizeFilterAfterQuickRailReentry",
    "testFilesSizeFilterAfterSavedSearchesDismiss",
    "testFilesSizeFilterAfterCloudDenialReturn",
    "testFilesSizeFilterAfterForegroundResume",
})
CASE_START = re.compile(r"Test Case '-\[[^\]]+\s+(test\w+)\]' started\.")
CASE_END = re.compile(r"Test Case '-\[[^\]]+\s+(test\w+)\]' (passed|failed)\b")
TAP = re.compile(r"IOS_NATIVE_NAV_TAP_START route=(native-ios-[a-z0-9-]+)")
FRAME = re.compile(r"frame:\s*\d+.*pts_time:([0-9.]+)")
STAT = re.compile(r"lavfi\.signalstats\.(YMIN|YMAX|YAVG)=([0-9.]+)")
# Genuine 2026-11-16 macOS XCTest evidence: the PhotoKit/Gallery↔Files
# round-trip PASSED after 138.545 seconds, yet the original 120-second
# recorder cutoff marked its real clip "bounded_timeout". Allow both that
# long-running test and up to ~20 seconds of recorder startup while keeping
# a strict finite deadline; neither a timed-out recording nor missing tap/
# decoded frames can ever pass the audit.
MAX_CLIP_SECONDS = 210
# 2026-11-18 actual macOS run 44214388579: 73.006s from watcher spawn
# to stop, but only 51.033s of genuine decoded 30Hz MP4 frames. That is a
# measured 21.973s asynchronous recordVideo startup, not a missing testcase,
# missing tap, or a compositor flash. The first of 10 native taps occurs at
# 36.765s (14.792s into the video); all have >=7 pre-tap and 43 post-tap
# frames, independently decoded with the unchanged white/black/neutral gate.
# Allow that measured startup with a <2.1s margin; still reject missing
# pre-/post-tap frames, recorder failures, incomplete clips and >24s drift.
# This is an evidence-clock bound, NOT a longer XCTest timeout or a skip.
MAX_TIMELINE_STARTUP_SECONDS = 24
MIN_TAP_WINDOW_SECONDS = 0.55


def classify_bright_blank(frames, tap_second):
    """Fail closed on short neutral-content blinks and missing decoded frames.

    The center crop excludes persistent top/bottom native chrome: a real child
    viewport can become uniformly *gray* even when the overall screenshot
    never turns white or black. Time is recorded-video PTS, aligned by audit().
    A uniform frame is suspicious evidence, not proof of an app-process crash
    or signed-device 60/120-Hz hitch performance.
    """
    sample = [f for f in frames
              if tap_second + 0.02 <= f["time"] <= tap_second + 1.45]
    if len(sample) < 3:
        return "missing_post_tap_frames"

    # Prioritize visible blank pixels when both a flash and timestamp defect
    # are present; the audit still fails regardless of which was first.
    for f in sample:
        spread = f["ymax"] - f["ymin"]
        # ffmpeg signalstats uses limited-range YUV: white=235, black=16.
        if spread <= 6 and f["yavg"] >= 230:
            return "suspected_solid_white_transition"
        if spread <= 6 and f["yavg"] <= 26 and f["ymax"] <= 32:
            return "suspected_solid_black_transition"

    # Merely finding three late frames was a false PASS: the first half-second
    # after a tap may have been dropped by the recorder. A real 30Hz video
    # produces many samples; these generous tolerances allow timestamp jitter
    # and the coarser 10Hz unit-test fixtures without blessing a 0.4s hole.
    if sample[0]["time"] - tap_second > 0.32:
        return "missing_immediate_post_tap_frames"
    # Check *every* adjacent sample, including the boundary from one
    # initially decoded frame to a much later frame. Restricting both ends
    # to an "early" sub-window silently accepted that entire missing gap.
    if any(b["time"] - a["time"] > 0.24
           for a, b in zip(sample, sample[1:])):
        return "sparse_early_transition_frames"

    def neutral(f):
        return (f["ymax"] - f["ymin"] <= 6
                and 26 < f["yavg"] < 230)

    # A sustained flat child viewport, even in a neutral gray, is not
    # acceptable evidence of a smoothly populated Gallery or Files page.
    if all(neutral(f) for f in sample):
        return "suspected_solid_neutral_transition"

    # A one- or two-frame flat pulse between textured page frames is equally
    # visible. Require surrounding textured evidence (from the preceding
    # native page or the returning child) to avoid flagging a stationary
    # legitimate empty-state background as a transient flash.
    old_texture = any(
        tap_second - 0.30 <= f["time"] < tap_second and
        f["ymax"] - f["ymin"] > 12 for f in frames
    )
    pos = 0
    while pos < len(sample):
        if not neutral(sample[pos]):
            pos += 1
            continue
        first = pos
        while pos < len(sample) and neutral(sample[pos]):
            pos += 1
        last = pos - 1
        before = first > 0 and sample[first - 1]["ymax"] - sample[first - 1]["ymin"] > 12
        after = pos < len(sample) and sample[pos]["ymax"] - sample[pos]["ymin"] > 12
        duration = sample[last]["time"] - sample[first]["time"]
        if duration <= 0.35 and (before or old_texture) and after:
            return "suspected_solid_neutral_transition"
        # A child that goes blank gray and never repaints is also a regression.
        if before and pos == len(sample) and len(sample) - first >= 3:
            return "suspected_solid_neutral_transition"

    return None


def parse_signalstats(stdout):
    frames = []
    current = None
    for line in stdout.splitlines():
        match = FRAME.search(line)
        if match:
            if current and all(k in current for k in ("ymin", "ymax", "yavg")):
                frames.append(current)
            current = {"time": float(match.group(1))}
            continue
        match = STAT.search(line)
        if match and current is not None:
            current[match.group(1).lower()] = float(match.group(2))
    if current and all(k in current for k in ("ymin", "ymax", "yavg")):
        frames.append(current)
    return frames


def read_frames(path):
    p = subprocess.run(
        ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
         "-i", str(path),
         # Observe the actual page content: a stable native navigation bar
         # and bottom tab rail can conceal a child-only white/black flash in
         # whole-screen luminance, so exclude both persistent chrome regions.
         "-vf", "fps=30,scale=64:64,crop=64:40:0:12,signalstats,metadata=print:file=-",
         "-an", "-f", "null", "-"],
        capture_output=True, text=True, timeout=80,
    )
    if p.returncode:
        raise ValueError("recorded_video_unreadable")
    return parse_signalstats(p.stdout)


def watch(simulator, log_path, directory):
    directory.mkdir(parents=True, exist_ok=True)
    manifest = directory / "clips.jsonl"
    running = True

    def shutdown(_signal, _frame):
        nonlocal running
        running = False

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    cursor = 0
    current = None
    seen = set()
    # The actual Xcode job owns this watcher. Never fabricate a recording
    # when XCTest did not announce a real target test start.
    while running:
        if log_path.exists():
            with log_path.open("r", encoding="utf-8", errors="replace") as handle:
                handle.seek(cursor)
                lines = handle.readlines()
                cursor = handle.tell()
            for line in lines:
                started = CASE_START.search(line)
                finished = CASE_END.search(line)
                if started and started.group(1) in TARGETS and current is None:
                    name = started.group(1)
                    if name not in seen:
                        seen.add(name)
                        dest = directory / (name + ".mp4")
                        proc = subprocess.Popen(
                            ["xcrun", "simctl", "io", simulator, "recordVideo",
                             "--codec=h264", str(dest)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                        )
                        current = {"test": name, "path": dest, "started": time.monotonic(),
                                   "process": proc, "taps": []}
                hit = TAP.search(line)
                if hit and current:
                    elapsed = max(0.0, time.monotonic() - current["started"])
                    current["taps"].append({"route": hit.group(1), "at": elapsed})
                if finished and current and finished.group(1) == current["test"]:
                    stop_record(current, manifest, "test_finished", outcome=finished.group(2))
                    current = None
        if current and time.monotonic() - current["started"] >= MAX_CLIP_SECONDS:
            stop_record(current, manifest, "bounded_timeout")
            current = None
        time.sleep(0.12)
    if current:
        stop_record(current, manifest, "watcher_shutdown")


def stop_record(current, manifest, reason, outcome=None):
    proc = current["process"]
    stopped_at = time.monotonic()
    if proc.poll() is None:
        proc.send_signal(signal.SIGINT)
    try:
        code = proc.wait(timeout=14)
    except subprocess.TimeoutExpired:
        proc.kill()
        code = proc.wait(timeout=5)
    elapsed = max(0.0, stopped_at - current["started"])
    entry = {
        "test": current["test"], "file": current["path"].name,
        "recorded": current["path"].is_file() and current["path"].stat().st_size > 4096,
        "elapsed": round(elapsed, 3), "tap_markers": current["taps"],
        "record_exit": code, "stop_reason": reason, "test_outcome": outcome,
    }
    with manifest.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(entry, ensure_ascii=False) + "\n")
        stream.flush()


def audit(directory, report, minimum):
    entries = []
    manifest = directory / "clips.jsonl"
    if manifest.is_file():
        for line in manifest.read_text(encoding="utf-8").splitlines():
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict) and value.get("test") in TARGETS:
                entries.append(value)
    seen = set()
    audited = []
    for entry in entries:
        name = entry["test"]
        failures = []
        if name in seen:
            failures.append("duplicate_test_clip")
        seen.add(name)
        path = directory / (name + ".mp4")
        if path.name != entry.get("file") or not path.is_file() or not entry.get("recorded"):
            failures.append("missing_real_recording")
        # A playable clip from a failed or truncated XCTest is not success.
        if entry.get("test_outcome") != "passed":
            failures.append("test_not_passed")
        if entry.get("stop_reason") != "test_finished":
            failures.append("incomplete_test_recording")
        if entry.get("record_exit") != 0:
            failures.append("recording_process_failed")
        taps = entry.get("tap_markers")
        if not isinstance(taps, list) or not taps:
            failures.append("missing_real_tap_marker")
        elif any(
            not isinstance(tap, dict) or
            not isinstance(tap.get("route"), str) or
            not re.fullmatch(r"native-ios-[a-z0-9-]+", tap["route"])
            for tap in taps
        ):
            failures.append("invalid_native_tap_marker")
        frames = []
        if not failures:
            try:
                frames = read_frames(path)
            except (OSError, ValueError, subprocess.TimeoutExpired):
                failures.append("undecodable_recording")
        # An empty decoder result must never be accepted as a green gate.
        # A playable header is not evidence of any actually decoded frames.
        if not frames and not failures:
            failures.append("missing_decoded_video_frames")
        capture_offset = None
        if frames:
            # Corrupt frame metadata must not turn into an apparent no-flicker
            # pass (NaN comparisons are false, and impossible YUV values can
            # evade the uniform-white/black classifier).
            if any(
                not all(
                    isinstance(f.get(k), (int, float)) and math.isfinite(f[k])
                    for k in ("time", "ymin", "ymax", "yavg")
                ) or f["time"] < 0 or
                not (0 <= f["ymin"] <= f["yavg"] <= f["ymax"] <= 255)
                for f in frames
            ):
                failures.append("invalid_frame_signalstats")
            times = [f.get("time", -1) for f in frames]
            if len(times) < 12 or any(b <= a for a, b in zip(times, times[1:])):
                failures.append("insufficient_ordered_video_frames")
            # recordVideo starts encoding asynchronously, so monotonic tap
            # times include startup latency that MP4 presentation times omit.
            # Align to the recorder stop instant; reject implausible drift.
            elapsed = entry.get("elapsed")
            if not isinstance(elapsed, (int, float)) or not math.isfinite(elapsed) or elapsed <= 0:
                failures.append("invalid_recording_elapsed")
            elif not failures:
                estimated_startup = elapsed - times[-1]
                if estimated_startup < -0.5 or estimated_startup > MAX_TIMELINE_STARTUP_SECONDS:
                    failures.append("unreliable_recording_clock_alignment")
                else:
                    capture_offset = max(0.0, estimated_startup)
            if not failures:
                for tap in taps:
                    at = tap.get("at", -1) if isinstance(tap, dict) else -1
                    if not isinstance(at, (int, float)) or not math.isfinite(at) or at < 0:
                        failures.append("invalid_tap_timeline")
                        break
                    tap_pts = at - capture_offset
                    if tap_pts < 0.25:
                        failures.append("missing_pre_tap_frames")
                        break
                    if tap_pts + MIN_TAP_WINDOW_SECONDS > times[-1]:
                        failures.append("invalid_tap_timeline")
                        break
                    # Require two real decoded old-page frames before the
                    # aligned tap; a plausible clip header is not evidence.
                    if sum(tap_pts - 0.25 <= f["time"] < tap_pts for f in frames) < 2:
                        failures.append("missing_pre_tap_frames")
                        break
                    reason = classify_bright_blank(frames, tap_pts)
                    if reason:
                        failures.append(reason)
                        break
        audited.append({
            "test": name, "recording": entry.get("file"),
            "taps": len(taps) if isinstance(taps, list) else 0,
            "decoded_30hz_samples": len(frames), "failures": failures,
            "estimated_recording_startup_seconds": (
                round(capture_offset, 3) if capture_offset is not None else None
            ),
        })
    good = [x for x in audited if not x["failures"]]
    status = "pass" if (
        1 <= minimum <= len(TARGETS) and len(good) >= minimum and
        not any(x["failures"] for x in audited)
    ) else "fail"
    result = {
        "status": status, "required_distinct_real_test_clips": minimum,
        "observed_clips": len(audited), "validated_clips": len(good),
        "frame_sampling": "ffmpeg 30 Hz decoded Simulator H264, not iPhone FPS",
        "frame_region": "central 62.5% of native page; top/bottom chrome excluded",
        "timeline_alignment": "estimated monotonic stop minus last decoded MP4 PTS; reject uncertain clocks",
        "physical_60_120_hz_verified": False,
        "authorized_owner_media_verified": False,
        "clips": audited,
    }
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n",
                      encoding="utf-8")
    return status == "pass"


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="command", required=True)
    w = sub.add_parser("watch")
    w.add_argument("simulator")
    w.add_argument("log", type=pathlib.Path)
    w.add_argument("output", type=pathlib.Path)
    a = sub.add_parser("audit")
    a.add_argument("output", type=pathlib.Path)
    a.add_argument("report", type=pathlib.Path)
    a.add_argument("--minimum", type=int, default=4)
    args = p.parse_args()
    if args.command == "watch":
        watch(args.simulator, args.log, args.output)
    elif not audit(args.output, args.report, args.minimum):
        raise SystemExit("Missing or questionable actual Files transition video evidence")


if __name__ == "__main__":
    main()
