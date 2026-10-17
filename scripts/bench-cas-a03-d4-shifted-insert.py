#!/usr/bin/env python3
"""Offline, physical CAS chunk benchmark: 1 MiB INSERT in a 4 GiB original.

Compares fixed 8 MiB blocks to an experimental content-selected, 64 KiB aligned
2-16 MiB chunker. This is NOT production xDrive, byte-granular Rabin CDC,
FileVersion/Owner/GC, upload, backup consistency, or a six-platform result.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import resource
from statistics import median
import tempfile
import time

KIB = 1024
MIB = KIB * KIB
GIB = KIB * MIB
ATOM = 64 * KIB
FIXED = 8 * MIB
INSERT = MIB


def process_io():
    for line in Path('/proc/self/io').read_text().splitlines():
        if line.startswith('write_bytes:'):
            return int(line.split(':', 1)[1])
    raise RuntimeError('Linux /proc/self/io unavailable')


def cpu_seconds():
    u = resource.getrusage(resource.RUSAGE_SELF)
    return u.ru_utime + u.ru_stime


def allocated(root):
    return sum(f.stat().st_blocks * 512 for f in root.rglob('*') if f.is_file())


def source(root, size):
    path = root / 'original.bin'
    h = hashlib.sha256()
    with path.open('xb') as f:
        remaining = size
        while remaining:
            block = os.urandom(min(MIB, remaining))
            f.write(block)
            h.update(block)
            remaining -= len(block)
        f.flush()
        os.fsync(f.fileno())
    if path.stat().st_blocks * 512 < size:
        raise AssertionError('original input is sparse; invalid physical sample')
    return path, h.hexdigest()


def input_atoms(path, addition=None, at=MIB):
    if addition is not None and (len(addition) != INSERT or at % ATOM):
        raise ValueError('misaligned insertion payload')
    with path.open('rb') as f:
        offset = 0
        inserted = addition is None
        while True:
            if not inserted and offset == at:
                for i in range(0, len(addition), ATOM):
                    yield addition[i:i + ATOM]
                inserted = True
            atom = f.read(ATOM)
            if not atom:
                break
            offset += len(atom)
            yield atom
    if not inserted:
        raise AssertionError('missing insertion boundary')


def chunks(atoms, mode):
    buf = bytearray()
    for atom in atoms:
        buf.extend(atom)
        if mode == 'fixed':
            cut = len(buf) >= FIXED
        else:
            # A coarse content-dependent anchor, NOT a rolling-byte CDC.
            # The anchor decision depends on this 64 KiB content alone;
            # subsequent aligned content can resynchronize after insertion.
            anchor = (int.from_bytes(hashlib.blake2s(atom, digest_size=4).digest(), 'big') & 127) == 0
            cut = len(buf) >= 16 * MIB or (len(buf) >= 2 * MIB and anchor)
        if cut:
            yield bytes(buf)
            buf.clear()
    if buf:
        yield bytes(buf)


def add_version(store, atoms, mode):
    refs = []
    reused = 0
    new_bytes = 0
    for chunk in chunks(atoms, mode):
        digest = hashlib.sha256(chunk).hexdigest()
        destination = store / digest[:2] / digest
        if destination.exists():
            if destination.stat().st_size != len(chunk):
                raise AssertionError('preexisting chunk length mismatch')
            reused += 1
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            with destination.open('xb') as out:
                out.write(chunk)
                out.flush()
                os.fsync(out.fileno())
            new_bytes += destination.stat().st_blocks * 512
        refs.append((digest, len(chunk)))
    return refs, reused, new_bytes


def measured_add(store, path, mode, addition):
    before_io, before_cpu, started = process_io(), cpu_seconds(), time.perf_counter()
    refs, reused, new_bytes = add_version(store, input_atoms(path, addition), mode)
    return refs, {'elapsed_ms': round(1000 * (time.perf_counter() - started), 3),
                  'cpu_ms': round(1000 * (cpu_seconds() - before_cpu), 3),
                  'kernel_write_bytes': process_io() - before_io,
                  'new_allocated_bytes': new_bytes, 'reused_chunks': reused,
                  'chunk_count': len(refs)}


def version_digest(store, refs):
    h = hashlib.sha256()
    for digest, n in refs:
        path = store / digest[:2] / digest
        c = hashlib.sha256()
        total = 0
        with path.open('rb') as f:
            for block in iter(lambda: f.read(MIB), b''):
                total += len(block)
                c.update(block)
                h.update(block)
        if total != n or c.hexdigest() != digest:
            raise AssertionError('corrupt immutable chunk/length')
    return h.hexdigest()


def version_range(store, refs, position, length):
    data = bytearray()
    start = 0
    for digest, size in refs:
        end = start + size
        if position < end and position + length > start:
            s = max(0, position - start)
            take = min(size, position + length - start) - s
            with (store / digest[:2] / digest).open('rb') as f:
                f.seek(s)
                data.extend(f.read(take))
        start = end
        if start >= position + length:
            break
    if len(data) != length:
        raise AssertionError('truncated immutable chunk Range')
    return bytes(data)


def input_range(path, addition, offset, length):
    at = MIB
    data = bytearray()
    remaining = length
    pos = offset
    with path.open('rb') as f:
        while remaining:
            if addition is not None and at <= pos < at + len(addition):
                start = pos - at
                part = addition[start:start + remaining]
            else:
                next_boundary = at if addition is not None and pos < at else 10**20
                take = min(remaining, next_boundary - pos)
                src_pos = pos if addition is None or pos < at else pos - len(addition)
                f.seek(src_pos)
                part = f.read(take)
            if not part:
                raise AssertionError('bad expected Range')
            data.extend(part)
            pos += len(part)
            remaining -= len(part)
    return bytes(data)


def verify_version(store, refs, expected_sha, path, addition, size):
    if sum(n for _, n in refs) != size or version_digest(store, refs) != expected_sha:
        raise AssertionError('full original/changed version SHA or size mismatch')
    positions = [0, MIB - 2048, MIB, MIB + 256, 16 * MIB - 2048, size // 2, size - 4096]
    positions += [(i * 6364136223846793005 + 1442695040888963407) % (size - 4096) for i in range(13)]
    for off in positions:
        if version_range(store, refs, off, 4096) != input_range(path, addition, off, 4096):
            raise AssertionError('random/cross-chunk Range wrong')


def remove_unreferenced(store, refs_to_keep):
    protected = {key for key, _ in refs_to_keep}
    for file in store.rglob('*'):
        if file.is_file() and file.name not in protected:
            file.unlink()


def run_one(sample, source_bytes):
    with tempfile.TemporaryDirectory(prefix='xdrive-cas-a03-d4-') as tmp:
        root = Path(tmp)
        path, original_sha = source(root, source_bytes)
        addition = os.urandom(INSERT)
        # Trusted oracle independently streams the changed source, never generates
        # an extra materialized ~4 GiB second source file.
        h = hashlib.sha256()
        for atom in input_atoms(path, addition):
            h.update(atom)
        changed_sha = h.hexdigest()
        results = {}
        for mode in ('fixed', 'anchored') if sample % 2 else ('anchored', 'fixed'):
            store = root / ('store-' + mode)
            store.mkdir()
            before, stage_a = measured_add(store, path, mode, None)
            allocated_a = allocated(store)
            after, stage_b = measured_add(store, path, mode, addition)
            allocated_two = allocated(store)
            if stage_a['reused_chunks'] or allocated_two < allocated_a:
                raise AssertionError('invalid first write or physical allocation')
            verify_version(store, before, original_sha, path, None, source_bytes)
            verify_version(store, after, changed_sha, path, addition, source_bytes + INSERT)
            remove_unreferenced(store, before)
            if allocated(store) != allocated_a:
                raise AssertionError('failed to reclaim only changed-version chunks')
            verify_version(store, before, original_sha, path, None, source_bytes)
            remove_unreferenced(store, [])
            if allocated(store):
                raise AssertionError('last-reference physical chunks remain after GC')
            results[mode] = {'a': stage_a, 'b': stage_b, 'physical_a_bytes': allocated_a,
                             'physical_two_versions_bytes': allocated_two,
                             'released_b_kept_a_bytes': allocated_a,
                             'last_ref_physical_bytes': 0}
            # Bound actual runner space: the two stores are never concurrently populated.
            for directory in store.iterdir():
                if directory.is_dir():
                    directory.rmdir()
            store.rmdir()
        f, c = results['fixed'], results['anchored']
        ratio = c['b']['new_allocated_bytes'] / max(1, f['b']['new_allocated_bytes'])
        if source_bytes >= GIB and ratio > .15:
            raise AssertionError('anchored insertion storage budget failed')
        return {'workload_id': 'CAS-A03-d4-offline-insertion-shift', 'sample': sample,
                'source_bytes': source_bytes, 'insert_bytes': INSERT, 'passed': True,
                'original_sha256': original_sha, 'changed_sha256': changed_sha,
                'baseline': f, 'offline_candidate': c, 'candidate_to_fixed_new_bytes': ratio,
                'scope': 'OFFLINE coarse 64KiB-aligned anchored chunks vs fixed 8MiB only; production after N/A'}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--results-dir', type=Path, required=True)
    p.add_argument('--samples', type=int, default=3)
    p.add_argument('--source-bytes', type=int, default=4 * GIB)
    a = p.parse_args()
    if not (1 <= a.samples <= 3 and a.source_bytes >= 32 * MIB and a.source_bytes % ATOM == 0):
        p.error('samples must be 1..3, source bytes >=32 MiB, multiple of 64KiB')
    a.results_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for sample in range(1, a.samples + 1):
        row = run_one(sample, a.source_bytes)
        rows.append(row)
        (a.results_dir / f'sample-{sample}.json').write_text(json.dumps(row, indent=2) + '\n')
        print('CAS_A03_D4_SAMPLE ' + json.dumps({'sample': sample, 'ratio': row['candidate_to_fixed_new_bytes'],
                'fixed_new_bytes': row['baseline']['b']['new_allocated_bytes'],
                'anchored_new_bytes': row['offline_candidate']['b']['new_allocated_bytes']}), flush=True)
    summary = {'workload_id': 'CAS-A03-d4-offline-insertion-shift',
               'source_bytes': a.source_bytes, 'insert_bytes': INSERT,
               'n': len(rows), 'passed': all(r['passed'] for r in rows),
               'fixed_new_bytes_p50': median(r['baseline']['b']['new_allocated_bytes'] for r in rows),
               'anchored_new_bytes_p50': median(r['offline_candidate']['b']['new_allocated_bytes'] for r in rows),
               'anchored_to_fixed_bytes_p50': median(r['candidate_to_fixed_new_bytes'] for r in rows),
               'product_changed': False, 'production_after': None,
               'scope': 'Offline only: NOT byte-level CDC, authenticated Gin/PG/Blob version, HTTP, backup, or six client platforms'}
    (a.results_dir / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print('CAS_A03_D4_SUMMARY ' + json.dumps(summary), flush=True)


if __name__ == '__main__':
    main()
