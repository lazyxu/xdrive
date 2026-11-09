#!/usr/bin/env python3
"""Capture a reproducible iOS Simulator UI hang without XCTest AX queries.

The workflow uses an ephemeral, unauthenticated synthetic Owner. This helper
does not collect app containers, login tokens, private user photos or keychain.
It copies xcodebuild's exit status unchanged and captures *only* a bounded
Simulator screenshot and native process stack if a specific UI test stalls.
"""
import argparse
import pathlib
import subprocess
import sys
import threading
import time

CASE = "testOfflineOwnerCloudFilesBackKeepsHomeAndDoesNotExit"
CAPTURE_AFTER_SECONDS = 25


def bounded(cmd, timeout):
    try:
        return subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout, check=False
        )
    except (OSError, subprocess.TimeoutExpired):
        return None


def inspect_simulator(simulator, diagnostics):
    diagnostics.mkdir(parents=True, exist_ok=True)
    (diagnostics / "hang-stage.txt").write_text(
        "ui_test=offline-owner-files-interactive-pop\n"
        "phase=XCTest waiting for target application / accessibility idle\n"
        "classification=UI stall, NOT a proven native process exit\n",
        encoding="utf-8",
    )
    screenshot = diagnostics / "offline-owner-navigation-hang.png"
    screenshot_call = bounded(
        ["xcrun", "simctl", "io", simulator, "screenshot", str(screenshot)],
        15,
    )
    if screenshot_call is None or screenshot_call.returncode != 0:
        (diagnostics / "screenshot-status.txt").write_text(
            "Simulator screenshot command failed or timed out\n",
            encoding="utf-8",
        )

    # Simulated app is a native macOS host process. Select only its exact
    # executable name, not the XCTest runner or arbitrary matching commands.
    rows = bounded(["ps", "-axo", "pid=,comm="], 5)
    if rows is None or rows.returncode != 0:
        (diagnostics / "sample-status.txt").write_text(
            "Unable to enumerate simulator app PID\n", encoding="utf-8"
        )
        return
    pids = []
    for line in rows.stdout.splitlines():
        cols = line.strip().split(None, 1)
        if len(cols) != 2 or not cols[0].isdigit():
            continue
        executable = cols[1].strip()
        if (executable == "xDriveIOS" or
                executable.endswith("/xDriveIOS.app/xDriveIOS")):
            pids.append(int(cols[0]))
    if not pids:
        (diagnostics / "sample-status.txt").write_text(
            "No running xDriveIOS PID found; check test log for process exit\n",
            encoding="utf-8",
        )
        return
    pid = max(pids)
    (diagnostics / "sample-status.txt").write_text(
        "sampled_native_process_pid=" + str(pid) + "\n",
        encoding="utf-8",
    )
    sample_path = diagnostics / "offline-owner-navigation-hang.sample.txt"
    sampled = bounded(["sample", str(pid), "5", "-file", str(sample_path)], 18)
    if sampled is None or sampled.returncode != 0:
        with (diagnostics / "sample-status.txt").open("a", encoding="utf-8") as fp:
            fp.write("Native process sample unavailable or timed out\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--simulator", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command and args.command[0] == "--" \
        else args.command
    if not command or command[0] != "xcodebuild":
        parser.error("Only xcodebuild test commands are accepted")

    out = pathlib.Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    state = {"started": None, "finished": False}
    with (out / "xcodebuild.log").open("w", encoding="utf-8") as logfile:
        proc = subprocess.Popen(
            command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1,
        )

        def stream():
            assert proc.stdout is not None
            for line in proc.stdout:
                logfile.write(line)
                logfile.flush()
                sys.stdout.write(line)
                sys.stdout.flush()
                if "Test Case " in line and CASE in line:
                    if " started." in line:
                        state["started"] = time.monotonic()
                        state["finished"] = False
                    elif " passed (" in line or " failed (" in line:
                        state["finished"] = True

        reader = threading.Thread(target=stream, daemon=True)
        reader.start()
        captured = False
        while proc.poll() is None:
            started = state["started"]
            if (not captured and started is not None and
                    not state["finished"] and
                    time.monotonic() - started >= CAPTURE_AFTER_SECONDS):
                captured = True
                print("NAV_HANG capturing external Simulator screenshot "
                      "and bounded native app sample", flush=True)
                inspect_simulator(args.simulator, out / "diagnostics")
            time.sleep(0.5)
        reader.join(timeout=5)
        return proc.returncode if proc.returncode is not None else 1


if __name__ == "__main__":
    raise SystemExit(main())
