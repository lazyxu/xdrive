#!/usr/bin/env python3
"""Bounded real Simulator video evidence for native Gallery/Files transitions.

Recording and encoded frame timestamps are NOT 60/120Hz device FPS or proof of
zero flicker. Run only in isolated CI without authenticated private Owner media.
"""
import argparse
import json
import math
import pathlib
import re
import signal
import statistics
import subprocess
import time

TEST_ROUTES = {
    'testRapidGalleryFilesTabOscillationPreservesBothShells': 'gallery-files-tabs',
    'testFilesRecentFavoritesBrowseRapidSwitchRetainsReadableRail': 'files-quick-sections',
    'testLocalPhotoTimelineDateSheetDismissThenFilesReturnKeepsContent': 'local-date-sheet',
    'testCloudOriginalsHelpDismissFilesReturnKeepsChild': 'cloud-originals',
    'testFilesOperationHistorySheetDenialThenGalleryRetainsNativePages': 'operations-gallery',
    'testGalleryFilesRotateLandscapeAndReturnPortrait': 'rotate-return',
    'testSyntheticOwnerFilesAndGalleryRelaunchDoesNotRetainOldScope': 'owner-relaunch',
    'testFilesSearchThenGalleryFilterAndBackKeepsBothRoutes': 'search-filter-return',
    'testGalleryFilesAlternationRetainsNonBlankSettledFrames': 'gallery-files-nonblank',
    'testGalleryFilterCancelAfterTabAndSourceRoundTrips': 'gallery-filter-tabs',
    'testFilesQuickRailAlternatingSectionsReturnsToBrowse': 'files-rail-alternating',
    'testNativeFilesQuickRailAfterLandscapeGalleryReturnNoBlank': 'landscape-files-rail',
    'testCloudFilesRepeatedOfflineRetryRetainsRecoverableChildPage': 'cloud-denied-recovery',
    'testGalleryPeopleAfterFilesQuickRailReturnKeepsUnifiedWall': 'people-files-return',
    'testFilesSearchFocusThenGalleryReturnPreservesShell': 'files-search-return',
    'testRepeatedForegroundResumesAlternatingGalleryAndFilesNoBlank': 'foreground-roundtrip',
    # The six newest real Gallery/Files child journeys also receive H264.
    'testPeopleThreeFilesQuickRailCyclesKeepUnchangedUnifiedWall': 'people-files-three-rails',
    'testFilesSearchBackgroundOriginalsReturnHasNoGhostKeyboard': 'search-background-originals',
    'testOriginalsHelpTwiceAcrossFilesDenialNeverLeavesGhostAlert': 'originals-alert-denial-reopen',
    'testFilesTrashDeniedThenPeopleChildReturnClearsOverlay': 'trash-denial-people-return',
    'testGalleryFilterDraftForegroundFilesReturnKeepsWallGeneration': 'gallery-filter-foreground-files',
    'testRapidAlbumsOriginalsFilesAlternationRetainsNativeChildShells': 'albums-originals-files-rapid',
}
START = re.compile(r"Test Case '-\[[^\]]+\s+(test\w+)\]' started\.")
FINISH = re.compile(r"Test Case '-\[[^\]]+\s+(test\w+)\]' (passed|failed)\b")
TAP = re.compile(r'IOS_NATIVE_NAV_TAP_START route=(native-ios-[a-z0-9-]+)')
SIM_ID = re.compile(r'^[A-Fa-f0-9-]{36}$')
# A real macOS CI Simulator can deliver encoded frames significantly later
# than the wall-clock XCTest tap marker. Longer bounded recording gives the
# actual post-tap animation time to reach the H264 file; the audit still rejects
# clips without >=20 genuine monotonic frames and >=2 seconds post-tap.
# Do not fabricate, resample, sort or interpolate frames to force green.
MAX_CLIP_SECONDS = 40
POST_TAP_SECONDS = 18


def event(line):
    """Use actual XCTest markers, not a synthetic login or fake route."""
    m = START.search(line)
    if m:
        return ('start', m.group(1))
    m = FINISH.search(line)
    if m:
        return ('finish', m.group(1))
    m = TAP.search(line)
    if m:
        return ('tap', m.group(1))
    return None


def percentile(values, pct):
    if not values:
        return None
    ordered = sorted(values)
    return round(ordered[max(0, math.ceil(pct * len(ordered)) - 1)], 3)


def timestamps_from_probe(output):
    values = []
    for raw in output.splitlines():
        raw = raw.strip().strip(',')
        if not raw or raw == 'N/A':
            continue
        try:
            number = float(raw)
        except ValueError as exc:
            raise ValueError('malformed frame timestamp') from exc
        if not math.isfinite(number) or number < 0:
            raise ValueError('non-finite or negative frame timestamp')
        if values and number <= values[-1]:
            raise ValueError('nonmonotonic or duplicate frame timestamp')
        values.append(number)
    return values


def frame_timeline(video, runner=subprocess.run):
    response = runner([
        'ffprobe', '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'frame=best_effort_timestamp_time',
        '-of', 'csv=p=0', str(video),
    ], capture_output=True, text=True, timeout=90, check=True)
    values = timestamps_from_probe(response.stdout)
    gaps = [b - a for a, b in zip(values, values[1:])]
    return {
        'frame_count': len(values),
        'first_frame_s': round(values[0], 3) if values else None,
        'last_frame_s': round(values[-1], 3) if values else None,
        'frame_interval_p50_ms': round(statistics.median(gaps) * 1000, 1) if gaps else None,
        'frame_interval_p95_ms': round(percentile(gaps, .95) * 1000, 1) if gaps else None,
        'gaps_over_500ms': sum(g > .5 for g in gaps),
    }


def assess_clip(entry, directory, probe=frame_timeline):
    """Reject missing/tapless evidence, not legitimate empty/idle screens."""
    result = {k: entry.get(k) for k in (
        'test', 'route_group', 'first_tap_route', 'first_tap_offset_s',
        'stop_reason', 'duration_s', 'file',
    )}
    result['usable'] = False
    name = entry.get('file')
    expected = TEST_ROUTES.get(entry.get('test'))
    if (not expected or entry.get('route_group') != expected or
            name != expected + '.mp4' or not entry.get('recorded') or
            entry.get('stop_reason') in (
                'recorder_force_killed', 'recorder_exited_early',
                'overlapping_test_start',
            )):
        result['reason'] = 'not_recorded'
        return result
    video = pathlib.Path(directory) / name
    if not video.is_file() or video.stat().st_size < 1024:
        result['reason'] = 'missing_or_short_video'
        return result
    try:
        info = probe(video)
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        result['reason'] = 'video_probe_failed_' + type(exc).__name__
        return result
    result.update(info)
    tap = entry.get('first_tap_offset_s')
    if not isinstance(tap, (int, float)) or not math.isfinite(tap):
        result['reason'] = 'missing_tap_marker'
    elif tap < 1.0:
        # Recorder startup latency makes this pre-tap window ambiguous.
        result['reason'] = 'pre_tap_coverage_not_established'
    elif (not isinstance(info['first_frame_s'], (int, float)) or
          not math.isfinite(info['first_frame_s']) or
          info['first_frame_s'] > tap - 1.0):
        # A timestamp after the tap (or <1s before it) cannot prove the
        # recorded movie includes the pre-navigation screen. Mere file length
        # or 20 later frames is not valid before/after video evidence.
        result['reason'] = 'no_pre_tap_video'
    elif info['frame_count'] < 20:
        result['reason'] = 'too_few_recorded_frames'
    elif info['last_frame_s'] is None or info['last_frame_s'] < tap + 2.0:
        result['reason'] = 'no_post_tap_video'
    else:
        # simctl recordVideo can be variable-frame-rate on an idle display.
        # PTS gaps are diagnostics, NOT measured dropped UI draw frames.
        result['usable'] = True
        result['has_large_recorded_pts_gaps'] = bool(info['gaps_over_500ms'])
        result['reason'] = 'frame_timeline_available_not_display_fps'
    return result


def audit(directory, required=6, probe=frame_timeline):
    directory = pathlib.Path(directory)
    trace = directory / 'trace.jsonl'
    if not trace.is_file():
        return {'pass': False, 'reason': 'missing_video_trace',
                'usable_routes': 0, 'required_routes': required, 'clips': []}
    rows = []
    for raw in trace.read_text(encoding='utf-8').splitlines():
        if raw.strip():
            try:
                rows.append(json.loads(raw))
            except ValueError:
                return {'pass': False, 'reason': 'malformed_video_trace',
                        'usable_routes': 0, 'required_routes': required, 'clips': []}
    clips = [assess_clip(item, directory, probe=probe) for item in rows]
    # Deterministic bounded reason counts: a real VFR movie with no post-tap
    # encoded frame is NOT a successful transition video, even if XCTest passed.
    # Report precise failure classes rather than weakening --required 6.
    rejected = {}
    for item in clips:
        if not item['usable']:
            reason = item.get('reason', 'unknown')
            rejected[reason] = rejected.get(reason, 0) + 1
    routes = {item['route_group'] for item in clips if item['usable']}
    accepted = len(routes) >= required
    return {
        'pass': accepted, 'usable_routes': len(routes),
        'required_routes': required,
        'rejected_by_reason': dict(sorted(rejected.items())),
        'registered_routes': len(set(TEST_ROUTES.values())),
        'reason': ('required_real_recordings_present' if accepted
                   else 'inadequate_real_recorded_route_coverage'),
        'expected_route_groups': sorted(TEST_ROUTES.values()),
        'is_device_fps_measurement': False,
        'proves_zero_flicker': False,
        'note': ('Video PTS checks recorded frame delivery; visually inspect '
                 'suspected UI blanks. No 60/120Hz hardware claim.'),
        'clips': clips,
    }


class VideoRecorder:
    def __init__(self, simulator, output, popen=subprocess.Popen,
                 clock=time.monotonic):
        if not SIM_ID.fullmatch(simulator):
            raise ValueError('must use an explicit Simulator UDID')
        self.simulator = simulator
        self.output = pathlib.Path(output)
        self.output.mkdir(parents=True, exist_ok=True)
        self.popen = popen
        self.clock = clock
        self.current = None
        self.completed = set()
        self.records = []
        self.terminating = False

    def process(self, line):
        item = event(line)
        if item is None:
            return
        action, value = item
        if action == 'start':
            if self.current:
                self.stop('overlapping_test_start')
            if (value in TEST_ROUTES and value not in self.completed
                    and len(self.completed) < len(TEST_ROUTES)):
                self.start(value)
        elif (action == 'tap' and self.current
              and self.current['first_tap_offset_s'] is None):
            self.current['first_tap_offset_s'] = round(
                self.clock() - self.current['start_monotonic'], 4)
            self.current['first_tap_route'] = value
            self.current['tap_at_monotonic'] = self.clock()
        elif (action == 'finish' and self.current
              and value == self.current['test']):
            self.stop('test_finished')

    def start(self, name):
        path = self.output / (TEST_ROUTES[name] + '.mp4')
        err = (self.output / (TEST_ROUTES[name] + '.recorder.log')).open('wb')
        try:
            process = self.popen([
                'xcrun', 'simctl', 'io', self.simulator, 'recordVideo',
                '--codec=h264', '--force', str(path),
            ], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=err)
        except Exception:
            err.close()
            raise
        self.current = {
            'test': name, 'route_group': TEST_ROUTES[name],
            'first_tap_offset_s': None, 'first_tap_route': None,
            'tap_at_monotonic': None, 'start_monotonic': self.clock(),
            'file': path.name, 'stderr': err, 'process': process,
        }

    def tick(self):
        if not self.current:
            return
        now = self.clock()
        clip = self.current
        if clip['process'].poll() is not None:
            self.stop('recorder_exited_early')
        elif now - clip['start_monotonic'] >= MAX_CLIP_SECONDS:
            self.stop('max_clip_duration')
        elif (clip['tap_at_monotonic'] is not None and
              now - clip['tap_at_monotonic'] >= POST_TAP_SECONDS):
            self.stop('bounded_post_tap_window')

    def stop(self, reason):
        clip = self.current
        if not clip:
            return
        process = clip['process']
        if process.poll() is None:
            process.send_signal(signal.SIGINT)
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
                reason = 'recorder_force_killed'
        clip['stderr'].close()
        path = self.output / clip['file']
        row = {k: clip[k] for k in (
            'test', 'route_group', 'first_tap_offset_s',
            'first_tap_route', 'file',
        )}
        recorded = (path.is_file() and path.stat().st_size >= 1024 and
                    reason not in ('recorder_force_killed',
                                   'recorder_exited_early',
                                   'overlapping_test_start'))
        row.update({
            'stop_reason': reason,
            'duration_s': round(self.clock() - clip['start_monotonic'], 3),
            'recorded': recorded,
            'file_bytes': path.stat().st_size if path.is_file() else 0,
        })
        with (self.output / 'trace.jsonl').open('a', encoding='utf-8') as out:
            out.write(json.dumps(row, ensure_ascii=False) + '\n')
        self.records.append(row)
        self.completed.add(clip['test'])
        self.current = None

    def close(self):
        self.terminating = True
        self.stop('observer_shutdown')


def watch(simulator, log, output):
    recorder = VideoRecorder(simulator, output)

    def shutdown(_signum, _frame):
        recorder.terminating = True

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    cursor = 0
    try:
        while not recorder.terminating:
            if pathlib.Path(log).exists():
                with open(log, 'r', errors='replace') as file:
                    file.seek(cursor)
                    for line in file:
                        recorder.process(line)
                    cursor = file.tell()
            recorder.tick()
            time.sleep(.1)
    finally:
        recorder.close()


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    monitor = sub.add_parser('record')
    monitor.add_argument('simulator')
    monitor.add_argument('log')
    monitor.add_argument('output')
    inspect = sub.add_parser('audit')
    inspect.add_argument('directory')
    inspect.add_argument('report')
    inspect.add_argument('--required', type=int, default=6)
    opts = parser.parse_args()
    if opts.command == 'record':
        watch(opts.simulator, opts.log, opts.output)
    else:
        result = audit(opts.directory, opts.required)
        pathlib.Path(opts.report).write_text(
            json.dumps(result, ensure_ascii=False, indent=2) + '\n',
            encoding='utf-8')
        print('IOS_VIDEO_EVIDENCE usable_routes=%d required=%d pass=%s rejected=%s' % (
            result['usable_routes'], result['required_routes'], result['pass'],
            json.dumps(result.get('rejected_by_reason', {}), sort_keys=True)))
        if not result['pass']:
            raise SystemExit(1)


if __name__ == '__main__':
    main()
