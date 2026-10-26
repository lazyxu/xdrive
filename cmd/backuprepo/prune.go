package main

import (
	"archive/tar"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// pruneRepository is an explicitly authorized, offline-only maintenance
// operation. It uses the same exclusive inode lock as v2 capture and the
// opposite of the reader leases held by verify/restore. It never touches /data.
//
// Interrupted cleanup is retried by another explicit prune invocation:
// already-retired generations are not part of the live snapshot index, while
// all live indexes are revalidated before any CAS object is unlinked.
type pruneReport struct {
	Mode                     string   `json:"mode"`
	KeepLast                 int      `json:"keep_last"`
	RetiredSnapshots         []string `json:"retired_snapshots"`
	RecoveredTransactions    int      `json:"recovered_transactions"`
	DeletedCASObjects        int      `json:"deleted_cas_objects"`
	DeletedCASLogicalBytes   int64    `json:"deleted_cas_logical_bytes"`
	DeletedSnapshotFiles     int      `json:"deleted_snapshot_files"`
	DeletedSnapshotFileBytes int64    `json:"deleted_snapshot_file_bytes"`
	Verification             string   `json:"verification"`
	Automatic                bool     `json:"automatic"`
}

const (
	pruneRetiredDirName = ".prune-retired"
	pruneMarkerName     = ".xdrive-prune-v1"
	pruneMarkerBody     = "xdrive-prune-transaction-v1"
)

func canonicalPruneSnapshotName(name string) bool {
	if !strings.HasPrefix(name, "xdrive-backup-") || !safeName(name) {
		return false
	}
	_, err := time.Parse("20060102T150405Z", strings.TrimPrefix(name, "xdrive-backup-"))
	return err == nil
}

func validateRetiredSnapshotFiles(snapshot string) error {
	files, err := os.ReadDir(snapshot)
	if err != nil {
		return err
	}
	allowed := map[string]bool{"SHA256SUMS.txt": true}
	for _, name := range committedV2Files {
		allowed[name] = true
	}
	// A previous attempt may have unlinked any subset of expected files.
	// Reject ALL unexpected names or non-regular inodes before the next prune
	// can rename more snapshots or unlink any CAS object.
	for _, file := range files {
		if !allowed[file.Name()] {
			return fmt.Errorf("unexpected retired snapshot file %q", file.Name())
		}
		if _, err := regularFile(filepath.Join(snapshot, file.Name())); err != nil {
			return err
		}
	}
	return nil
}

func pendingPruneTransactions(root string) ([]string, error) {
	st, err := os.Lstat(root)
	if errors.Is(err, os.ErrNotExist) {
		return []string{}, nil
	}
	if err != nil {
		return nil, err
	}
	if !st.IsDir() || st.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("unsafe backup prune retirement directory")
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	var txns []string
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasPrefix(name, "tx-") || len(name) != 35 {
			return nil, fmt.Errorf("unexpected retired backup entry %q", name)
		}
		if _, err := hex.DecodeString(strings.TrimPrefix(name, "tx-")); err != nil {
			return nil, errors.New("invalid retired backup transaction name")
		}
		path := filepath.Join(root, name)
		stat, err := os.Lstat(path)
		if err != nil || !stat.IsDir() || stat.Mode()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("unsafe retired backup transaction %q", name)
		}
		children, err := os.ReadDir(path)
		if err != nil {
			return nil, err
		}
		markerFound := false
		for _, child := range children {
			if child.Name() == pruneMarkerName {
				markerPath := filepath.Join(path, pruneMarkerName)
				st, err := regularFile(markerPath)
				if err != nil {
					return nil, err
				}
				if st.Size() != int64(len(pruneMarkerBody)) {
					return nil, fmt.Errorf("invalid retired backup marker size for %s", name)
				}
				raw, err := os.ReadFile(markerPath)
				if err != nil || string(raw) != pruneMarkerBody {
					return nil, fmt.Errorf("invalid retired backup marker for %s", name)
				}
				markerFound = true
				continue
			}
			if !canonicalPruneSnapshotName(child.Name()) {
				return nil, fmt.Errorf("unexpected retired backup snapshot %q", child.Name())
			}
			retiredSnapshot := filepath.Join(path, child.Name())
			childStat, err := os.Lstat(retiredSnapshot)
			if err != nil || !childStat.IsDir() || childStat.Mode()&os.ModeSymlink != 0 {
				return nil, fmt.Errorf("unsafe retired backup snapshot %q", child.Name())
			}
			if err := validateRetiredSnapshotFiles(retiredSnapshot); err != nil {
				return nil, err
			}
		}
		// A crash can leave a newly created but still-empty transaction
		// directory; this is safe to remove on a later explicit retry.
		if !markerFound && len(children) != 0 {
			return nil, fmt.Errorf("retired backup transaction has no marker: %s", name)
		}
		txns = append(txns, path)
	}
	return txns, nil
}

func createPruneTransaction(root string) (string, error) {
	if err := os.MkdirAll(root, 0700); err != nil {
		return "", err
	}
	if err := requireRepositoryDirs(root); err != nil {
		return "", err
	}
	// The retirement root may be new. Make its directory entry durable in
	// the repository parent before relocating any committed snapshot into it.
	if err := syncDirectory(filepath.Dir(root)); err != nil {
		return "", err
	}
	var entropy [16]byte
	if _, err := rand.Read(entropy[:]); err != nil {
		return "", err
	}
	tx := filepath.Join(root, "tx-"+hex.EncodeToString(entropy[:]))
	if err := os.Mkdir(tx, 0700); err != nil {
		return "", err
	}
	f, err := os.OpenFile(filepath.Join(tx, pruneMarkerName), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", err
	}
	if _, err = f.WriteString(pruneMarkerBody); err != nil {
		f.Close()
		return "", err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return "", err
	}
	if err = f.Close(); err != nil {
		return "", err
	}
	if err = syncDirectory(tx); err != nil {
		return "", err
	}
	if err = syncDirectory(root); err != nil {
		return "", err
	}
	return tx, nil
}

func currentPruneReferences(repo string) (map[string]bool, error) {
	snapshotRoot := filepath.Join(repo, "snapshots")
	snapshots, err := os.ReadDir(snapshotRoot)
	if err != nil {
		return nil, err
	}
	protected := make(map[string]bool)
	for _, item := range snapshots {
		if !canonicalPruneSnapshotName(item.Name()) || !item.IsDir() {
			return nil, fmt.Errorf("invalid snapshot during prune: %s", item.Name())
		}
		if err := readIndex(filepath.Join(snapshotRoot, item.Name()), func(e entry) error {
			protected[e.hash] = true
			return nil
		}); err != nil {
			return nil, err
		}
	}
	return protected, nil
}

func unlinkUnusedPruneCAS(repo string, protected map[string]bool, result *pruneReport) error {
	root := filepath.Join(repo, "objects", "sha256")
	buckets, err := os.ReadDir(root)
	if err != nil {
		return err
	}
	for _, bucket := range buckets {
		name := bucket.Name()
		if len(name) != 2 || !shaValid(name+strings.Repeat("0", 62)) || !bucket.IsDir() {
			return fmt.Errorf("unsafe CAS bucket during prune: %s", name)
		}
		dir := filepath.Join(root, name)
		objects, err := os.ReadDir(dir)
		if err != nil {
			return err
		}
		deleted := false
		for _, object := range objects {
			hash := object.Name()
			if !shaValid(hash) || hash[:2] != name {
				return fmt.Errorf("unsafe CAS object during prune: %s", hash)
			}
			if protected[hash] {
				continue
			}
			path := filepath.Join(dir, hash)
			stat, err := regularFile(path)
			if err != nil {
				return err
			}
			if err := os.Remove(path); err != nil {
				return err
			}
			deleted = true
			result.DeletedCASObjects++
			if err := addPlanBytes(&result.DeletedCASLogicalBytes, stat.Size()); err != nil {
				return err
			}
		}
		if deleted {
			if err := syncDirectory(dir); err != nil {
				return err
			}
		}
	}
	return nil
}

func finishPruneTransaction(tx string, result *pruneReport) error {
	children, err := os.ReadDir(tx)
	if err != nil {
		return err
	}
	allowed := map[string]bool{"SHA256SUMS.txt": true}
	for _, name := range committedV2Files {
		allowed[name] = true
	}
	for _, child := range children {
		if child.Name() == pruneMarkerName {
			continue
		}
		snapshot := filepath.Join(tx, child.Name())
		files, err := os.ReadDir(snapshot)
		if err != nil {
			return err
		}
		for _, file := range files {
			if !allowed[file.Name()] {
				return fmt.Errorf("unsafe retired snapshot file %q", file.Name())
			}
			path := filepath.Join(snapshot, file.Name())
			stat, err := regularFile(path)
			if err != nil {
				return err
			}
			if err := os.Remove(path); err != nil {
				return err
			}
			result.DeletedSnapshotFiles++
			if err := addPlanBytes(&result.DeletedSnapshotFileBytes, stat.Size()); err != nil {
				return err
			}
		}
		if err := syncDirectory(snapshot); err != nil {
			return err
		}
		if err := os.Remove(snapshot); err != nil {
			return err
		}
	}
	marker := filepath.Join(tx, pruneMarkerName)
	if _, err := os.Lstat(marker); err == nil {
		if err := os.Remove(marker); err != nil {
			return err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := syncDirectory(tx); err != nil {
		return err
	}
	return os.Remove(tx)
}

func validatePruneRetainedArchives(repo string, names []string) error {
	for _, name := range names {
		if !canonicalPruneSnapshotName(name) {
			return fmt.Errorf("invalid retained snapshot name %q", name)
		}
		// SHA256SUMS checks bytes but cannot prove the contents of legacy.tar
		// follow the safe restorable path/type conventions. Do not remove old
		// restore points while the last committed ones contain invalid tar.
		snapshot := filepath.Join(repo, "snapshots", name)
		if err := walkLegacyArchive(snapshot, func(_ *tar.Header, _ *tar.Reader) error { return nil }); err != nil {
			return fmt.Errorf("retained v2 legacy archive is invalid: %s: %w", name, err)
		}
	}
	return nil
}

func pruneRepository(repo string, keepLast int) (pruneReport, error) {
	out := pruneReport{
		Mode: "manual_confirmed", KeepLast: keepLast,
		RetiredSnapshots: []string{}, Verification: "exclusive_lock_and_full_cas_sha256",
		Automatic: false,
	}
	if keepLast < 1 {
		return out, errors.New("manual prune requires keep-last >= 1")
	}
	// The helper itself, not just the host wrapper, owns the flock. Even a
	// directly invoked binary must coordinate with v2 writers and readers.
	unlock, err := acquirePruneLock(repo)
	if err != nil {
		return out, err
	}
	defer unlock()
	pendingRoot := filepath.Join(repo, pruneRetiredDirName)
	pending, err := pendingPruneTransactions(pendingRoot)
	if err != nil {
		return out, err
	}
	out.RecoveredTransactions = len(pending)
	// Preflight BEFORE any rename or unlink. This hashes each unique CAS
	// object once, in addition to verifying all committed snapshot metadata.
	plan, err := planRetentionWithMode(repo, keepLast, "deep")
	if err != nil {
		return out, err
	}
	// A valid pruning attempt always retains at least one committed restore
	// point. An empty active snapshot set plus a retirement journal could be
	// tampering or a broken prior operation: never delete every CAS object.
	if len(plan.KeepSnapshots) == 0 {
		return out, errors.New("manual prune requires at least one active committed v2 snapshot")
	}
	if err := validatePruneRetainedArchives(repo, plan.KeepSnapshots); err != nil {
		return out, err
	}
	if len(plan.DropCandidates) > 0 {
		tx, err := createPruneTransaction(pendingRoot)
		if err != nil {
			return out, err
		}
		pending = append(pending, tx)
		for _, name := range plan.DropCandidates {
			if !canonicalPruneSnapshotName(name) {
				return out, fmt.Errorf("unsafe snapshot name selected for prune: %s", name)
			}
			from := filepath.Join(repo, "snapshots", name)
			to := filepath.Join(tx, name)
			if _, err := os.Lstat(to); !errors.Is(err, os.ErrNotExist) {
				return out, fmt.Errorf("retired snapshot collision: %s", name)
			}
			if err := os.Rename(from, to); err != nil {
				return out, err
			}
			// Persist the new retirement destination first: after a crash the
			// old snapshot must not disappear before its new directory entry
			// is durable. Then persist the removal from active snapshots.
			if err := syncDirectory(tx); err != nil {
				return out, err
			}
			if err := syncDirectory(filepath.Join(repo, "snapshots")); err != nil {
				return out, err
			}
			out.RetiredSnapshots = append(out.RetiredSnapshots, name)
		}
	}
	// Re-read all committed indexes under the SAME exclusive lock after
	// renames. Snapshot files and all CAS contents were already SHA-checked
	// during preflight; repeat hashing large legacy tar files is unnecessary.
	// No cooperating writer can mutate the repository until the lock exits.
	protected, err := currentPruneReferences(repo)
	if err != nil {
		return out, err
	}
	if err := unlinkUnusedPruneCAS(repo, protected, &out); err != nil {
		return out, err
	}
	for _, tx := range pending {
		if err := finishPruneTransaction(tx, &out); err != nil {
			return out, err
		}
		if err := syncDirectory(pendingRoot); err != nil {
			return out, err
		}
	}
	return out, nil
}

func writePruneReport(report pruneReport) error {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(report)
}
