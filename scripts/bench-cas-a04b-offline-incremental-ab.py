#!/usr/bin/env python3
"""Same-source CAS-A04b physical tar-vs-incremental snapshot A/B (offline, NOT Server backup)."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import resource
import shutil
from statistics import median
import tempfile
import time

LIB_PATH = Path(__file__).with_name("bench-cas-a04-backup-generations.py")
_spec = importlib.util.spec_from_file_location("cas_a04a_original_stage", LIB_PATH)
_original = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_original)
sha256 = _original.sha256
allocate = _original.allocate
tar_snapshot = _original.snapshot
tar_restore = _original.restore_and_verify

MIB = 1024 * 1024
SCENARIOS = {"unchanged": 0, "one-percent-new-versions": 1, "all-new-versions": 100}
FORMAT = "xdrive.cas-a04b.offline-snapshot.v1"

def physical_bytes(directory):
    return sum(p.stat().st_blocks * 512 for p in directory.rglob("*") if p.is_file())

def kernel_write_bytes():
    for line in Path("/proc/self/io").read_text().splitlines():
        if line.startswith("write_bytes:"):
            return int(line.split()[1])
    raise AssertionError("missing Linux process kernel write counters")

def cpu_ms():
    a, b = resource.getrusage(resource.RUSAGE_SELF), resource.getrusage(resource.RUSAGE_CHILDREN)
    return (a.ru_utime+a.ru_stime+b.ru_utime+b.ru_stime)*1000

def measure(fn):
    io0, cpu0, clock0 = kernel_write_bytes(), cpu_ms(), time.perf_counter()
    details = fn()
    return {"wall_ms": round((time.perf_counter()-clock0)*1000, 3),
            "kernel_write_bytes": kernel_write_bytes()-io0,
            "cpu_ms": round(cpu_ms()-cpu0, 3), "details": details}

def sync_dir(folder):
    fd = os.open(folder, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try: os.fsync(fd)
    finally: os.close(fd)

def object_path(repo, digest):
    return repo / "objects" / digest[:2] / digest

def validate_mapping(refs):
    if not isinstance(refs, dict) or not refs:
        raise ValueError("missing CAS file-data manifest")
    for rel, digest in refs.items():
        if not isinstance(digest, str) or len(digest)!=64 or any(c not in "0123456789abcdef" for c in digest):
            raise ValueError("invalid content identity")
        if rel != ".xdrive-blobs/sha256/" + digest[:2] + "/" + digest:
            raise ValueError("unexpected/untrusted path")

def verify_objects(repo, refs):
    validate_mapping(refs)
    for digest in set(refs.values()):
        p = object_path(repo, digest)
        if not p.is_file() or sha256(p) != digest:
            raise ValueError("missing or corrupted independently-backed content")

def independent_copy(source, dest, digest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    temp = dest.parent / ("." + digest + ".incomplete")
    assert not dest.exists() and not temp.exists()
    h = hashlib.sha256()
    with source.open("rb") as f, temp.open("xb") as out:
        for block in iter(lambda:f.read(MIB), b""):
            h.update(block)
            out.write(block)
        out.flush()
        os.fsync(out.fileno())
    if h.hexdigest() != digest:
        temp.unlink()
        raise AssertionError("source digest changed during snapshot")
    os.replace(temp, dest)
    sync_dir(dest.parent)
    assert source.stat().st_ino != dest.stat().st_ino or source.stat().st_dev != dest.stat().st_dev

def incremental_snapshot(source, refs, repo, generation):
    validate_mapping(refs)
    new = 0
    for rel, digest in sorted(refs.items()):
        saved = object_path(repo, digest)
        if saved.exists():
            if sha256(saved)!=digest: raise ValueError("preexisting corrupted content")
        else:
            independent_copy(source/rel, saved, digest)
            new += 1
    verify_objects(repo, refs)
    snapshot_dir = repo/"snapshots"
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    target = snapshot_dir/f"generation-{generation}.json"
    pending = snapshot_dir/f".generation-{generation}.pending"
    assert not target.exists() and not pending.exists()
    content = (json.dumps({"format":FORMAT, "generation":generation, "files":refs},
                          sort_keys=True, separators=(",",":"))+"\n").encode()
    with pending.open("xb") as out:
        out.write(content)
        out.flush()
        os.fsync(out.fileno())
    os.replace(pending,target)
    sync_dir(snapshot_dir)
    return {"new_physical_objects":new, "manifest_sha256":hashlib.sha256(content).hexdigest(),
            "manifest_bytes":len(content), "repo_allocated_bytes":physical_bytes(repo)}

def read_generation(repo, generation):
    path=repo/"snapshots"/f"generation-{generation}.json"
    value=json.loads(path.read_text())
    if set(value)!={"format","generation","files"} or value["format"]!=FORMAT or value["generation"]!=generation:
        raise ValueError("unrecognized generation")
    validate_mapping(value["files"])
    return value["files"]

def restore_generation(repo,generation,expected,target):
    refs=read_generation(repo,generation)
    if refs!=expected: raise AssertionError("generation mismatch")
    verify_objects(repo,refs)
    target.mkdir()
    written=0
    for rel,digest in refs.items():
        src=object_path(repo,digest)
        out=target/rel
        out.parent.mkdir(parents=True,exist_ok=True)
        with src.open("rb") as f, out.open("xb") as dst:
            for chunk in iter(lambda:f.read(MIB),b""):
                dst.write(chunk)
                written+=len(chunk)
            dst.flush()
            os.fsync(dst.fileno())
        if sha256(out)!=digest: raise AssertionError("bad restored full CAS SHA")
    return {"restored_files":len(refs),"restored_bytes":written}

def prune_unreachable(repo):
    roots=set()
    for snapshot in (repo/"snapshots").glob("generation-*.json"):
        n=int(snapshot.stem.split("-")[1])
        roots.update(read_generation(repo,n).values())
    deleted=0
    for obj in (repo/"objects").rglob("*"):
        if obj.is_file() and obj.name not in roots:
            obj.unlink()
            deleted+=1
    return deleted

def trial(root,scenario,sample,object_bytes,source_count,budget_s):
    root.mkdir()
    source=root/"source"
    source.mkdir()
    baseline=root/"tar"
    baseline.mkdir()
    candidate=root/"offline-repository"
    (candidate/"objects").mkdir(parents=True)
    refs={}
    allocate(source,refs,source_count,object_bytes)
    a=dict(refs)
    extra=source_count if SCENARIOS[scenario]==100 else SCENARIOS[scenario]
    phases={}
    # Same bytes; alternating phase order to limit cache/order bias.
    if sample%2:
        phases["tar1"]=measure(lambda:tar_snapshot(source,baseline/"generation-1.tar"))
        phases["candidate1"]=measure(lambda:incremental_snapshot(source,a,candidate,1))
    else:
        phases["candidate1"]=measure(lambda:incremental_snapshot(source,a,candidate,1))
        phases["tar1"]=measure(lambda:tar_snapshot(source,baseline/"generation-1.tar"))
    allocate(source,refs,extra,object_bytes)
    b=dict(refs)
    if sample%2:
        phases["candidate2"]=measure(lambda:incremental_snapshot(source,b,candidate,2))
        phases["tar2"]=measure(lambda:tar_snapshot(source,baseline/"generation-2.tar"))
    else:
        phases["tar2"]=measure(lambda:tar_snapshot(source,baseline/"generation-2.tar"))
        phases["candidate2"]=measure(lambda:incremental_snapshot(source,b,candidate,2))
    assert phases["candidate1"]["details"]["new_physical_objects"]==source_count
    assert phases["candidate2"]["details"]["new_physical_objects"]==extra
    assert all(0<phases[k]["wall_ms"]<=budget_s*1000 for k in ("tar1","tar2","candidate1","candidate2"))
    original_disk=physical_bytes(baseline)
    candidate_disk=physical_bytes(candidate)
    # Revoke original source access: both backups must be independently restorable.
    shutil.rmtree(source)
    phases["tar_restore_1"]=measure(lambda:tar_restore(baseline/"generation-1.tar",a,root/"tar-restore1"))
    phases["candidate_restore_1"]=measure(lambda:restore_generation(candidate,1,a,root/"candidate-restore1"))
    phases["tar_restore_2"]=measure(lambda:tar_restore(baseline/"generation-2.tar",b,root/"tar-restore2"))
    phases["candidate_restore_2"]=measure(lambda:restore_generation(candidate,2,b,root/"candidate-restore2"))
    assert physical_bytes(baseline)==original_disk and physical_bytes(candidate)==candidate_disk
    # Fenced invalid generation must never become visible.
    missing_hash="0"*64
    faulty=dict(b)
    faulty[".xdrive-blobs/sha256/00/"+missing_hash]=missing_hash
    try: verify_objects(candidate,faulty)
    except ValueError: pass
    else: raise AssertionError("missing object accepted")
    assert not (candidate/"snapshots"/"generation-3.json").exists()
    # Corruption is detected and must not be interpreted as a successful restore.
    victim_digest=sorted(a.values())[0]
    victim=object_path(candidate,victim_digest)
    with victim.open("r+b") as f:
        first=f.read(1)
        f.seek(0);f.write(bytes([first[0]^0xFF]));f.flush();os.fsync(f.fileno())
    try: verify_objects(candidate,a)
    except ValueError: pass
    else: raise AssertionError("silent digest corruption")
    with victim.open("r+b") as f:
        f.seek(0);f.write(first);f.flush();os.fsync(f.fileno())
    assert sha256(victim)==victim_digest
    (candidate/"snapshots"/"generation-2.json").unlink()
    deleted_new=prune_unreachable(candidate)
    assert deleted_new==extra
    phases["restore_after_prune"]=measure(lambda:restore_generation(candidate,1,a,root/"restore-after-prune"))
    (candidate/"snapshots"/"generation-1.json").unlink()
    deleted_old=prune_unreachable(candidate)
    assert deleted_old==source_count
    assert not any(p.is_file() for p in (candidate/"objects").rglob("*"))
    return {"scenario":scenario,"sample":sample,"passed":True,
            "original_physical_cas":source_count,"original_bytes":source_count*object_bytes,
            "new_physical_cas":extra,"new_bytes":extra*object_bytes,
            "two_full_tar_allocated_bytes":original_disk,
            "offline_two_generation_allocated_bytes":candidate_disk,
            "full_tar_kernel_write_bytes":phases["tar1"]["kernel_write_bytes"]+phases["tar2"]["kernel_write_bytes"],
            "offline_kernel_write_bytes":phases["candidate1"]["kernel_write_bytes"]+phases["candidate2"]["kernel_write_bytes"],
            "pruned_new_objects":deleted_new,"pruned_original_objects":deleted_old,
            "process_max_rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            "process_cpu_ms_at_end":round(cpu_ms(),3),"phases":phases}

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--results-dir",required=True,type=Path)
    ap.add_argument("--samples",type=int,default=3)
    ap.add_argument("--source-count",type=int,default=100)
    ap.add_argument("--object-bytes",type=int,default=4*MIB)
    ap.add_argument("--stage-budget-seconds",type=int,default=180)
    opts=ap.parse_args()
    if not (1<=opts.samples<=3) or opts.source_count not in (10,100) or opts.object_bytes<4096 or opts.object_bytes%512:
        ap.error("invalid sample/physical bytes; production fixture=100x4MiB, smoke=10")
    opts.results_dir.mkdir(parents=True,exist_ok=True)
    rows=[]
    for scenario in SCENARIOS:
        for sample in range(1,opts.samples+1):
            with tempfile.TemporaryDirectory(prefix="xdrive-cas-a04b-") as temp:
                row=trial(Path(temp)/"fixture",scenario,sample,opts.object_bytes,opts.source_count,opts.stage_budget_seconds)
            assert row["passed"]
            (opts.results_dir/f"{scenario}-{sample}.json").write_text(json.dumps(row,indent=2)+"\n")
            rows.append(row)
            print("CAS_A04B_N3_SAMPLE "+json.dumps({"scenario":scenario,"sample":sample,
                "tar_bytes":row["two_full_tar_allocated_bytes"],
                "offline_bytes":row["offline_two_generation_allocated_bytes"]}),flush=True)
    metrics={}
    for scenario in SCENARIOS:
        matched=[r for r in rows if r["scenario"]==scenario]
        m=lambda key:median(r[key] for r in matched)
        tar_space=m("two_full_tar_allocated_bytes")
        offline_space=m("offline_two_generation_allocated_bytes")
        tar_io=m("full_tar_kernel_write_bytes")
        offline_io=m("offline_kernel_write_bytes")
        metrics[scenario]={"n":len(matched),"tar_disk_bytes_p50":tar_space,
            "offline_disk_bytes_p50":offline_space,"tar_kernel_write_bytes_p50":tar_io,
            "offline_kernel_write_bytes_p50":offline_io,
            "offline_to_tar_disk_ratio":round(offline_space/tar_space,6),
            "offline_to_tar_write_ratio":round(offline_io/tar_io,6),
            "gen2_tar_ms_p50":median(r["phases"]["tar2"]["wall_ms"] for r in matched),
            "gen2_offline_ms_p50":median(r["phases"]["candidate2"]["wall_ms"] for r in matched),
            "gen2_tar_restore_ms_p50":median(r["phases"]["tar_restore_2"]["wall_ms"] for r in matched),
            "gen2_offline_restore_ms_p50":median(r["phases"]["candidate_restore_2"]["wall_ms"] for r in matched)}
        if opts.source_count==100 and opts.object_bytes==4*MIB:
            limit=.80 if scenario=="all-new-versions" else .55
            assert offline_space/tar_space<=limit,(scenario,"physical storage budget")
            assert offline_io/tar_io<=limit,(scenario,"physical kernel IO budget")
    summary={"workload_id":"CAS-A04b/real-400MiB-same-source-two-generation-offline-blob-snapshot-vs-full-tar",
        "n_per_scenario":opts.samples,"source_count":opts.source_count,"object_bytes":opts.object_bytes,
        "stage_budget_seconds":opts.stage_budget_seconds,"metrics":metrics,
        "passed":len(rows)==3*opts.samples,"production_changed":False,
        "scope":"True fsynced physical CAS, authentic old full tar file-data stage vs INDEPENDENT offline immutable hash-object manifest backup; NOT actual restic/Kopia/Borg binary, DB-consistent Server backup, online CDC, OS-installed PWA or GUI"}
    (opts.results_dir/"summary.json").write_text(json.dumps(summary,indent=2)+"\n")
    print("CAS_A04B_N3_SUMMARY "+json.dumps(summary),flush=True)
if __name__=="__main__":
    main()
