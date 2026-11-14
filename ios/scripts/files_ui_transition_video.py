#!/usr/bin/env python3
"""Bounded real iOS Simulator Files/Gallery transition-video evidence.

watch: record *real* simctl H.264 clips while selected existing XCUITests run.
audit: decode sampled frames, reject missing tap-adjacent evidence and likely
solid-white flashes. Simulator 10 Hz samples are NOT signed-device 60/120 FPS.
No Owner data, fake media, or invented accessibility/tap events are created.
"""
import argparse
import json
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
})
CASE_START = re.compile(r"Test Case '-\[[^\]]+\s+(test\w+)\]' started\.")
CASE_END = re.compile(r"Test Case '-\[[^\]]+\s+(test\w+)\]' (?:passed|failed)\b")
TAP = re.compile(r"IOS_NATIVE_NAV_TAP_START route=(native-ios-[a-z0-9-]+)")
FRAME = re.compile(r"frame:\s*\d+.*pts_time:([0-9.]+)")
STAT = re.compile(r"lavfi\.signalstats\.(YMIN|YMAX|YAVG)=([0-9.]+)")
MAX_CLIP_SECONDS = 26
MIN_TAP_WINDOW_SECONDS = 0.55


def classify_bright_blank(frames, tap_second):
    """Only classify near-solid-white consecutive recorded frame samples."""
    sample = [f for f in frames if tap_second + 0.12 <= f["time"] <= tap_second + 1.45]
    if len(sample) < 3:
        return "missing_post_tap_frames"
    run = 0
    for f in sample:
        white = (f["ymax"] - f["ymin"] <= 6 and f["yavg"] >= 242)
        run = run + 1 if white else 0
        if run >= 2:
            return "suspected_solid_white_transition"
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
         "-vf", "fps=10,scale=64:64,signalstats,metadata=print:file=-",
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
                    stop_record(current, manifest, "test_finished")
                    current = None
        if current and time.monotonic() - current["started"] >= MAX_CLIP_SECONDS:
            stop_record(current, manifest, "bounded_timeout")
            current = None
        time.sleep(0.12)
    if current:
        stop_record(current, manifest, "watcher_shutdown")


def stop_record(current, manifest, reason):
    proc = current["process"]
    if proc.poll() is None:
        proc.send_signal(signal.SIGINT)
    try:
        code = proc.wait(timeout=14)
    except subprocess.TimeoutExpired:
        proc.kill()
        code = proc.wait(timeout=5)
    elapsed = max(0.0, time.monotonic() - current["started"])
    entry = {
        "test": current["test"], "file": current["path"].name,
        "recorded": current["path"].is_file() and current["path"].stat().st_size > 4096,
        "elapsed": round(elapsed, 3), "tap_markers": current["taps"],
        "record_exit": code, "stop_reason": reason,
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
        taps = entry.get("tap_markers")
        if not isinstance(taps, list) or not taps:
            failures.append("missing_real_tap_marker")
        frames = []
        if not failures:
            try:
                frames = read_frames(path)
            except (OSError, ValueError, subprocess.TimeoutExpired):
                failures.append("undecodable_recording")
        if frames:
            times = [f["time"] for f in frames]
            if len(times) < 12 or any(b <= a for a, b in zip(times, times[1:])):
                failures.append("insufficient_ordered_video_frames")
            if not failures:
                for tap in taps:
                    at = tap.get("at", -1) if isinstance(tap, dict) else -1
                    if not isinstance(at, (int, float)) or at < 0 or at + MIN_TAP_WINDOW_SECONDS > times[-1]:
                        failures.append("invalid_tap_timeline")
                        break
                    reason = classify_bright_blank(frames, at)
                    if reason:
                        failures.append(reason)
                        break
        audited.append({
            "test": name, "recording": entry.get("file"),
            "taps": len(taps) if isinstance(taps, list) else 0,
            "decoded_10hz_samples": len(frames), "failures": failures,
        })
    good = [x for x in audited if not x["failures"]]
    status = "pass" if len(good) >= minimum and not any(x["failures"] for x in audited) else "fail"
    result = {
        "status": status, "required_distinct_real_test_clips": minimum,
        "observed_clips": len(audited), "validated_clips": len(good),
        "frame_sampling": "ffmpeg 10 Hz decoded Simulator H264, not iPhone FPS",
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
