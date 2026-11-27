#!/usr/bin/env python3
"""Audit a real iOS Simulator screen recording of repeated Map -> wall -> Viewer -> Back.

Uses actual decoded successive H.264 movie frames (not three screenshots).
The failure signature is >=3 consecutive nearly solid white/black central
app-content frames after the test's launch warm-up. This catches true blank
transitions, not wrong-photo identity (asserted by native XCTest separately).

It is NOT proof of zero transient frames between video samples, physical iPhone
60/120Hz delivery, network races, or private Apple Photos visual equivalence.
Only use the disposable CI simulator seeded with synthetic photos.
"""
import argparse
from collections import Counter
import json
import math
import pathlib
import shutil
import subprocess


WIDTH, HEIGHT, FPS = 128, 256, 30
FRAME_BYTES = WIDTH * HEIGHT * 3


def classify_frame_tone(frame):
    if len(frame) != FRAME_BYTES:
        raise ValueError("incomplete RGB frame")
    bins = Counter()
    whites = blacks = samples = 0
    # Ignore device status/home bars and side margins. Observe the native
    # content where a full-screen flash would replace the map/photo wall.
    for y in range(int(HEIGHT * 0.24), int(HEIGHT * 0.80), 3):
        for x in range(int(WIDTH * 0.18), int(WIDTH * 0.82), 3):
            p = 3 * (y * WIDTH + x)
            r, g, b = frame[p], frame[p + 1], frame[p + 2]
            bins[(r // 32, g // 32, b // 32)] += 1
            whites += r >= 244 and g >= 244 and b >= 244
            blacks += r <= 12 and g <= 12 and b <= 12
            samples += 1
    if samples < 100:
        raise ValueError("no useful content samples")
    majority = max(bins.values()) / samples
    if majority >= 0.985:
        if whites / samples >= 0.97:
            return "white"
        if blacks / samples >= 0.97:
            return "black"
    return None


def classify_frame(frame):
    # Preserve the strict bool contract for callers that classify one frame.
    return classify_frame_tone(frame) is not None


def audit_frames(frames, *, skip_frames=240, min_observed=120):
    observed = 0
    current_flat = longest_flat = flat_frames = 0
    pre_flat = pre_flat_run = longest_pre_flat = 0
    run_start = None
    run_kinds = set()
    flat_segments = []
    flat_segment_count = 0
    longest_segment = None
    last_frame_index = -1

    def record_run(end_frame):
        nonlocal flat_segment_count, longest_segment
        if run_start is None or end_frame - run_start + 1 < 3:
            return
        length = end_frame - run_start + 1
        interval = {
            "first_movie_frame_zero_based": run_start,
            "last_movie_frame_zero_based": end_frame,
            "first_movie_seconds": round(run_start / FPS, 3),
            "last_movie_seconds": round(end_frame / FPS, 3),
            "seconds_after_audit_scope_start": round(
                (run_start - skip_frames) / FPS, 3),
            "duration_frames": length,
            "duration_seconds": round(length / FPS, 3),
            "kind": next(iter(run_kinds)) if len(run_kinds) == 1 else "mixed",
        }
        flat_segment_count += 1
        if len(flat_segments) < 20:
            flat_segments.append(interval)
        if longest_segment is None or length > longest_segment["duration_frames"]:
            longest_segment = interval

    for i, frame in enumerate(frames):
        last_frame_index = i
        kind = classify_frame_tone(frame)
        flat = kind is not None
        if i < skip_frames:
            # Startup/Runner frames must be reported, never mislabeled as a
            # Gallery -> Map -> place -> Viewer transition.
            if flat:
                pre_flat += 1
                pre_flat_run += 1
                longest_pre_flat = max(longest_pre_flat, pre_flat_run)
            else:
                pre_flat_run = 0
            continue
        observed += 1
        if flat:
            flat_frames += 1
            if run_start is None:
                run_start = i
            run_kinds.add(kind)
            current_flat += 1
            longest_flat = max(longest_flat, current_flat)
        else:
            record_run(i - 1)
            run_start = None
            run_kinds.clear()
            current_flat = 0
    if run_start is not None:
        record_run(last_frame_index)
    return {
        "evidence": "consecutive decoded iOS Simulator video frames",
        "target_sample_fps": FPS,
        "physical_iphone_60_120hz_verified": False,
        "proves_zero_unobserved_flicker": False,
        "warmup_skipped_frames": skip_frames,
        "pre_journey_nearly_white_or_black_frames": pre_flat,
        "pre_journey_longest_consecutive_flat_frames": longest_pre_flat,
        "observed_frames": observed,
        "nearly_white_or_black_frames": flat_frames,
        "longest_consecutive_flat_content_frames": longest_flat,
        # Exact failing movie offsets are diagnostic evidence, not a relaxed
        # threshold or guessed "startup" exclusion.
        "flat_content_segments_at_least_3_frames": flat_segments,
        "flat_content_segment_count": flat_segment_count,
        "flat_content_segments_omitted": flat_segment_count - len(flat_segments),
        "longest_flat_content_segment": longest_segment,
        "minimum_observed_frames": min_observed,
        "max_allowed_consecutive_flat_frames": 2,
        "pass": observed >= min_observed and longest_flat <= 2,
    }


def decoded_frames(movie):
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg is required for actual H264 frame evidence")
    command = [
        "ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(movie),
        "-vf", "fps=30,scale=128:256:flags=fast_bilinear",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
    ]
    proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        assert proc.stdout is not None
        while True:
            frame = proc.stdout.read(FRAME_BYTES)
            if not frame:
                break
            if len(frame) != FRAME_BYTES:
                raise RuntimeError("truncated decoded movie frame")
            yield frame
        assert proc.stderr is not None
        stderr = proc.stderr.read().decode("utf-8", errors="replace")
        if proc.wait() != 0:
            raise RuntimeError("ffmpeg decode failed: " + stderr[-300:])
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("movie", type=pathlib.Path)
    p.add_argument("report", type=pathlib.Path)
    p.add_argument("--skip-first-seconds", type=float, default=8)
    args = p.parse_args()
    if not args.movie.is_file() or args.movie.stat().st_size < 1024:
        raise SystemExit("missing genuine nonempty Simulator video")
    if not math.isfinite(args.skip_first_seconds) or not (0 <= args.skip_first_seconds <= 30):
        raise SystemExit("invalid warmup duration")
    result = audit_frames(
        decoded_frames(args.movie),
        skip_frames=round(args.skip_first_seconds * FPS),
    )
    result["recorded_movie_bytes"] = args.movie.stat().st_size
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result))
    if not result["pass"]:
        raise SystemExit("P0 continuous Simulator movie has blank-frame sequence or insufficient evidence")


if __name__ == "__main__":
    main()
