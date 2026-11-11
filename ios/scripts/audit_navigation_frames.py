#!/usr/bin/env python3
"""Audit Simulator screenshots for content-region flat-frame signatures.

Diagnostic only: still PNG captures cannot establish 60/120 fps or the absence
of flashes between captures. Never upload media/Owner details from a live user.
"""
import argparse
import collections
import json
import math
import pathlib
import shutil
import struct
import subprocess
import tempfile
import zlib

SIGNATURE = b'\x89PNG\r\n\x1a\n'


def decode_png(path):
    """Decode RGB/RGBA/greyscale 8-bit PNGs using only Python stdlib."""
    buf = pathlib.Path(path).read_bytes()
    if not buf.startswith(SIGNATURE):
        raise ValueError('not PNG')
    i, compressed, width, height, nchan = 8, bytearray(), 0, 0, None
    while i + 12 <= len(buf):
        size = struct.unpack_from('>I', buf, i)[0]
        kind = buf[i+4:i+8]
        end = i + 12 + size
        if end > len(buf):
            raise ValueError('truncated PNG chunk')
        body = buf[i+8:i+8+size]
        crc = struct.unpack_from('>I', buf, i+8+size)[0]
        if zlib.crc32(kind + body) & 0xffffffff != crc:
            raise ValueError('PNG CRC mismatch')
        if kind == b'IHDR':
            width, height, depth, color, compression, filt, interlace = struct.unpack('>IIBBBBB', body)
            if depth != 8 or color not in (0, 2, 6) or compression or filt or interlace:
                raise ValueError('unsupported PNG layout')
            nchan = {0: 1, 2: 3, 6: 4}[color]
            if not (1 <= width <= 4096 and 1 <= height <= 4096):
                raise ValueError('invalid PNG dimensions')
        elif kind == b'IDAT':
            compressed.extend(body)
        elif kind == b'IEND':
            break
        i = end
    if not width or not nchan:
        raise ValueError('missing IHDR')
    scanlen = width * nchan
    raw = zlib.decompress(bytes(compressed))
    if len(raw) != (scanlen + 1) * height:
        raise ValueError('bad PNG scanline length')
    prev = bytearray(scanlen)
    sample = []
    app_chrome = []
    step_x = max(1, width // 40)
    step_y = max(1, height // 54)
    for y in range(height):
        start = y * (scanlen + 1)
        mode = raw[start]
        line = bytearray(raw[start+1:start+1+scanlen])
        if mode not in range(5):
            raise ValueError('bad PNG filter')
        for j in range(scanlen):
            left = line[j-nchan] if j >= nchan else 0
            up = prev[j]
            upperleft = prev[j-nchan] if j >= nchan else 0
            if mode == 1:
                line[j] = (line[j] + left) & 255
            elif mode == 2:
                line[j] = (line[j] + up) & 255
            elif mode == 3:
                line[j] = (line[j] + ((left + up) // 2)) & 255
            elif mode == 4:
                p = left + up - upperleft
                pa, pb, pc = abs(p-left), abs(p-up), abs(p-upperleft)
                predictor = left if pa <= pb and pa <= pc else up if pb <= pc else upperleft
                line[j] = (line[j] + predictor) & 255
        if y % step_y == 0:
            content_band = height * .22 <= y < height * .78
            # Exclude the OS clock/dynamic island and bottom Home indicator.
            # A completely white list is not a blank page when native title,
            # Search and Tab controls are visibly mounted above/below it.
            chrome_band = (height * .08 <= y < height * .22 or
                           height * .78 <= y < height * .95)
            if content_band or chrome_band:
                destination = sample if content_band else app_chrome
                for x in range(0, width, step_x):
                    if not (width * .18 <= x < width * .82):
                        continue
                    at = x * nchan
                    if nchan == 1:
                        destination.append((line[at],) * 3)
                    else:
                        destination.append(tuple(line[at:at+3]))
        prev = line
    return width, height, sample, app_chrome


def score_png(path):
    width, height, pixels, chrome = decode_png(path)
    if not pixels or not chrome:
        raise ValueError('missing content/chrome-region samples')
    coarse = collections.Counter(tuple(c // 16 for c in p) for p in pixels)
    chrome_coarse = collections.Counter(tuple(c // 16 for c in p) for p in chrome)
    major = coarse.most_common(1)[0][1] / len(pixels)
    chrome_major = chrome_coarse.most_common(1)[0][1] / len(chrome)
    flat_content = major >= .985 and len(coarse) <= 3
    flat_chrome = chrome_major >= .985 and len(chrome_coarse) <= 3
    return {
        'size': [width, height], 'content_samples': len(pixels),
        'dominant_color_fraction': round(major, 4),
        'unique_color_bins': len(coarse),
        'likely_uniform_content': flat_content,
        # A blank center is expected on a real empty/denied list. It is NOT
        # equivalent to the absence of the native navigation chrome.
        'app_chrome_present': not flat_chrome,
        'chrome_dominant_color_fraction': round(chrome_major, 4),
        'chrome_unique_color_bins': len(chrome_coarse),
        'likely_blank_shell': flat_content and flat_chrome,
        'is_fps_measurement': False,
    }


def analyze(directory):
    directory = pathlib.Path(directory)
    trace = directory / 'frame-trace.jsonl'
    missing_capture_trace = not trace.exists()
    entries = []
    if trace.exists():
        for line in trace.read_text(encoding='utf-8').splitlines():
            if line.strip():
                entries.append(json.loads(line))
    results = []
    with tempfile.TemporaryDirectory(prefix='xdrive-qa-frames-') as tmp:
        for entry in entries:
            result = {k: v for k, v in entry.items() if k not in ('file',)}
            result['file'] = entry.get('file')
            name = entry.get('file')
            image = directory / name if name else None
            if not image or not image.is_file():
                result['quality'] = 'capture_missing'
            elif entry.get('capture_reliable') is False:
                # The PNG exists, but screenshot completion took longer
                # than its declared tap-adjacent window. Do not interpret
                # it as the requested route's frame; retain the bytes.
                result['quality'] = 'capture_unreliable'
                result['reason'] = entry.get('capture_unreliable_reason') or 'slow_capture'
            else:
                try:
                    # Tiny synthetic test frames need no sips re-encoding. That
                    # conversion can change PNG color type on macOS, making an
                    # otherwise valid original unreadable by our stdlib decoder.
                    with image.open('rb') as source:
                        header = source.read(24)
                    resize_needed = (
                        len(header) >= 24 and header.startswith(SIGNATURE)
                        and header[12:16] == b'IHDR'
                        and max(struct.unpack_from('>II', header, 16)) > 200
                    )
                    inspect = image
                    if resize_needed and shutil.which('sips'):
                        small = pathlib.Path(tmp) / pathlib.Path(name).name
                        try:
                            subprocess.run(['sips', '-Z', '200', str(image), '--out', str(small)],
                                           check=True, timeout=15, stdout=subprocess.DEVNULL,
                                           stderr=subprocess.DEVNULL)
                            inspect = small
                        except (OSError, subprocess.SubprocessError) as exc:
                            result['downscale_issue'] = type(exc).__name__
                    try:
                        result['metrics'] = score_png(inspect)
                    except (OSError, ValueError) as exc:
                        if inspect == image:
                            raise
                        # A failed or unsupported re-encoding must not cause a
                        # valid original screenshot to disappear from the audit.
                        # Keep the failure reason for honest diagnostics.
                        result['downscale_issue'] = type(exc).__name__
                        result['metrics'] = score_png(image)
                    result['quality'] = (
                        'blank_shell_candidate' if result['metrics']['likely_blank_shell']
                        else 'sparse_or_empty_content'
                        if result['metrics']['likely_uniform_content']
                        else 'content_nonuniform'
                    )
                except (OSError, ValueError, subprocess.SubprocessError) as exc:
                    result['quality'] = 'analysis_unavailable'
                    result['reason'] = type(exc).__name__
            results.append(result)
    lags = sorted(float(r['capture_request_lag_seconds']) for r in results
                  if isinstance(r.get('capture_request_lag_seconds'), (int, float))
                  and math.isfinite(float(r['capture_request_lag_seconds']))
                  and r['capture_request_lag_seconds'] >= 0)

    def percentile(values, fraction):
        if not values:
            return None
        return round(values[min(len(values) - 1,
                                max(0, math.ceil(len(values) * fraction) - 1))] * 1000, 1)

    return {
        'note': 'Diagnostic content-region snapshots only; no FPS or zero-flicker conclusion',
        'is_fps_measurement': False, 'proves_zero_transient_flicker': False,
        'total_frames': len(results),
        'missing_capture_trace': missing_capture_trace,
        'finished_before_capture': sum(
            r.get('reason') == 'test_finished_before_capture' for r in results),
        'capture_request_lag': {
            'samples': len(lags),
            'p50_ms': percentile(lags, .50),
            'p95_ms': percentile(lags, .95),
            'over_150ms': sum(lag > .15 for lag in lags),
        },
        'counts': dict(collections.Counter(r['quality'] for r in results)),
        'frames': results,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('frame_directory')
    parser.add_argument('report_path')
    args = parser.parse_args()
    pathlib.Path(args.report_path).write_text(
        json.dumps(analyze(args.frame_directory), ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8')


if __name__ == '__main__':
    main()
