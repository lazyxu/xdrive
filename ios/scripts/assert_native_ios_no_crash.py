#!/usr/bin/env python3
"""Fail candidate Simulator gates on a *new* xDriveIOS process crash report.

XCTest AX failures and unrelated iOS system process .ips files are not app crashes.
A marker created immediately before xcodebuild limits results to this job's run.
The report is metadata-only; never read or export private crash report contents.
A genuine XCTest lost-application connection is INCONCLUSIVE without an app
crash report: never call it a proved process crash or a clean pass.
"""
import argparse
import json
import os
import pathlib
import re

TARGET_PROCESS = 'xDriveIOS'
REPORT_EXTENSIONS = {'.ips', '.crash'}
PROCESS_FILENAME = re.compile(r'^xDriveIOS(?:[-_.]|$)', re.IGNORECASE)
# The OS-declared process overrides a similar-looking crash filename.
# Capture the exact executable name; a helper named xDriveIOS-Helper is NOT
# a confirmed xDriveIOS SIGSEGV. A contradictory filename/header is inconclusive.
PROCESS_FIELD = re.compile(rb'"(?:procName|processName)"\s*:\s*"([^"\r\n]+)"(?=\s*[,}])', re.IGNORECASE)
PROCESS_HEADER = re.compile(rb'(?m)^Process:\s+([^\s\[]+)\s+\[\d+\]', re.IGNORECASE)
MAX_HEADER_BYTES = 64 * 1024
# Only real XCTest failure lines from the xDrive iOS app UI test target are
# evidence of losing the target process. A generic "lost connection" warning
# in unrelated system tests or a source code comment is not enough.
# Xcode sometimes wraps an XCTest app-disconnect diagnostic across lines.
# Recognize only a real native XCTest error plus at most two indented
# continuation lines. Standalone console strings do not prove a crash.
APP_XCTEST_ERROR_START = re.compile(
    r'(?m)^.*?\.swift:\d+:\s+error:\s+-\[xDriveIOSNavigationUITests\.[^\]\n]+\]\s*:'
)
APP_XCTEST_CONNECTION_LOST = re.compile(
    r'Lost connection to the application \(pid \d+\)'
)
MAX_APP_ERROR_CONTINUATION_LINES = 2


def _app_disconnections(log_path, since_ns, scan_errors):
    if log_path is None:
        return 0
    path = pathlib.Path(log_path)
    try:
        if not path.is_file():
            scan_errors.append('xcodebuild_log_missing')
            return 0
        if path.stat().st_mtime_ns < since_ns:
            scan_errors.append('xcodebuild_log_predates_test_marker')
            return 0
        # Read the existing local xcodebuild log; only metadata counts are
        # exported. This is not a replacement for checking original .ips files.
        with path.open('r', encoding='utf-8', errors='replace') as stream:
            count = 0
            event = ''
            continued = 0
            for line in stream:
                if APP_XCTEST_ERROR_START.search(line):
                    event = line.rstrip('\r\n')
                    continued = 0
                elif event and continued < MAX_APP_ERROR_CONTINUATION_LINES and line[:1] in (' ', '\t'):
                    event += ' ' + line.strip()
                    continued += 1
                else:
                    event = ''
                    continued = 0
                if event and APP_XCTEST_CONNECTION_LOST.search(event):
                    count += 1
                    event = ''
                    continued = 0
            return count
    except OSError as exc:
        scan_errors.append('xcodebuild_log_' + type(exc).__name__)
        return 0


def _belongs_to_app(report, scan_errors=None):
    filename_matches = bool(PROCESS_FILENAME.match(report.name))
    # Always read a bounded OS header: a filename that resembles xDriveIOS
    # can belong to an extension or helper. Never confirm an app crash when
    # the declared executable is different.
    with report.open('rb') as handle:
        header = handle.read(MAX_HEADER_BYTES)
    declared = PROCESS_FIELD.search(header) or PROCESS_HEADER.search(header)
    if declared is not None:
        matches = declared.group(1).lower() == TARGET_PROCESS.lower().encode('ascii')
        if filename_matches and not matches and scan_errors is not None:
            # Do not call a contradictory report a clean run either.
            scan_errors.append('report_process_identity_conflict')
        return matches
    # An xDriveIOS-prefixed but unreadable/truncated report still fails closed.
    return filename_matches


def audit(marker, roots, xcodebuild_log=None):
    marker = pathlib.Path(marker)
    summary = {
        'process': TARGET_PROCESS,
        'status': 'not_run',
        'reports_scanned_after_marker': 0,
        'available_report_roots': 0,
        'app_crash_report_count': 0,
        'app_crash_report_names': [],
        'app_connection_lost_count': 0,
        'scan_errors': [],
    }
    if not marker.is_file():
        summary['reason'] = 'xcodebuild_start_marker_missing'
        return summary
    since_ns = marker.stat().st_mtime_ns
    found = set()
    for root in roots:
        root = pathlib.Path(root)
        if not root.is_dir():
            continue
        summary['available_report_roots'] += 1

        def onerror(exc):
            summary['scan_errors'].append(type(exc).__name__)

        for folder, _subfolders, filenames in os.walk(root, onerror=onerror, followlinks=False):
            for name in filenames:
                path = pathlib.Path(folder) / name
                if path.suffix.lower() not in REPORT_EXTENSIONS:
                    continue
                try:
                    if not path.is_file() or path.stat().st_mtime_ns < since_ns:
                        continue
                    summary['reports_scanned_after_marker'] += 1
                    if _belongs_to_app(path, summary['scan_errors']):
                        # Duplicate copies in host/Simulator folders do not
                        # imply two process crashes. The gate fails either way.
                        found.add(path.name)
                except OSError as exc:
                    summary['scan_errors'].append(type(exc).__name__)
    # A fresh Runner or invalid simulator ID can make every diagnostics path
    # unavailable. Missing evidence is not proof that the app stayed alive.
    if summary['available_report_roots'] == 0:
        summary['scan_errors'].append('no_crash_report_roots_available')
    summary['app_crash_report_names'] = sorted(found)
    summary['app_crash_report_count'] = len(found)
    summary['app_connection_lost_count'] = _app_disconnections(
        xcodebuild_log, since_ns, summary['scan_errors']
    )
    if summary['app_connection_lost_count'] and not found:
        summary['scan_errors'].append('xctest_app_disconnected_without_crash_report')
    # Fail only on a real matching app report. Lost AX process connection is
    # inconclusive; never promote it to a confirmed SIGSEGV or a clean pass.
    summary['status'] = ('fail' if found else 'error' if summary['scan_errors'] else 'pass')
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--marker', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--xcodebuild-log', help='Original exact-run XCTest output')
    parser.add_argument('report_roots', nargs='+')
    args = parser.parse_args(argv)
    result = audit(args.marker, args.report_roots, xcodebuild_log=args.xcodebuild_log)
    dest = pathlib.Path(args.output)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if result['status'] == 'pass':
        print(f"xDriveIOS crash audit: PASS; {result['reports_scanned_after_marker']} new reports inspected")
        return 0
    if result['status'] == 'fail':
        print('::error title=xDriveIOS process crash::New native app crash report(s) found: '
              + ', '.join(result['app_crash_report_names']))
    elif result['app_connection_lost_count']:
        print('::error title=xDriveIOS process survival unverified::'
              'XCTest lost the app connection without a matching crash report; '
              'inspect original xcresult and iOS termination logs')
    else:
        print('::error title=xDriveIOS crash audit incomplete::' +
              (result.get('reason') or ', '.join(result['scan_errors'])))
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
