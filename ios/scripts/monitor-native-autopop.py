#!/usr/bin/env python3
"""Source-pinned Simulator native-pop test with external hang evidence.

A targeted, external watchdog captures a screenshot and a bounded process
sample ONLY when a test exceeds its deadline. It does not suppress failures,
fake UI actions, access containers or read Keychain/Photos.
"""
import argparse
import pathlib
import subprocess
import sys
import threading
import time

CASE = "testNativeAutoPopReturnsHomeWithoutXCUISwipe"


def execute(cmd, timeout):
    try:
        return subprocess.run(cmd, capture_output=True, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return None


def capture(sim, output):
    output.mkdir(parents=True, exist_ok=True)
    (output / "capture-reason.txt").write_text(
        "Native auto-pop UI test exceeded 25 seconds. "
        "A delayed XCTest query does NOT prove an app crash.\n",
        encoding="utf-8"
    )
    snap = output / "native-autopop-while-stalled.png"
    result = execute(["xcrun", "simctl", "io", sim, "screenshot", str(snap)], 18)
    if result is None or result.returncode:
        (output / "screenshot-failed.txt").write_text(
            "Unable to capture Simulator screenshot\n", encoding="utf-8"
        )
    ps = execute(["ps", "-axo", "pid=,comm="], 8)
    if ps is None or ps.returncode:
        return
    candidates = []
    for line in ps.stdout.decode(errors="replace").splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) == 2 and parts[0].isdigit():
            exe = parts[1].strip()
            if exe == "xDriveIOS" or exe.endswith("/xDriveIOS.app/xDriveIOS"):
                candidates.append(int(parts[0]))
    if not candidates:
        (output / "process-status.txt").write_text(
            "No live xDriveIOS process found at capture time\n", encoding="utf-8"
        )
        return
    pid = max(candidates)
    (output / "process-status.txt").write_text(
        "live_simulator_pid=" + str(pid) + "\n", encoding="utf-8"
    )
    sample = execute(
        ["sample", str(pid), "5", "-file", str(output / "native-autopop.sample.txt")], 20
    )
    if sample is None or sample.returncode:
        with (output / "process-status.txt").open("a", encoding="utf-8") as f:
            f.write("sample unavailable\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sim", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    opts = parser.parse_args()
    cmd = opts.command[1:] if opts.command and opts.command[0] == "--" \
        else opts.command
    if not cmd or cmd[0] != "xcodebuild":
        parser.error("This watcher only runs xcodebuild")
    out = pathlib.Path(opts.output)
    out.mkdir(parents=True, exist_ok=True)
    target_started = None
    target_finished = False
    seen_capture = False
    with (out / "xcodebuild.log").open("w", encoding="utf-8") as log:
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1
        )

        def stream():
            nonlocal target_started, target_finished
            assert proc.stdout is not None
            for line in proc.stdout:
                log.write(line)
                log.flush()
                sys.stdout.write(line)
                sys.stdout.flush()
                if "Test Case " in line and CASE in line:
                    if " started." in line:
                        target_started = time.monotonic()
                        target_finished = False
                    elif " passed (" in line or " failed (" in line:
                        target_finished = True

        worker = threading.Thread(target=stream, daemon=True)
        worker.start()
        while proc.poll() is None:
            if (not seen_capture and target_started is not None and
                    not target_finished and time.monotonic() - target_started > 25):
                seen_capture = True
                print("NATIVE_AUTOPOP_CAPTURE: collecting external screenshot and sample",
                      flush=True)
                capture(opts.sim, out / "diagnostics")
            time.sleep(0.5)
        worker.join(timeout=8)
        return proc.returncode if proc.returncode is not None else 1


if __name__ == "__main__":
    raise SystemExit(main())
