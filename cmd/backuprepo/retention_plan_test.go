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
	writeTestFile(t, filepath.Join(snap, "manifest.json"), []byte(`{"format_version":2}`))
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
