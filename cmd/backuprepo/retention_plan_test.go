package main

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func retentionFixtureChecksum(t *testing.T, snapshot string) {
	t.Helper()
	var content strings.Builder
	for _, name := range committedV2Files {
		bytes, err := os.ReadFile(filepath.Join(snapshot, name))
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(bytes)
		fmt.Fprintf(&content, "%x  %s\n", sum, name)
	}
	writeTestFile(t, filepath.Join(snapshot, "SHA256SUMS.txt"), []byte(content.String()))
}

func retentionFixtureSnapshot(t *testing.T, repo, source, name string) string {
	t.Helper()
	snap := snapshotPath(t, repo, name)
	if err := capture(source, repo, snap); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(snap, "database.dump"), []byte("fixture pg_dump"))
	writeTestFile(t, filepath.Join(snap, "verify.json"), []byte("{}"))
	writeTestFile(t, filepath.Join(snap, "manifest.json"), []byte(`{"format_version":2,"file_data_included":true,"consistency_verified":true}`))
	retentionFixtureChecksum(t, snap)
	return snap
}

func TestRetentionPlanReadOnlySharedCASAndOrphans(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "source")
	repo := filepath.Join(root, "repository")
	if err := os.MkdirAll(src, 0700); err != nil {
		t.Fatal(err)
	}
	a := testCAS(t, src, "only old generations")
	s1 := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261023T010000Z")
	b := testCAS(t, src, "shared and current")
	s2 := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261024T010000Z")
	if err := os.Remove(filepath.Join(src, filepath.FromSlash(casRoot), a[:2], a)); err != nil {
		t.Fatal(err)
	}
	s3 := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261025T010000Z")
	orphan := sha256.Sum256([]byte("unreferenced bytes"))
	orphanHash := fmt.Sprintf("%x", orphan)
	writeTestFile(t, objectPath(repo, orphanHash), []byte("unreferenced bytes"))

	p, err := planRetention(repo, 1)
	if err != nil {
		t.Fatal(err)
	}
	if p.Mode != "read_only" || p.DeleteEnabled || p.CommittedSnapshots != 3 ||
		len(p.DropCandidates) != 2 || len(p.KeepSnapshots) != 1 {
		t.Fatalf("wrong retention summary: %+v", p)
	}
	if p.DropOnlyObjects != 1 || p.RetainedObjects != 1 || p.UnreferencedObjects != 1 ||
		p.DropOnlyObjectBytes != int64(len("only old generations")) ||
		p.UnreferencedBytes != int64(len("unreferenced bytes")) {
		t.Fatalf("did not honor CAS across multiple generations: %+v", p)
	}
	if p.PotentialLogicalBytes != p.DropSnapshotBytes+p.DropOnlyObjectBytes+p.UnreferencedBytes ||
		p.DropSnapshotBytes <= 0 {
		t.Fatalf("logical estimate mismatch: %+v", p)
	}
	two, err := planRetention(repo, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(two.DropCandidates) != 1 || two.DropOnlyObjects != 0 || two.RetainedObjects != 2 {
		t.Fatalf("second generation must protect old hash: %+v", two)
	}
	// A preview must not remove snapshots, orphans or the unrelated source.
	for _, path := range []string{s1, s2, s3, objectPath(repo, a), objectPath(repo, b), objectPath(repo, orphanHash)} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("read-only plan changed %s: %v", path, err)
		}
	}
	if _, err := os.Stat(filepath.Join(repo, ".backup.lock")); !os.IsNotExist(err) {
		t.Fatalf("preview must not create lock file: %v", err)
	}
	if err := run([]string{"retention-plan", "--repo", repo, "--keep-last", "1"}); err != nil {
		t.Fatalf("retention CLI: %v", err)
	}
	for _, args := range [][]string{
		{"retention-plan", "--repo", repo, "--keep-last", "0"},
		{"retention-plan", "--repo", repo, "--source", src},
		{"retention-plan", "--repo", repo, "--snapshot", filepath.Base(s3)},
		{"estimate", "--repo", repo, "--source", src, "--keep-last", "1"},
	} {
		if err := run(args); err == nil {
			t.Fatalf("accepted invalid plan arguments: %v", args)
		}
	}
}

func TestRetentionPlanFailsClosedOnUnknownOrInvalidRepositoryState(t *testing.T) {
	for _, fault := range []string{
		"staging", "bad-checksum", "bad-index", "missing-CAS",
		"wrong-size-CAS", "unknown-object", "symlink-bucket",
		"unknown-snapshot", "bad-timestamp", "non-v2", "extra-snapshot-file",
	} {
		t.Run(fault, func(t *testing.T) {
			root := t.TempDir()
			src := filepath.Join(root, "source")
			repo := filepath.Join(root, "repository")
			if err := os.MkdirAll(src, 0700); err != nil {
				t.Fatal(err)
			}
			hash := testCAS(t, src, "expected CAS object")
			snap := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261025T010000Z")
			switch fault {
			case "staging":
				snapshotPath(t, repo, "xdrive-backup-20261026T000000Z.partial")
			case "bad-checksum":
				writeTestFile(t, filepath.Join(snap, "SHA256SUMS.txt"), []byte("bad"))
			case "bad-index":
				writeTestFile(t, filepath.Join(snap, "objects.index"), []byte("unsafe-hash\t123\n"))
				retentionFixtureChecksum(t, snap)
			case "missing-CAS":
				if err := os.Remove(objectPath(repo, hash)); err != nil {
					t.Fatal(err)
				}
			case "wrong-size-CAS":
				writeTestFile(t, objectPath(repo, hash), []byte("changed"))
			case "unknown-object":
				writeTestFile(t, filepath.Join(repo, "objects", "sha256", hash[:2], ".cas-new-in-progress"), []byte("staging"))
			case "symlink-bucket":
				bucket := filepath.Dir(objectPath(repo, hash))
				if err := os.Rename(bucket, bucket+"-hold"); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(bucket+"-hold", bucket); err != nil {
					t.Skipf("symlinks unavailable: %v", err)
				}
			case "unknown-snapshot":
				snapshotPath(t, repo, "malformed")
			case "bad-timestamp":
				snapshotPath(t, repo, "xdrive-backup-old-v2")
			case "non-v2":
				writeTestFile(t, filepath.Join(snap, "manifest.json"), []byte(`{"format_version":1}`))
				retentionFixtureChecksum(t, snap)
			case "extra-snapshot-file":
				writeTestFile(t, filepath.Join(snap, "unexpected"), []byte("junk"))
			}
			if p, err := planRetention(repo, 1); err == nil {
				t.Fatalf("unsafe %s produced a plan: %+v", fault, p)
			}
		})
	}
}

func TestRetentionPlanZeroObjectsAndNoDeletions(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "source")
	repo := filepath.Join(root, "repo")
	if err := os.MkdirAll(source, 0700); err != nil {
		t.Fatal(err)
	}
	snapshot := retentionFixtureSnapshot(t, repo, source, "xdrive-backup-20261025T020000Z")
	plan, err := planRetention(repo, 7)
	if err != nil {
		t.Fatal(err)
	}
	if plan.DropOnlyObjects != 0 || plan.UnreferencedObjects != 0 ||
		plan.DropSnapshotBytes != 0 || len(plan.KeepSnapshots) != 1 {
		t.Fatalf("empty CAS must not invent savings: %+v", plan)
	}
	if _, err := os.Stat(snapshot); err != nil {
		t.Fatal(err)
	}
}

func TestRetentionPlanDeepAuditsOnceAndRejectsSameSizeCorruption(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "source")
	repo := filepath.Join(root, "repo")
	if err := os.MkdirAll(source, 0700); err != nil {
		t.Fatal(err)
	}
	content := "same-size-check-with-shared-CAS"
	hash := testCAS(t, source, content)
	first := retentionFixtureSnapshot(t, repo, source, "xdrive-backup-20261024T010000Z")
	second := retentionFixtureSnapshot(t, repo, source, "xdrive-backup-20261025T010000Z")
	orphanContent := "orphan-unreferenced-CAS"
	orphanSum := sha256.Sum256([]byte(orphanContent))
	orphanHash := fmt.Sprintf("%x", orphanSum)
	writeTestFile(t, objectPath(repo, orphanHash), []byte(orphanContent))

	full, err := planRetentionWithMode(repo, 1, "deep")
	if err != nil {
		t.Fatal(err)
	}
	if full.DeleteEnabled || full.Validation != "snapshot_sha256_and_full_cas_sha256" ||
		full.HashedObjects != 2 || full.HashedBytes != int64(len(content)+len(orphanContent)) {
		t.Fatalf("deep should audit unique referenced and orphan objects once: %+v", full)
	}
	fast, err := planRetention(repo, 1)
	if err != nil || fast.HashedObjects != 0 || fast.HashedBytes != 0 {
		t.Fatalf("default must not hash CAS content: %+v %v", fast, err)
	}

	for _, tc := range []struct {
		name, hash, original string
	}{
		{"referenced", hash, content},
		{"unreferenced", orphanHash, orphanContent},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := objectPath(repo, tc.hash)
			writeTestFile(t, path, []byte(strings.Repeat("x", len(tc.original))))
			if _, err := planRetention(repo, 1); err != nil {
				t.Fatalf("fast scan should not imply same-size content validation: %v", err)
			}
			if invalid, err := planRetentionWithMode(repo, 1, "deep"); err == nil {
				t.Fatalf("deep scan accepted same-size corrupt CAS: %+v", invalid)
			}
			writeTestFile(t, path, []byte(tc.original))
			if _, err := planRetentionWithMode(repo, 1, "deep"); err != nil {
				t.Fatalf("deep scan failed after restoring valid object: %v", err)
			}
		})
	}
	for _, path := range []string{first, second, objectPath(repo, hash), objectPath(repo, orphanHash)} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("read-only deep audit altered %s: %v", path, err)
		}
	}
	if _, err := os.Lstat(filepath.Join(repo, ".backup.lock")); !os.IsNotExist(err) {
		t.Fatalf("Go helper must not create a repository lock: %v", err)
	}

	if err := run([]string{"retention-plan", "--repo", repo, "--keep-last", "1", "--mode", "deep"}); err != nil {
		t.Fatalf("explicit deep CLI: %v", err)
	}
	for _, args := range [][]string{
		{"retention-plan", "--repo", repo, "--mode", "invalid"},
		{"estimate", "--repo", repo, "--source", source, "--mode", "deep"},
		{"verify", "--repo", repo, "--snapshot", filepath.Base(first), "--mode", "deep"},
	} {
		if err := run(args); err == nil {
			t.Fatalf("accepted invalid retention mode argument: %v", args)
		}
	}
}

func TestRetentionPlanRejectsUntrustedV2ManifestWithFreshChecksums(t *testing.T) {
	for _, tc := range []struct {
		name     string
		manifest string
	}{
		{"duplicate-version", `{"format_version":1,"format_version":2,"file_data_included":true,"consistency_verified":true}`},
		{"duplicate-consistency", `{"format_version":2,"file_data_included":true,"consistency_verified":false,"consistency_verified":true}`},
		{"nested-duplicate", `{"format_version":2,"file_data_included":true,"consistency_verified":true,"metadata":{"x":1,"x":2}}`},
		{"not-source-consistent", `{"format_version":2,"file_data_included":true,"consistency_verified":false}`},
		{"missing-consistency", `{"format_version":2,"file_data_included":true}`},
		{"wrong-consistency-type", `{"format_version":2,"file_data_included":true,"consistency_verified":"true"}`},
		{"database-only", `{"format_version":2,"file_data_included":false,"consistency_verified":true}`},
		{"missing-file-data", `{"format_version":2,"consistency_verified":true}`},
		{"wrong-version-type", `{"format_version":"2","file_data_included":true,"consistency_verified":true}`},
		{"trailing-value", `{"format_version":2,"file_data_included":true,"consistency_verified":true} null`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			src, repo := filepath.Join(root, "source"), filepath.Join(root, "repo")
			if err := os.MkdirAll(src, 0700); err != nil {
				t.Fatal(err)
			}
			hash := testCAS(t, src, "must not become a false recovery point")
			snap := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261025T010000Z")
			writeTestFile(t, filepath.Join(snap, "manifest.json"), []byte(tc.manifest))
			// A corrected checksum proves only the bytes, not unambiguous
			// source consistency or the existence of restorable files.
			retentionFixtureChecksum(t, snap)
			for _, mode := range []string{"fast", "deep"} {
				if report, err := planRetentionWithMode(repo, 1, mode); err == nil {
					t.Fatalf("unsafe v2 manifest passed %s plan: %+v", mode, report)
				}
			}
			for _, path := range []string{snap, objectPath(repo, hash)} {
				if _, err := os.Stat(path); err != nil {
					t.Fatalf("read-only rejection changed recovery data: %s: %v", path, err)
				}
			}
		})
	}
}
