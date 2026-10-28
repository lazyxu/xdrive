//go:build linux

package main

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func testPruneLock(t *testing.T, repo string) string {
	t.Helper()
	path := filepath.Join(repo, ".backup.lock")
	writeTestFile(t, path, nil)
	return path
}

func TestManualPrunePreservesSharedCASAndRecoversPendingRetirement(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "source")
	repo := filepath.Join(root, "repo")
	if err := os.MkdirAll(src, 0700); err != nil {
		t.Fatal(err)
	}
	old := testCAS(t, src, "only first generation")
	s1 := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261023T000000Z")
	shared := testCAS(t, src, "shared generation content")
	s2 := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261024T000000Z")
	if err := os.Remove(filepath.Join(src, filepath.FromSlash(casRoot), old[:2], old)); err != nil {
		t.Fatal(err)
	}
	s3 := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261025T000000Z")
	orphanContent := "valid unreferenced object"
	orphanSum := sha256.Sum256([]byte(orphanContent))
	orphan := fmt.Sprintf("%x", orphanSum)
	writeTestFile(t, objectPath(repo, orphan), []byte(orphanContent))
	testPruneLock(t, repo)

	// Model an interrupted run: first generation was atomically retired,
	// but the old CAS is still present. An explicit retry must recompute
	// protected references from the active snapshots, not the old plan.
	retiredRoot := filepath.Join(repo, pruneRetiredDirName)
	tx, err := createPruneTransaction(retiredRoot)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(s1, filepath.Join(tx, filepath.Base(s1))); err != nil {
		t.Fatal(err)
	}
	result, err := pruneRepository(repo, 1)
	if err != nil {
		t.Fatal(err)
	}
	if result.Automatic || result.Mode != "manual_confirmed" ||
		result.RecoveredTransactions != 1 || len(result.RetiredSnapshots) != 1 ||
		result.RetiredSnapshots[0] != filepath.Base(s2) ||
		result.DeletedCASObjects != 2 {
		t.Fatalf("incorrect manual prune result: %+v", result)
	}
	if _, err := os.Stat(s1); !os.IsNotExist(err) {
		t.Fatalf("retired oldest snapshot unexpectedly available: %v", err)
	}
	if _, err := os.Stat(s2); !os.IsNotExist(err) {
		t.Fatalf("old snapshot unexpectedly available: %v", err)
	}
	if _, err := os.Stat(s3); err != nil {
		t.Fatalf("retained snapshot removed: %v", err)
	}
	if _, err := os.Stat(objectPath(repo, shared)); err != nil {
		t.Fatalf("shared retained CAS removed: %v", err)
	}
	for _, hash := range []string{old, orphan} {
		if _, err := os.Stat(objectPath(repo, hash)); !os.IsNotExist(err) {
			t.Fatalf("unreferenced CAS was not safely reclaimed: %s: %v", hash, err)
		}
	}
	if _, err := verify(repo, s3, true); err != nil {
		t.Fatalf("remaining snapshot must fully restore its referenced CAS: %v", err)
	}
	destination := filepath.Join(root, "restored")
	if err := os.Mkdir(destination, 0700); err != nil {
		t.Fatal(err)
	}
	if err := restore(repo, s3, destination); err != nil {
		t.Fatalf("actual retained snapshot restore failed after prune: %v", err)
	}
	restoredBytes, err := os.ReadFile(filepath.Join(destination, filepath.FromSlash(casRoot), shared[:2], shared))
	if err != nil || string(restoredBytes) != "shared generation content" {
		t.Fatalf("restored shared CAS differs after prune: %v", err)
	}
	items, err := os.ReadDir(retiredRoot)
	if err != nil || len(items) != 0 {
		t.Fatalf("completed prune retained stale transactions: %v %+v", err, items)
	}
	again, err := pruneRepository(repo, 1)
	if err != nil || again.DeletedCASObjects != 0 || len(again.RetiredSnapshots) != 0 {
		t.Fatalf("manual prune must be repeatable and idempotent: %+v %v", again, err)
	}
}

func TestManualPruneRejectsCorruptSnapshotOrCASBeforeMutation(t *testing.T) {
	for _, fault := range []string{"same-size-CAS", "bad-checksum", "partial", "invalid-pending", "oversized-marker"} {
		t.Run(fault, func(t *testing.T) {
			root := t.TempDir()
			src, repo := filepath.Join(root, "source"), filepath.Join(root, "repo")
			if err := os.MkdirAll(src, 0700); err != nil {
				t.Fatal(err)
			}
			hash := testCAS(t, src, "first snapshot content")
			s1 := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261024T000000Z")
			testCAS(t, src, "second snapshot content")
			s2 := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261025T000000Z")
			testPruneLock(t, repo)
			switch fault {
			case "same-size-CAS":
				writeTestFile(t, objectPath(repo, hash), []byte(strings.Repeat("x", len("first snapshot content"))))
			case "bad-checksum":
				writeTestFile(t, filepath.Join(s1, "SHA256SUMS.txt"), []byte("tampered"))
			case "partial":
				snapshotPath(t, repo, "xdrive-backup-20261026T000000Z.partial")
			case "invalid-pending":
				path := filepath.Join(repo, pruneRetiredDirName, "tx-"+strings.Repeat("a", 32))
				writeTestFile(t, filepath.Join(path, "unknown.txt"), []byte("never delete"))
			case "oversized-marker":
				tx, err := createPruneTransaction(filepath.Join(repo, pruneRetiredDirName))
				if err != nil {
					t.Fatal(err)
				}
				writeTestFile(t, filepath.Join(tx, pruneMarkerName), []byte(strings.Repeat("x", 4096)))
			}
			if result, err := pruneRepository(repo, 1); err == nil {
				t.Fatalf("corrupt repository permitted destructive prune: %+v", result)
			}
			for _, name := range []string{s1, s2, objectPath(repo, hash)} {
				if _, err := os.Stat(name); err != nil {
					t.Fatalf("rejected prune altered %s: %v", name, err)
				}
			}
		})
	}
}

func TestManualPruneFailsClosedOnBusyAndUnsafeLock(t *testing.T) {
	root := t.TempDir()
	src, repo := filepath.Join(root, "source"), filepath.Join(root, "repo")
	if err := os.MkdirAll(src, 0700); err != nil {
		t.Fatal(err)
	}
	testCAS(t, src, "protected content")
	retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261025T000000Z")
	lock := testPruneLock(t, repo)
	file, err := os.Open(lock)
	if err != nil {
		t.Fatal(err)
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_SH|syscall.LOCK_NB); err != nil {
		t.Fatal(err)
	}
	if _, err := pruneRepository(repo, 1); err == nil {
		t.Fatal("prune ignored an active verify/restore reader")
	}
	_ = syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
	_ = file.Close()
	if err := os.Remove(lock); err != nil {
		t.Fatal(err)
	}
	sentinel := filepath.Join(root, "sentinel")
	writeTestFile(t, sentinel, []byte("unchanged"))
	if err := os.Symlink(sentinel, lock); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err := pruneRepository(repo, 1); err == nil {
		t.Fatal("prune followed unsafe repository lock symlink")
	}
	raw, err := os.ReadFile(sentinel)
	if err != nil || string(raw) != "unchanged" {
		t.Fatalf("unsafe lock modified sentinel: %v %q", err, raw)
	}
	if err := os.Remove(lock); err != nil {
		t.Fatal(err)
	}
	if err := syscall.Mkfifo(lock, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := pruneRepository(repo, 1); err == nil {
		t.Fatal("manual prune opened unsafe FIFO lock inode")
	}
}

func TestManualPruneExplicitFlagsAndPartialRecovery(t *testing.T) {
	root := t.TempDir()
	src, repo := filepath.Join(root, "source"), filepath.Join(root, "repo")
	if err := os.MkdirAll(src, 0700); err != nil {
		t.Fatal(err)
	}
	testCAS(t, src, "previous")
	old := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261024T000000Z")
	testCAS(t, src, "newer")
	current := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261025T000000Z")
	testPruneLock(t, repo)
	for _, args := range [][]string{
		{"prune", "--repo", repo, "--keep-last", "1"},
		{"prune", "--repo", repo, "--yes"},
		{"prune", "--repo", repo, "--keep-last", "1", "--yes", "--mode", "deep"},
		{"prune", "--repo", repo, "--keep-last", "0", "--yes"},
		{"retention-plan", "--repo", repo, "--yes"},
		{"verify", "--repo", repo, "--snapshot", filepath.Base(old), "--yes"},
	} {
		if err := run(args); err == nil {
			t.Fatalf("destructive or unrelated command accepted invalid arguments: %v", args)
		}
	}
	for _, name := range []string{old, current} {
		if _, err := os.Stat(name); err != nil {
			t.Fatalf("rejected command changed %s: %v", name, err)
		}
	}
	tx, err := createPruneTransaction(filepath.Join(repo, pruneRetiredDirName))
	if err != nil {
		t.Fatal(err)
	}
	retired := filepath.Join(tx, filepath.Base(old))
	if err := os.Rename(old, retired); err != nil {
		t.Fatal(err)
	}
	// Simulate process death after unlinking one retired metadata file.
	if err := os.Remove(filepath.Join(retired, "verify.json")); err != nil {
		t.Fatal(err)
	}
	got, err := pruneRepository(repo, 1)
	if err != nil || got.RecoveredTransactions != 1 {
		t.Fatalf("incomplete retired snapshot not recovered: %+v %v", got, err)
	}
	if _, err := verify(repo, current, true); err != nil {
		t.Fatalf("crash-safe prune broke current restore: %v", err)
	}
}

func TestManualPruneRetryAfterPartialCASUnlink(t *testing.T) {
	root := t.TempDir()
	src, repo := filepath.Join(root, "source"), filepath.Join(root, "repo")
	if err := os.MkdirAll(src, 0700); err != nil {
		t.Fatal(err)
	}
	oldHash := testCAS(t, src, "old snapshot only object")
	old := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261024T000000Z")
	if err := os.Remove(filepath.Join(src, filepath.FromSlash(casRoot), oldHash[:2], oldHash)); err != nil {
		t.Fatal(err)
	}
	newHash := testCAS(t, src, "current shared CAS")
	current := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261025T000000Z")
	testPruneLock(t, repo)
	tx, err := createPruneTransaction(filepath.Join(repo, pruneRetiredDirName))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(old, filepath.Join(tx, filepath.Base(old))); err != nil {
		t.Fatal(err)
	}
	// Simulate process death after the orphan CAS was already removed,
	// but before the retired snapshot files were removed.
	if err := os.Remove(objectPath(repo, oldHash)); err != nil {
		t.Fatal(err)
	}
	result, err := pruneRepository(repo, 1)
	if err != nil || result.RecoveredTransactions != 1 {
		t.Fatalf("retry must tolerate already-unlinked orphan CAS: %+v %v", result, err)
	}
	if _, err := os.Stat(objectPath(repo, newHash)); err != nil {
		t.Fatalf("retry removed current CAS: %v", err)
	}
	if _, err := verify(repo, current, true); err != nil {
		t.Fatalf("retry damaged retained restore point: %v", err)
	}
}

func TestManualPruneRejectsMalformedRetiredSnapshotBeforeDeletingCAS(t *testing.T) {
	for _, fault := range []string{"extra-file", "symlink-file"} {
		t.Run(fault, func(t *testing.T) {
			root := t.TempDir()
			src, repo := filepath.Join(root, "source"), filepath.Join(root, "repo")
			if err := os.MkdirAll(src, 0700); err != nil {
				t.Fatal(err)
			}
			oldHash := testCAS(t, src, "older object not referenced by current")
			old := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261024T000000Z")
			if err := os.Remove(filepath.Join(src, filepath.FromSlash(casRoot), oldHash[:2], oldHash)); err != nil {
				t.Fatal(err)
			}
			currentHash := testCAS(t, src, "current object")
			current := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261025T000000Z")
			testPruneLock(t, repo)
			tx, err := createPruneTransaction(filepath.Join(repo, pruneRetiredDirName))
			if err != nil {
				t.Fatal(err)
			}
			retired := filepath.Join(tx, filepath.Base(old))
			if err := os.Rename(old, retired); err != nil {
				t.Fatal(err)
			}
			switch fault {
			case "extra-file":
				writeTestFile(t, filepath.Join(retired, "unexpected"), []byte("never prune"))
			case "symlink-file":
				sentinel := filepath.Join(root, "sentinel")
				writeTestFile(t, sentinel, []byte("unchanged"))
				if err := os.Symlink(sentinel, filepath.Join(retired, "unexpected")); err != nil {
					t.Skipf("symlink unavailable: %v", err)
				}
			}
			if result, err := pruneRepository(repo, 1); err == nil {
				t.Fatalf("accepted malformed retirement: %+v", result)
			}
			// Even an orphan CAS left from the retired snapshot must survive
			// a structurally unsafe transaction, as must the retained snapshot.
			for _, path := range []string{objectPath(repo, oldHash), objectPath(repo, currentHash), current} {
				if _, err := os.Stat(path); err != nil {
					t.Fatalf("unsafe retirement mutated %s: %v", path, err)
				}
			}
		})
	}
}

func TestManualPruneRefusesEmptyActiveRepository(t *testing.T) {
	root := t.TempDir()
	src, repo := filepath.Join(root, "source"), filepath.Join(root, "repo")
	if err := os.MkdirAll(src, 0700); err != nil {
		t.Fatal(err)
	}
	hash := testCAS(t, src, "only backup object")
	snap := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261025T000000Z")
	testPruneLock(t, repo)
	tx, err := createPruneTransaction(filepath.Join(repo, pruneRetiredDirName))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(snap, filepath.Join(tx, filepath.Base(snap))); err != nil {
		t.Fatal(err)
	}
	if result, err := pruneRepository(repo, 1); err == nil {
		t.Fatalf("no active snapshots must not permit full-repository deletion: %+v", result)
	}
	if _, err := os.Stat(objectPath(repo, hash)); err != nil {
		t.Fatalf("empty active-repository preflight deleted CAS: %v", err)
	}
}

func TestManualPruneRejectsInvalidRetainedTarWithMatchingChecksums(t *testing.T) {
	root := t.TempDir()
	src, repo := filepath.Join(root, "source"), filepath.Join(root, "repo")
	if err := os.MkdirAll(src, 0700); err != nil {
		t.Fatal(err)
	}
	oldHash := testCAS(t, src, "old restore point")
	old := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261024T000000Z")
	if err := os.Remove(filepath.Join(src, filepath.FromSlash(casRoot), oldHash[:2], oldHash)); err != nil {
		t.Fatal(err)
	}
	newHash := testCAS(t, src, "new restore point")
	current := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261025T000000Z")
	testPruneLock(t, repo)
	writeTestFile(t, filepath.Join(current, "legacy.tar"), []byte("not-a-restorable-tar"))
	// The updated SHA256SUMS validates the corrupt tar bytes. Prune must
	// still reject this snapshot rather than destroying the prior restore.
	retentionFixtureChecksum(t, current)
	if result, err := pruneRepository(repo, 1); err == nil {
		t.Fatalf("accepted SHA-consistent but invalid latest restore tar: %+v", result)
	}
	for _, path := range []string{old, current, objectPath(repo, oldHash), objectPath(repo, newHash)} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("invalid retained archive pruned %s: %v", path, err)
		}
	}
}

func TestSelectedV2PruneOnlyRetiresRequestedMiddleGeneration(t *testing.T) {
	root := t.TempDir()
	src, repo := filepath.Join(root, "source"), filepath.Join(root, "repo")
	if err := os.MkdirAll(src, 0700); err != nil {
		t.Fatal(err)
	}
	old := testCAS(t, src, "first generation retained object")
	first := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261023T000000Z")
	middleOnly := testCAS(t, src, "middle generation exclusive object")
	shared := testCAS(t, src, "middle and newest shared object")
	middle := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261024T000000Z")
	if err := os.Remove(filepath.Join(src, filepath.FromSlash(casRoot), middleOnly[:2], middleOnly)); err != nil {
		t.Fatal(err)
	}
	newestOnly := testCAS(t, src, "newest generation unique object")
	newest := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261025T000000Z")
	testPruneLock(t, repo)

	result, err := pruneSelectedSnapshot(repo, filepath.Base(middle))
	if err != nil {
		t.Fatalf("selected prune rejected safe middle snapshot: %v", err)
	}
	if result.Mode != "manual_selected" || result.Automatic ||
		result.KeepLast != 2 || result.Verification != "exclusive_lock_and_full_cas_sha256" ||
		len(result.RetiredSnapshots) != 1 || result.RetiredSnapshots[0] != filepath.Base(middle) ||
		result.DeletedCASObjects != 1 {
		t.Fatalf("unexpected selected prune report: %+v", result)
	}
	if _, err := os.Lstat(middle); !os.IsNotExist(err) {
		t.Fatalf("selected generation still present: %v", err)
	}
	if _, err := os.Lstat(objectPath(repo, middleOnly)); !os.IsNotExist(err) {
		t.Fatalf("exclusive middle CAS should have been reclaimed: %v", err)
	}
	for _, path := range []string{objectPath(repo, old), objectPath(repo, shared),
		objectPath(repo, newestOnly), first, newest} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("retained data missing after selected prune: %v", err)
		}
	}
	for _, snapshot := range []string{first, newest} {
		if _, err := verify(repo, snapshot, true); err != nil {
			t.Fatalf("retained generation no longer verifiable: %v", err)
		}
	}
	if again, err := pruneSelectedSnapshot(repo, filepath.Base(middle)); err == nil {
		t.Fatalf("unknown/retired generation unexpectedly accepted: %+v", again)
	}
	for _, snapshot := range []string{first, newest} {
		if _, err := os.Stat(snapshot); err != nil {
			t.Fatalf("rejected repeat deleted another snapshot: %v", err)
		}
	}
}

func TestSelectedV2PruneAllowsNewestButNeverTheLastRecoveryPoint(t *testing.T) {
	for _, target := range []string{"newest", "last"} {
		t.Run(target, func(t *testing.T) {
			root := t.TempDir()
			src, repo := filepath.Join(root, "source"), filepath.Join(root, "repo")
			if err := os.MkdirAll(src, 0700); err != nil {
				t.Fatal(err)
			}
			hash := testCAS(t, src, "kept generation content")
			first := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261023T000000Z")
			var latest string
			if target == "newest" {
				testCAS(t, src, "newest generation content")
				latest = retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261024T000000Z")
			}
			testPruneLock(t, repo)
			name := filepath.Base(first)
			if latest != "" {
				name = filepath.Base(latest)
			}
			out, err := pruneSelectedSnapshot(repo, name)
			if target == "last" {
				if err == nil {
					t.Fatalf("last recovery point was deleted: %+v", out)
				}
				if _, err := os.Stat(first); err != nil {
					t.Fatalf("last recovery snapshot disappeared: %v", err)
				}
			} else {
				if err != nil || len(out.RetiredSnapshots) != 1 || out.RetiredSnapshots[0] != name {
					t.Fatalf("newest generation cannot be explicitly retired: %+v %v", out, err)
				}
				if _, err := os.Stat(first); err != nil {
					t.Fatalf("older valid restore point missing: %v", err)
				}
				if _, err := verify(repo, first, true); err != nil {
					t.Fatalf("retained older restore point corrupted: %v", err)
				}
			}
			if _, err := os.Stat(objectPath(repo, hash)); err != nil {
				t.Fatalf("protected CAS object removed: %v", err)
			}
		})
	}
}

func TestSelectedV2PruneRejectsUnsafeOrCorruptRepositoriesBeforeMutation(t *testing.T) {
	for _, bad := range []string{"unknown", "traversal", "partial", "same-size-cas", "unsafe-symlink", "bad-legacy"} {
		t.Run(bad, func(t *testing.T) {
			root := t.TempDir()
			src, repo := filepath.Join(root, "source"), filepath.Join(root, "repo")
			if err := os.MkdirAll(src, 0700); err != nil {
				t.Fatal(err)
			}
			hash := testCAS(t, src, "selected deletion source content")
			first := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261023T000000Z")
			second := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261024T000000Z")
			testPruneLock(t, repo)
			target := filepath.Base(first)
			switch bad {
			case "unknown":
				target = "xdrive-backup-20261025T000000Z"
			case "traversal":
				target = "../../etc/shadow"
			case "partial":
				snapshotPath(t, repo, "xdrive-backup-20261025T000000Z.partial")
			case "same-size-cas":
				writeTestFile(t, objectPath(repo, hash), []byte(strings.Repeat("x", len("selected deletion source content"))))
			case "unsafe-symlink":
				if err := os.Symlink(second, filepath.Join(repo, "snapshots", "xdrive-backup-20261025T000000Z")); err != nil {
					t.Fatal(err)
				}
			case "bad-legacy":
				writeTestFile(t, filepath.Join(second, "legacy.tar"), []byte("not an archive"))
			}
			if out, err := pruneSelectedSnapshot(repo, target); err == nil {
				t.Fatalf("unsafe selected deletion unexpectedly succeeded: %+v", out)
			}
			for _, path := range []string{first, second, objectPath(repo, hash)} {
				if _, err := os.Lstat(path); err != nil {
					t.Fatalf("rejected action modified committed data: %v", err)
				}
			}
		})
	}
}

func TestSelectedV2PruneCLIRequiresExactConfirmationAndNoOtherFlags(t *testing.T) {
	root := t.TempDir()
	src, repo := filepath.Join(root, "source"), filepath.Join(root, "repo")
	if err := os.MkdirAll(src, 0700); err != nil {
		t.Fatal(err)
	}
	testCAS(t, src, "protected content")
	first := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261023T000000Z")
	second := retentionFixtureSnapshot(t, repo, src, "xdrive-backup-20261024T000000Z")
	testPruneLock(t, repo)
	prefix := []string{"delete-snapshot", "--repo", repo, "--snapshot", filepath.Base(first)}
	for _, extra := range [][]string{
		nil,
		{"--keep-last", "1", "--yes"},
		{"--mode", "fast", "--yes"},
		{"--target", root, "--yes"},
		{"--source", src, "--yes"},
		{"--json", "--yes"},
	} {
		args := append(append([]string{}, prefix...), extra...)
		if err := runWithReportWriter(args, os.Stdout); err == nil {
			t.Fatalf("unsafe selected deletion arguments accepted: %v", args)
		}
		if _, err := os.Stat(first); err != nil {
			t.Fatalf("rejected CLI call removed selected snapshot: %v", err)
		}
		if _, err := os.Stat(second); err != nil {
			t.Fatalf("rejected CLI call removed protected snapshot: %v", err)
		}
	}
}
