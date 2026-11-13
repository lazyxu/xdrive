#!/usr/bin/env python3
"""Fail candidate Simulator gates on a *new* xDriveIOS process crash report.

XCTest AX failures and unrelated iOS system process .ips files are not app crashes.
A marker created immediately before xcodebuild limits results to this job's run.
The report is metadata-only; never read or export private crash report contents.
"""
import argparse
import json
import os
import pathlib
import re

TARGET_PROCESS = 'xDriveIOS'
REPORT_EXTENSIONS = {'.ips', '.crash'}
PROCESS_FILENAME = re.compile(r'^xDriveIOS(?:[-_.]|$)', re.IGNORECASE)
PROCESS_FIELD = re.compile(rb'"(?:procName|processName)"\s*:\s*"xDriveIOS"(?=\s*[,}])', re.IGNORECASE)
PROCESS_HEADER = re.compile(rb'(?m)^Process:\s+xDriveIOS\s+\[\d+\]', re.IGNORECASE)
MAX_HEADER_BYTES = 64 * 1024


def _belongs_to_app(report):
    if PROCESS_FILENAME.match(report.name):
        return True
    # Some OS report filenames use a generic prefix, but the report header
    # still carries the exact executable. No substring/Owner/parent matching.
    with report.open('rb') as handle:
        header = handle.read(MAX_HEADER_BYTES)
    return bool(PROCESS_FIELD.search(header) or PROCESS_HEADER.search(header))


def audit(marker, roots):
    marker = pathlib.Path(marker)
    summary = {
        'process': TARGET_PROCESS,
        'status': 'not_run',
        'reports_scanned_after_marker': 0,
        'app_crash_report_count': 0,
        'app_crash_report_names': [],
        'report_roots_checked': 0,
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
        # A non-existent/incorrect crash-report root must never be evidence
        # that an iOS process did not crash. Optional roots may be absent when
        # at least one other real directory can be enumerated.
        summary['report_roots_checked'] += 1

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
                    if _belongs_to_app(path):
                        # Duplicate copies in host/Simulator folders do not
                        # imply two process crashes. The gate fails either way.
                        found.add(path.name)
                except OSError as exc:
                    summary['scan_errors'].append(type(exc).__name__)
    summary['app_crash_report_names'] = sorted(found)
    summary['app_crash_report_count'] = len(found)
    if summary['report_roots_checked'] == 0:
        summary['reason'] = 'no_crash_report_roots_accessible'
    summary['status'] = (
        'fail' if found else
        'error' if summary['scan_errors'] or summary['report_roots_checked'] == 0 else
        'pass'
    )
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--marker', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('report_roots', nargs='+')
    args = parser.parse_args(argv)
    result = audit(args.marker, args.report_roots)
    dest = pathlib.Path(args.output)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if result['status'] == 'pass':
        print(f"xDriveIOS crash audit: PASS; {result['reports_scanned_after_marker']} new reports inspected")
        return 0
    if result['status'] == 'fail':
        print('::error title=xDriveIOS process crash::New native app crash report(s) found: '
              + ', '.join(result['app_crash_report_names']))
    else:
        print('::error title=xDriveIOS crash audit incomplete::' +
              (result.get('reason') or ', '.join(result['scan_errors'])))
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
