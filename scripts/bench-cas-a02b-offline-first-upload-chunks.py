#!/usr/bin/env python3
"""CAS-A02b offline first-upload staging/assembly vs atomically promoted chunk blobs.

Uses actual fsynced 8MiB physical upload parts and Linux /proc/self/io.
This is a benchmark of two isolated layouts, NOT the production Gin/Local.Put
or an implemented online Chunk/Manifest protocol.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import resource
import shutil
from statistics import median
import tempfile
import time

MIB = 1024 * 1024

def allocated(root):
    return sum(p.stat().st_blocks * 512 for p in root.rglob("*") if p.is_file())

def kernel_writes():
    for line in Path("/proc/self/io").read_text().splitlines():
        if line.startswith("write_bytes:"):
            return int(line.split()[1])
    raise RuntimeError("Linux /proc/self/io write_bytes is required")

def total_cpu_ms():
    self_usage = resource.getrusage(resource.RUSAGE_SELF)
    return (self_usage.ru_utime + self_usage.ru_stime) * 1000

def measured(fn):
    start, w0, c0 = time.perf_counter(), kernel_writes(), total_cpu_ms()
    details = fn()
    return {
        "wall_ms": round((time.perf_counter() - start) * 1000, 3),
        "kernel_write_bytes": kernel_writes() - w0,
        "cpu_ms": round(total_cpu_ms() - c0, 3),
        "details": details
    }

def sync_dir(root):
    fd = os.open(root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def chunk_bytes(sample, index, size):
    seed = "xdrive-cas-a02b-%d-%d" % (sample, index)
    return hashlib.shake_256(seed.encode()).digest(size)

def sha_file(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(MIB), b""):
            h.update(block)
    return h.hexdigest()

def stage_parts(stage, sample, count, size):
    stage.mkdir()
    full = hashlib.sha256()
    hashes = []
    for index in range(count):
        payload = chunk_bytes(sample, index, size)
        full.update(payload)
        h = hashlib.sha256(payload).hexdigest()
        path = stage / ("%06d.part" % index)
        with path.open("xb") as f:
            f.write(payload)
            f.flush()
            os.fsync(f.fileno())
        hashes.append(h)
    sync_dir(stage)
    actual = allocated(stage)
    assert actual >= count * size, ("sparse_or_missing_stage", actual, count*size)
    assert len(set(hashes)) == count
    return {"source_sha256": full.hexdigest(), "chunk_sha256": hashes,
            "staged_allocated_bytes": actual, "physical_parts": count}

def part_path(stage, i):
    return stage / ("%06d.part" % i)

def assert_flat_range(path, sample, count, size):
    offsets = [0, 1, size-32, size-1, size, size+1,
               (count//2)*size-1, (count//2)*size, count*size-65536]
    offsets += [((i*7919 + sample*131) * 65537) % (count*size-65536)
                for i in range(31)]
    assert len(offsets) == 40
    with path.open("rb") as f:
        for offset in offsets:
            f.seek(offset)
            seen = f.read(65536)
            want = expected_range(sample, size, offset, 65536)
            if seen != want:
                raise AssertionError("flat file range content mismatch")
    return len(offsets)

def expected_range(sample, chunk_size, offset, length):
    out = bytearray()
    while len(out) < length:
        index, local_offset = divmod(offset, chunk_size)
        chunk = chunk_bytes(sample, index, chunk_size)
        length_now = min(len(chunk) - local_offset, length - len(out))
        out.extend(chunk[local_offset:local_offset + length_now])
        offset += length_now
    return bytes(out)

def assert_chunk_range(objects, hashes, sample, chunk_size):
    count = len(hashes)
    offsets = [0, 1, chunk_size-32, chunk_size-1, chunk_size, chunk_size+1,
               (count//2)*chunk_size-1, (count//2)*chunk_size, count*chunk_size-65536]
    offsets += [((i*7919 + sample*131) * 65537) % (count*chunk_size-65536)
                for i in range(31)]
    for offset in offsets:
        pos = offset
        actual = bytearray()
        while len(actual) < 65536:
            index, in_chunk = divmod(pos, chunk_size)
            n = min(chunk_size-in_chunk, 65536-len(actual))
            with (objects/hashes[index][:2]/hashes[index]).open("rb") as f:
                f.seek(in_chunk)
                actual.extend(f.read(n))
            pos += n
        if bytes(actual) != expected_range(sample, chunk_size, offset, 65536):
            raise AssertionError("chunk range content mismatch")
    return len(offsets)

def put_full_flat(root, sample, stage, expected_sha, count, size):
    final = root / "complete-original.cas"
    temporary = root / ".assembly-incomplete"
    h = hashlib.sha256()
    with temporary.open("xb") as out:
        for i in range(count):
            with part_path(stage, i).open("rb") as f:
                for block in iter(lambda: f.read(MIB), b""):
                    h.update(block)
                    out.write(block)
        out.flush()
        os.fsync(out.fileno())
    assert h.hexdigest() == expected_sha
    assert temporary.stat().st_size == count*size
    os.replace(temporary, final)
    sync_dir(root)
    peak = allocated(root)
    assert peak >= 2*count*size
    assert sha_file(final) == expected_sha
    range_queries = assert_flat_range(final, sample, count, size)
    return {"peak_physical_bytes": peak,
            "final_allocated_bytes": final.stat().st_blocks*512,
            "range_queries": range_queries,
            "complete_sha256": expected_sha}

def promote_chunks(root, sample, stage, hashes, expected_sha, size):
    objects = root / "objects"
    objects.mkdir()
    for i, digest in enumerate(hashes):
        source = part_path(stage, i)
        if source.stat().st_size != size or sha_file(source) != digest:
            raise AssertionError("invalid staged chunk")
        target_dir = objects/digest[:2]
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir/digest
        assert not target.exists()
        os.replace(source, target)
        sync_dir(target_dir)
    sync_dir(objects)
    manifest = {"format":"xdrive.cas-a02b.offline.v1", "full_sha256":expected_sha,
                "bytes":len(hashes)*size,"chunk_bytes":size, "parts":hashes}
    encoded = (json.dumps(manifest,sort_keys=True,separators=(",",":"))+"\n").encode()
    with (root/".manifest-uncommitted").open("xb") as f:
        f.write(encoded); f.flush(); os.fsync(f.fileno())
    os.replace(root/".manifest-uncommitted",root/"manifest.json")
    sync_dir(root)
    assert not any(stage.iterdir())
    # Independently reconstruct full logical SHA without materializing a file.
    h = hashlib.sha256()
    for digest in hashes:
        with (objects/digest[:2]/digest).open("rb") as f:
            for block in iter(lambda: f.read(MIB),b""):
                h.update(block)
    if h.hexdigest()!=expected_sha:
        raise AssertionError("candidate manifest cannot reproduce full SHA")
    return {"peak_physical_bytes":allocated(root),"physical_objects":len(hashes),
            "manifest_bytes":len(encoded),"range_queries":assert_chunk_range(objects,hashes,sample,size),
            "complete_sha256":h.hexdigest()}

def materialize_flat(root, hashes, expected_sha):
    target=root/"temporary-flat-restored.bin"
    objects=root/"objects"
    h=hashlib.sha256()
    with target.open("xb") as out:
        for digest in hashes:
            with (objects/digest[:2]/digest).open("rb") as source:
                for block in iter(lambda:source.read(MIB),b""):
                    h.update(block)
                    out.write(block)
        out.flush();os.fsync(out.fileno())
    if h.hexdigest()!=expected_sha or sha_file(target)!=expected_sha:
        raise AssertionError("complete physical materialization SHA mismatch")
    extra=target.stat().st_blocks*512
    target.unlink()
    return {"extra_temporary_flat_allocated_bytes":extra,
            "restored_full_sha256":h.hexdigest()}

def run_one_arm(temp_root, sample, mode, count, size):
    root=temp_root/mode
    root.mkdir()
    stage=root/"upload-parts"
    seed=measured(lambda:stage_parts(stage,sample,count,size))
    source_info=seed["details"]
    digest=source_info["source_sha256"]
    if mode=="original":
        finalize=measured(lambda:put_full_flat(root,sample,stage,digest,count,size))
        peek=finalize["details"]["peak_physical_bytes"]
        assert peek >= 2*count*size
        assert finalize["details"]["range_queries"]==40
        return_later=None
    else:
        finalize=measured(lambda:promote_chunks(root,sample,stage,source_info["chunk_sha256"],digest,size))
        peek=finalize["details"]["peak_physical_bytes"]
        assert finalize["details"]["physical_objects"]==count
        assert peek <= int(count*size*1.01)
        assert finalize["details"]["range_queries"]==40
        return_later=measured(lambda:materialize_flat(root,source_info["chunk_sha256"],digest))
    if mode=="original":
        shutil.rmtree(stage)
        after_staging=allocated(root)
        assert after_staging >= count*size
        (root/"complete-original.cas").unlink()
    else:
        # The manifest is an experimental reference, not production Blob metadata.
        (root/"manifest.json").unlink()
        shutil.rmtree(root/"objects")
        shutil.rmtree(stage)
        after_staging=0
    assert allocated(root)==0
    return {
      "sha256":digest,"source_bytes":count*size,"parts":count,
      "stage":seed,"finalize":finalize,
      "total_kernel_write_bytes":seed["kernel_write_bytes"]+finalize["kernel_write_bytes"],
      "peak_physical_bytes":peek,"after_clear_bytes":allocated(root),
      "flat_materialize":return_later,"production_changed":False
    }

def run_sample(sample, count, size, root):
    total=count*size
    if total < 64*MIB or total % size: raise ValueError("invalid workload size")
    modes=("original","candidate") if sample%2 else ("candidate","original")
    arms={}
    for mode in modes:
        arms[mode]=run_one_arm(root,sample,mode,count,size)
    a,b=arms["original"],arms["candidate"]
    if a["sha256"]!=b["sha256"] or a["sha256"]=="0"*64:
        raise AssertionError("not the same actual original payload")
    if total==4096*MIB:
        assert a["peak_physical_bytes"]>=2*total
        assert b["peak_physical_bytes"]<=int(total*1.01)
        assert b["total_kernel_write_bytes"] <= a["total_kernel_write_bytes"]*.60
        assert b["flat_materialize"]["details"]["extra_temporary_flat_allocated_bytes"]>=total
        assert b["flat_materialize"]["kernel_write_bytes"]>=total
    assert a["after_clear_bytes"]==b["after_clear_bytes"]==0
    return {"workload_id":"CAS-A02b-4GiB-first-upload-staging-offline-chunk-promotion",
      "sample":sample,"source_bytes":total,"chunk_bytes":size,"chunks":count,
      "source_sha256":a["sha256"],"arm_order":list(modes),"baseline_flat_assembly":a,
      "candidate_offline_direct_chunks":b,
      "peak_physical_ratio_original":round(a["peak_physical_bytes"]/total,9),
      "peak_physical_ratio_candidate":round(b["peak_physical_bytes"]/total,9),
      "candidate_to_baseline_total_kernel_write_ratio":round(
         b["total_kernel_write_bytes"]/a["total_kernel_write_bytes"],9),
      "process_peak_rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
      "passed":True,"production_changed":False,
      "scope":"Original actual 512 fsynced staged files plus representative flat reassembly vs offline same-byte 512 physical chunk rename+manifest. No Gin, Local.Put, SQL, online CAS, Web/Desktop/PWA or HTTP transfer."}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--results-dir",type=Path,required=True)
    p.add_argument("--sample",type=int,default=1)
    p.add_argument("--payload-mib",type=int,default=4096)
    p.add_argument("--chunk-mib",type=int,default=8)
    a=p.parse_args()
    if a.sample not in (1,2,3) or a.payload_mib<64 or a.chunk_mib!=8 or a.payload_mib%a.chunk_mib:
        p.error("sample in 1..3, payload >=64MiB, 8MiB chunks")
    count=a.payload_mib//a.chunk_mib
    a.results_dir.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="xdrive-cas-a02b-") as tmp:
        row=run_sample(a.sample,count,a.chunk_mib*MIB,Path(tmp))
    target=a.results_dir/f"sample-{a.sample}.json"
    target.write_text(json.dumps(row,indent=2)+"\n")
    print("CAS_A02B_FIRST_UPLOAD_REAL",json.dumps({
        "sample":a.sample,"source_bytes":row["source_bytes"],"source_sha256":row["source_sha256"],
        "original_peak_bytes":row["baseline_flat_assembly"]["peak_physical_bytes"],
        "candidate_peak_bytes":row["candidate_offline_direct_chunks"]["peak_physical_bytes"],
        "io_ratio":row["candidate_to_baseline_total_kernel_write_ratio"],
        "restore_ms":row["candidate_offline_direct_chunks"]["flat_materialize"]["wall_ms"],
        "passed":True}),flush=True)

if __name__=="__main__":
    main()
