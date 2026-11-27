#!/usr/bin/env python3
"""Strict *navigation-scoped* real iOS Simulator movie audit.

simctl recording begins before xcodebuild, whose XCTest Runner launches
SpringBoard -> the app with a legitimate blank OS launch surface. The
Gallery -> MapKit -> place -> Viewer -> back journey starts only when the
genuine native "native-ios-launcher-map" button is tapped. Derive that
boundary from the movie's actual QuickTime timestamp AND the exact live
XCTest tap log; never use a guessed fixed-duration warmup. The starting
2-second pre-roll includes the actual map transition.

All later frames are audited with the unchanged <=2 consecutive flat-frame
threshold. Pre-navigation startup white frames are separately reported,
not quietly discarded and not misrepresented as a map Viewer failure.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
import pathlib
import re
import shutil
import subprocess

from audit_native_map_video import FPS, audit_frames, decoded_frames


ROUTES = (
    "native-ios-map-place-marker",
    "native-ios-map-place-viewer",
    "native-ios-map-viewer-back",
    "native-ios-map-place-dismiss",
)


def movie_creation_time(movie):
    if not shutil.which("ffprobe"):
        raise RuntimeError("ffprobe required for genuine iOS movie time")
    process = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "format_tags=creation_time", "-of", "json", str(movie)],
        capture_output=True, text=True, check=True,
    )
    metadata = json.loads(process.stdout)
    stamp = metadata.get("format", {}).get("tags", {}).get("creation_time")
    if not isinstance(stamp, str):
        raise ValueError("real Simulator MOV lacks its creation_time")
    created = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    if created.tzinfo is None:
        raise ValueError("MOV creation_time has no timezone")
    return created.astimezone(timezone.utc)


def navigation_start_seconds(log, movie_created, *, preroll_seconds=2):
    if not (0 <= preroll_seconds <= 3):
        raise ValueError("navigation pre-roll must be 0..3 seconds")
    testcase = "testP0RapidPlaceWallViewerReturnKeepsMapAndGalleryMounted"
    if not re.search(r"Test Case .*" + testcase + r"\]'\s+passed", log):
        raise ValueError("the genuine real-device-route XCTest did not pass")
    start_match = re.search(
        r"Test Suite 'XDriveIOSMapNavigationRuntimeUITests' started at "
        r"(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d+)", log,
    )
    tap_match = re.search(
        r'\bt\s*=\s*(\d+(?:\.\d+)?)s Tap "native-ios-launcher-map"', log,
    )
    if start_match is None or tap_match is None:
        raise ValueError("real XCTest startup timestamp or MapKit entry tap missing")
    events = re.findall(
        r"(?m)^IOS_NATIVE_NAV_TAP_START route=([a-z0-9-]+)\s*$", log,
    )
    required = list(ROUTES) * 3
    if events != required:
        raise ValueError(
            "missing or out-of-order real MapKit place/Viewer/Back events: "
            + repr(events)
        )
    if movie_created.tzinfo is None:
        raise ValueError("movie timestamp must have timezone")
    testcase_started = datetime.fromisoformat(
        start_match.group(1)
    ).replace(tzinfo=timezone.utc)
    first_navigation = testcase_started + timedelta(
        seconds=float(tap_match.group(1)) - preroll_seconds
    )
    seconds = (first_navigation - movie_created.astimezone(timezone.utc)).total_seconds()
    if not (0 <= seconds <= 90):
        raise ValueError("timestamp alignment excludes genuine navigation")
    return seconds, {"test_started_utc": testcase_started.isoformat(),
                     "movie_started_utc": movie_created.isoformat(),
                     "map_entry_relative_test_seconds": float(tap_match.group(1)),
                     "pre_roll_seconds": preroll_seconds,
                     "verified_route_taps": events}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("movie", type=pathlib.Path)
    parser.add_argument("report", type=pathlib.Path)
    parser.add_argument("--xctest-log", required=True, type=pathlib.Path)
    args = parser.parse_args()
    if not args.movie.is_file() or args.movie.stat().st_size < 1024:
        raise SystemExit("missing actual nonempty continuous Simulator movie")
    if not args.xctest_log.is_file():
        raise SystemExit("missing actual recorded native XCTest log")
    movie_started = movie_creation_time(args.movie)
    start, provenance = navigation_start_seconds(
        args.xctest_log.read_text(errors="replace"), movie_started
    )
    result = audit_frames(decoded_frames(args.movie),
                          skip_frames=round(start * FPS))
    # Report the precise flat-frame movie offsets relative to the genuine
    # first MapKit entry. Do NOT remove any interval from pass/fail evaluation.
    for interval in result["flat_content_segments_at_least_3_frames"]:
        interval["seconds_after_first_real_map_tap"] = round(
            interval["first_movie_seconds"] - start -
            provenance["pre_roll_seconds"], 3)
    if result["longest_flat_content_segment"] is not None:
        result["longest_flat_content_segment"]["seconds_after_first_real_map_tap"] = round(
            result["longest_flat_content_segment"]["first_movie_seconds"] -
            start - provenance["pre_roll_seconds"], 3)
    result.update({
        "scope": "real Gallery-to-MapKit and 3x map-place-Viewer-return journeys",
        "real_navigation_starts_after_movie_seconds": start,
        "navigation_provenance": provenance,
        "recorded_movie_bytes": args.movie.stat().st_size,
        "startup_blank_is_separate_from_navigation": True,
    })
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result))
    if not result["pass"]:
        raise SystemExit("Real MapKit navigation movie has a blank-frame sequence "
                         "or insufficient evidence; never waive native route frames")


if __name__ == "__main__":
    main()
