#!/usr/bin/env python3
"""Generate real JPEG/EXIF GPS assets for isolated iOS Simulator PhotoKit tests.

Python stdlib only. Each output is a different decodable JPEG with a valid
GPS IFD and unique non-EXIF APP2 nonce. No private user media is used.
Sizes 1/10/65/1k/10k/100k are explicit; only actually executed sizes count
as real PhotoKit validation (never mistake this generator for a test pass).
"""
import argparse
import json
import math
import struct
from pathlib import Path


def remove_original_exif(jpeg: bytes) -> bytes:
    if jpeg[:2] != b"\xff\xd8":
        raise ValueError("source must be JPEG SOI")
    pos = 2
    output = bytearray(jpeg[:2])
    while pos < len(jpeg):
        if jpeg[pos] != 0xFF:
            output.extend(jpeg[pos:])
            break
        marker_start = pos
        while pos < len(jpeg) and jpeg[pos] == 0xFF:
            pos += 1
        if pos >= len(jpeg):
            raise ValueError("truncated JPEG marker")
        marker = jpeg[pos]
        pos += 1
        if marker in (0xD9, 0xDA):
            output.extend(jpeg[marker_start:])
            break
        if marker == 0x01 or 0xD0 <= marker <= 0xD7:
            output.extend(jpeg[marker_start:pos])
            continue
        if pos + 2 > len(jpeg):
            raise ValueError("truncated JPEG segment length")
        size = struct.unpack(">H", jpeg[pos:pos + 2])[0]
        if size < 2 or pos + size > len(jpeg):
            raise ValueError("invalid JPEG segment size")
        payload = jpeg[pos + 2:pos + size]
        if not (marker == 0xE1 and payload.startswith(b"Exif\x00\x00")):
            output.extend(jpeg[marker_start:pos + size])
        pos += size
    return bytes(output)


def exif_gps_segment(latitude: float, longitude: float) -> bytes:
    if not all(map(math.isfinite, (latitude, longitude))):
        raise ValueError("GPS must be finite")
    if abs(latitude) > 90 or abs(longitude) > 180:
        raise ValueError("GPS outside WGS84")

    def entry(tag: int, kind: int, count: int, value: int) -> bytes:
        return struct.pack("<HHII", tag, kind, count, value)

    def text_inline(letter: str) -> int:
        return int.from_bytes(letter.encode("ascii") + b"\x00\x00\x00", "little")

    def dms(value: float) -> bytes:
        absolute = abs(value)
        degrees = int(absolute)
        minute_value = (absolute - degrees) * 60
        minutes = int(minute_value)
        second_millionths = round((minute_value - minutes) * 60_000_000)
        if second_millionths >= 60_000_000:
            second_millionths -= 60_000_000
            minutes += 1
        if minutes >= 60:
            minutes -= 60
            degrees += 1
        return b"".join(
            struct.pack("<II", num, den)
            for num, den in (
                (degrees, 1), (minutes, 1), (second_millionths, 1_000_000)
            )
        )

    # TIFF offsets are relative to the first TIFF byte after "Exif\x00\x00".
    # IFD0 at offset 8 has one GPSInfo pointer, then GPS IFD at offset 26.
    # Four GPS entries take 54 bytes including nextIFD offset.
    lat_offset, lon_offset = 80, 104
    ifd0 = struct.pack("<H", 1) + entry(0x8825, 4, 1, 26) + struct.pack("<I", 0)
    gps = (
        struct.pack("<H", 4)
        + entry(1, 2, 2, text_inline("N" if latitude >= 0 else "S"))
        + entry(2, 5, 3, lat_offset)
        + entry(3, 2, 2, text_inline("E" if longitude >= 0 else "W"))
        + entry(4, 5, 3, lon_offset)
        + struct.pack("<I", 0)
    )
    tiff = b"II*\x00" + struct.pack("<I", 8) + ifd0 + gps
    if len(tiff) != lat_offset:
        raise AssertionError(f"incorrect TIFF GPS offset: {len(tiff)}")
    tiff += dms(latitude) + dms(longitude)
    content = b"Exif\x00\x00" + tiff
    return b"\xff\xe1" + struct.pack(">H", len(content) + 2) + content


def gps_for(index: int, pattern: str) -> tuple[float, float]:
    if pattern == "same":
        return 35.001, 139.001
    if pattern == "dateline":
        return 10.0, 180.0 if index % 2 == 0 else -180.0
    if pattern == "distinct":
        # 1,000 latitude slots × 1,000 longitude slots, with a coprime
        # longitude permutation for world-wide coverage. The old 130 × 350
        # grid repeated the FIRST coordinate at asset 45,500, so a 100k
        # "distinct" run was actually testing only 45,500 unique points.
        # All 100k supported fixture indices now have distinct WGS84 GPS.
        row = index % 1000
        column = ((index // 1000) * 137) % 1000
        return -80.0 + row * 0.16, -170.0 + column * 0.34
    # A stable mix of same-location, dateline, high-latitude, and multi-city
    # GPS. This is synthetic test media, never a location of the actual user.
    slot = index % 11
    if slot in (0, 1):
        return 35.001, 139.001
    if slot == 2:
        return 10.0, 180.0
    if slot == 3:
        return 10.0, -180.0
    if slot == 4:
        return 89.99, 0.0
    if slot == 5:
        return -89.99, 0.0
    return (-70.0 + ((index * 37) % 14000) / 100,
            -179.9 + ((index * 79) % 35980) / 100)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--count", type=int, required=True,
                        choices=(1, 10, 65, 1000, 10000, 100000))
    parser.add_argument("--pattern", choices=("same", "dateline", "distinct", "mixed"),
                        default="mixed")
    args = parser.parse_args()
    core = remove_original_exif(args.source.read_bytes())
    args.output.mkdir(parents=True, exist_ok=True)
    for i in range(args.count):
        latitude, longitude = gps_for(i, args.pattern)
        nonce = b"xDrive-map-P0:" + f"{i:06d}".encode("ascii")
        app2 = b"\xff\xe2" + struct.pack(">H", len(nonce) + 2) + nonce
        jpeg = core[:2] + exif_gps_segment(latitude, longitude) + app2 + core[2:]
        (args.output / f"gps-{i:06d}.jpg").write_bytes(jpeg)
    manifest = {
        "count": args.count, "pattern": args.pattern,
        "unique_jpegs": args.count, "real_photokit_import_confirmed": False
    }
    (args.output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("MAP_P0_GENERATED_EXIF_GPS count=" + str(args.count)
          + " pattern=" + args.pattern
          + " (PhotoKit import and independent count still required)")


if __name__ == "__main__":
    main()
