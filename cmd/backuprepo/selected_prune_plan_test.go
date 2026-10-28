package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSelectedPrunePlanExactMiddlePreviewAndNoMutation(t *testing.T) {
	root := t.TempDir()
	source, repo := filepath.Join(root, "source"), filepath.Join(root, "repo")
	if err := os.MkdirAll(source, 0700); err != nil {
		t.Fatal(err)
	}
	oldHash := testCAS(t, source, "only first and middle generations")
	first := retentionFixtureSnapshot(t, repo, source, "xdrive-backup-20261023T010000Z")
	middleOnly := testCAS(t, source, "only middle generation")
	shared := testCAS(t, source, "shared by middle and newest")
	middle := retentionFixtureSnapshot(t, repo, source, "xdrive-backup-20261024T010000Z")
	for _, hash := range []string{oldHash, middleOnly} {
		if err := os.Remove(filepath.Join(source, filepath.FromSlash(casRoot), hash[:2], hash)); err != nil {
			t.Fatal(err)
		}
	}
	newest := retentionFixtureSnapshot(t, repo, source, "xdrive-backup-20261025T010000Z")
	orphanBytes := []byte("unreferenced valid CAS bytes")
	orphanDigest := sha256.Sum256(orphanBytes)
	orphanHash := fmt.Sprintf("%x", orphanDigest)
	writeTestFile(t, objectPath(repo, orphanHash), orphanBytes)

	p, err := planSelectedPrune(repo, filepath.Base(middle), "fast")
	if err != nil {
		t.Fatal(err)
	}
	if p.Protocol != "xdrive-backup-selected-prune-plan-v1" ||
		p.Mode != "read_only" || p.DeleteEnabled ||
		p.Validation != "snapshot_sha256_and_cas_size" ||
		p.Snapshot != filepath.Base(middle) ||
		p.CommittedSnapshots != 3 || p.SurvivingSnapshots != 2 ||
		p.SelectedCASObjects != 3 || p.SharedCASObjects != 2 ||
		p.ExclusiveCASObjects != 1 ||
		p.ExclusiveCASBytes != int64(len("only middle generation")) ||
		p.UnreferencedObjects != 1 || p.UnreferencedBytes != int64(len(orphanBytes)) ||
		p.SelectedSnapshotBytes <= 0 ||
		p.PotentialLogicalBytes != p.SelectedSnapshotBytes+p.ExclusiveCASBytes+p.UnreferencedBytes {
		t.Fatalf("unsafe or inaccurate selected preview: %+v", p)
	}
	deep, err := planSelectedPrune(repo, filepath.Base(middle), "deep")
	if err != nil {
		t.Fatal(err)
	}
	if deep.Validation != "snapshot_sha256_and_full_cas_sha256" ||
		deep.HashedObjects != 4 || deep.HashedBytes <= 0 ||
		deep.PotentialLogicalBytes != p.PotentialLogicalBytes {
		t.Fatalf("deep mode must audit entire CAS and retain same selection: %+v", deep)
	}
	var output bytes.Buffer
	if err := runWithReportWriter([]string{
		"preview-delete-snapshot", "--repo", repo, "--snapshot", filepath.Base(middle), "--mode", "deep",
	}, &output); err != nil {
		t.Fatal(err)
	}
	var decoded selectedPrunePlan
	if err := json.Unmarshal(output.Bytes(), &decoded); err != nil || decoded != deep {
		t.Fatalf("CLI preview changed verified report: %+v %v", decoded, err)
	}
	for _, path := range []string{first, middle, newest, objectPath(repo, oldHash),
		objectPath(repo, middleOnly), objectPath(repo, shared), objectPath(repo, orphanHash)} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("read-only selected preview changed repository: %s: %v", path, err)
		}
	}
	if _, err := os.Stat(filepath.Join(repo, ".backup.lock")); !os.IsNotExist(err) {
		t.Fatalf("preview created a writer lock or mutated metadata: %v", err)
	}
}

func TestSelectedPrunePlanFailsClosedOnUnsafeAndStaleGeneration(t *testing.T) {
	for _, fault := range []string{"last", "unknown", "traversal", "staging", "symlink",
		"corrupt-hash", "corrupt-metadata", "corrupt-survivor-archive", "pending-retirement"} {
		t.Run(fault, func(t *testing.T) {
			root := t.TempDir()
			src, repo := filepath.Join(root, "source"), filepath.Join(root, "repo")
			if err := os.MkdirAll(src, 0700); err != nil {
				t.Fatal(err)
			}
			hash := testCAS(t, src, "known verified CAS")
			old := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261023T010000Z")
			var latest string
			if fault != "last" {
				latest = retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261024T010000Z")
			}
			selected := filepath.Base(old)
			switch fault {
			case "unknown":
				selected = "xdrive-backup-20261022T010000Z"
			case "traversal":
				selected = "../etc/shadow"
			case "staging":
				snapshotPath(t, repo, "xdrive-backup-20261025T010000Z.partial")
			case "symlink":
				if err := os.Symlink(old, filepath.Join(repo, "snapshots", "xdrive-backup-20261025T010000Z")); err != nil {
					t.Skipf("symlink unsupported: %v", err)
				}
			case "corrupt-hash":
				writeTestFile(t, objectPath(repo, hash), []byte(strings.Repeat("x", len("known verified CAS"))))
			case "corrupt-metadata":
				writeTestFile(t, filepath.Join(old, "SHA256SUMS.txt"), []byte("tampered"))
			case "corrupt-survivor-archive":
				writeTestFile(t, filepath.Join(latest, "legacy.tar"), []byte("unsafe tar"))
				retentionFixtureChecksum(t, latest)
			case "pending-retirement":
				if _, err := createPruneTransaction(filepath.Join(repo, pruneRetiredDirName)); err != nil {
					t.Fatal(err)
				}
			}
			mode := "fast"
			if fault == "corrupt-hash" {
				// Fast only validates CAS existence/size; deep must detect
				// same-size SHA-256 corruption, including orphan objects.
				mode = "deep"
			}
			if got, err := planSelectedPrune(repo, selected, mode); err == nil {
				t.Fatalf("invalid selected preview approved: %+v", got)
			}
			for _, path := range []string{old, objectPath(repo, hash)} {
				if _, err := os.Stat(path); err != nil {
					t.Fatalf("rejected preview mutated retained data: %v", err)
				}
			}
			if latest != "" {
				if _, err := os.Stat(latest); err != nil {
					t.Fatalf("rejected preview mutated newer backup: %v", err)
				}
			}
		})
	}
}

func TestSelectedPrunePlanCLIRejectsAllMutatingAndForeignArguments(t *testing.T) {
	root := t.TempDir()
	src, repo := filepath.Join(root, "source"), filepath.Join(root, "repo")
	if err := os.MkdirAll(src, 0700); err != nil {
		t.Fatal(err)
	}
	testCAS(t, src, "safe data")
	first := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261023T010000Z")
	second := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261024T010000Z")
	prefix := []string{"preview-delete-snapshot", "--repo", repo, "--snapshot", filepath.Base(first)}
	for _, extra := range [][]string{
		{"--yes"},
		{"--keep-last", "1"},
		{"--mode", "invalid"},
		{"--mode", "deep", "--yes"},
		{"--target", root},
		{"--source", src},
		{"--json"},
		{"--owner-uid", "0"},
	} {
		args := append(append([]string{}, prefix...), extra...)
		if err := runWithReportWriter(args, &bytes.Buffer{}); err == nil {
			t.Fatalf("invalid read-only selected preview accepted: %v", args)
		}
		for _, path := range []string{first, second} {
			if _, err := os.Stat(path); err != nil {
				t.Fatalf("invalid preview removed recovery point: %v", err)
			}
		}
	}
}
