package main

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// retentionPlan is an offline, read-only capacity estimate, NOT an
// authorization to prune anything. Snapshot files are always SHA-checked.
// The default fast mode only checks CAS existence/size. Explicit deep mode
// hashes each unique CAS object, including unreferenced repository objects.
// A future mutating prune must revalidate under an exclusive repository lock.
type retentionPlan struct {
	Mode                  string   `json:"mode"`
	Validation            string   `json:"validation"`
	KeepLast              int      `json:"keep_last"`
	CommittedSnapshots    int      `json:"committed_snapshots"`
	KeepSnapshots         []string `json:"keep_snapshots"`
	DropCandidates        []string `json:"drop_candidates"`
	RetainedObjects       int      `json:"retained_objects"`
	DropOnlyObjects       int      `json:"drop_only_objects"`
	UnreferencedObjects   int      `json:"unreferenced_objects"`
	DropOnlyObjectBytes   int64    `json:"drop_only_object_bytes"`
	UnreferencedBytes     int64    `json:"unreferenced_bytes"`
	DropSnapshotBytes     int64    `json:"drop_snapshot_bytes"`
	PotentialLogicalBytes int64    `json:"potential_logical_bytes"`
	DeleteEnabled         bool     `json:"delete_enabled"`
	Warning               string   `json:"warning"`
	HashedObjects         int      `json:"hashed_objects"`
	HashedBytes           int64    `json:"hashed_bytes"`
}

var committedV2Files = []string{
	"database.dump", "verify.json", "manifest.json", "objects.index", "legacy.tar",
}

// Add byte counts without wrapping on untrusted repository sizes.
func addPlanBytes(to *int64, n int64) error {
	const max = int64(^uint64(0) >> 1)
	if n < 0 || *to > max-n {
		return errors.New("retention plan byte count overflow")
	}
	*to += n
	return nil
}

// validateCommittedSnapshot requires the exact published v2 file set. A
// dangling .partial, symlink or malformed snapshot aborts the entire report.
// It does not inspect PostgreSQL contents or decompress/parse legacy.tar.
func validateCommittedSnapshot(dir string) (int64, error) {
	files, err := os.ReadDir(dir)
	if err != nil {
		return 0, err
	}
	allowed := map[string]bool{"SHA256SUMS.txt": true}
	for _, name := range committedV2Files {
		allowed[name] = true
	}
	if len(files) != len(allowed) {
		return 0, fmt.Errorf("incomplete or unexpected files in snapshot %s", dir)
	}
	var bytesTotal int64
	for _, item := range files {
		if !allowed[item.Name()] {
			return 0, fmt.Errorf("unexpected file in snapshot %s: %s", dir, item.Name())
		}
		st, err := regularFile(filepath.Join(dir, item.Name()))
		if err != nil {
			return 0, err
		}
		if err := addPlanBytes(&bytesTotal, st.Size()); err != nil {
			return 0, err
		}
	}
	checksumPath := filepath.Join(dir, "SHA256SUMS.txt")
	checksumStat, err := regularFile(checksumPath)
	if err != nil {
		return 0, err
	}
	if checksumStat.Size() > 4096 {
		return 0, fmt.Errorf("oversized snapshot checksum manifest: %s", dir)
	}
	expected, err := os.ReadFile(checksumPath)
	if err != nil {
		return 0, err
	}
	var actual strings.Builder
	for _, name := range committedV2Files {
		f, err := os.Open(filepath.Join(dir, name))
		if err != nil {
			return 0, err
		}
		sum := sha256.New()
		_, readErr := io.Copy(sum, f)
		closeErr := f.Close()
		if readErr != nil {
			return 0, readErr
		}
		if closeErr != nil {
			return 0, closeErr
		}
		fmt.Fprintf(&actual, "%x  %s\n", sum.Sum(nil), name)
	}
	if string(expected) != actual.String() {
		return 0, fmt.Errorf("v2 checksum manifest mismatch in %s", dir)
	}
	var manifest struct {
		FormatVersion int `json:"format_version"`
	}
	raw, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		return 0, err
	}
	if err := json.Unmarshal(raw, &manifest); err != nil || manifest.FormatVersion != 2 {
		return 0, fmt.Errorf("unsupported or invalid v2 manifest in %s", dir)
	}
	return bytesTotal, nil
}

// planRetention is safe for a read-only Docker bind mount. It does not create
// the repository, touch lock files, or remove snapshots or CAS objects.
// In-flight .partial generations fail closed rather than allowing a stale
// reference map to masquerade as an actionable deletion list.
func planRetention(repo string, keepLast int) (retentionPlan, error) {
	return planRetentionWithMode(repo, keepLast, "fast")
}

func planRetentionWithMode(repo string, keepLast int, casMode string) (retentionPlan, error) {
	plan := retentionPlan{
		Mode: "read_only", Validation: "snapshot_sha256_and_cas_size",
		KeepLast: keepLast, KeepSnapshots: []string{}, DropCandidates: []string{},
		DeleteEnabled: false,
		Warning:       "Estimate only. No CAS content hashing, filesystem allocation measurement, exclusive lock or deletion. A later prune must revalidate all refs and CAS hashes under lock.",
	}
	if casMode != "fast" && casMode != "deep" {
		return plan, errors.New("retention-plan --mode must be fast or deep")
	}
	if casMode == "deep" {
		plan.Validation = "snapshot_sha256_and_full_cas_sha256"
		plan.Warning = "Deep CAS SHA-256 audit complete at scan time only. Read-only: no exclusive lock, physical allocation measurement or deletion. Future prune must revalidate under its own exclusive lease."
	}
	if keepLast < 1 {
		return plan, errors.New("keep-last must be >= 1")
	}
	if err := checkRepositoryLayout(repo); err != nil {
		return plan, err
	}
	snapshotRoot := filepath.Join(repo, "snapshots")
	snapshotDirs, err := os.ReadDir(snapshotRoot)
	if err != nil {
		return plan, err
	}
	var names []string
	for _, item := range snapshotDirs {
		name := item.Name()
		if strings.HasSuffix(name, ".partial") {
			return plan, fmt.Errorf("uncommitted snapshot blocks retention preview: %s", name)
		}
		if !strings.HasPrefix(name, "xdrive-backup-") || !safeName(name) {
			return plan, fmt.Errorf("unexpected snapshot entry: %s", name)
		}
		stamp := strings.TrimPrefix(name, "xdrive-backup-")
		if _, err := time.Parse("20060102T150405Z", stamp); err != nil {
			return plan, fmt.Errorf("snapshot has no canonical UTC timestamp: %s", name)
		}
		if st, err := os.Lstat(filepath.Join(snapshotRoot, name)); err != nil || !st.IsDir() {
			return plan, fmt.Errorf("non-directory or symlink snapshot %s: %v", name, err)
		}
		names = append(names, name)
	}
	sort.Strings(names)
	plan.CommittedSnapshots = len(names)
	dropCount := len(names) - keepLast
	if dropCount < 0 {
		dropCount = 0
	}
	plan.DropCandidates = append(plan.DropCandidates, names[:dropCount]...)
	plan.KeepSnapshots = append(plan.KeepSnapshots, names[dropCount:]...)
	// All references, including would-be dropped snapshots, must be valid.
	all := map[string]int64{}
	retained := map[string]bool{}
	for i, name := range names {
		snapshot := filepath.Join(snapshotRoot, name)
		snapshotBytes, err := validateCommittedSnapshot(snapshot)
		if err != nil {
			return plan, err
		}
		if i < dropCount {
			if err := addPlanBytes(&plan.DropSnapshotBytes, snapshotBytes); err != nil {
				return plan, err
			}
		}
		if err := readIndex(snapshot, func(item entry) error {
			if size, exists := all[item.hash]; exists && size != item.size {
				return fmt.Errorf("CAS size differs between snapshots: %s", item.hash)
			}
			all[item.hash] = item.size
			if i >= dropCount {
				retained[item.hash] = true
			}
			return nil
		}); err != nil {
			return plan, fmt.Errorf("read v2 index for %s: %w", name, err)
		}
	}
	root := filepath.Join(repo, "objects", "sha256")
	buckets, err := os.ReadDir(root)
	if err != nil {
		return plan, err
	}
	seen := map[string]bool{}
	for _, bucket := range buckets {
		name := bucket.Name()
		if len(name) != 2 || !shaValid(name+strings.Repeat("0", 62)) {
			return plan, fmt.Errorf("unexpected CAS bucket: %s", name)
		}
		dir := filepath.Join(root, name)
		if st, err := os.Lstat(dir); err != nil || !st.IsDir() {
			return plan, fmt.Errorf("unsafe CAS bucket %s: %v", name, err)
		}
		objects, err := os.ReadDir(dir)
		if err != nil {
			return plan, err
		}
		for _, object := range objects {
			hash := object.Name()
			if !shaValid(hash) || hash[:2] != name {
				return plan, fmt.Errorf("unexpected CAS repository object: %s", hash)
			}
			st, err := regularFile(filepath.Join(dir, hash))
			if err != nil {
				return plan, err
			}
			// Deep mode inspects the whole physical repository once, not once
			// per snapshot. Check even currently unreferenced/orphan objects;
			// a same-size corrupt CAS file is invisible to fast size checks.
			if casMode == "deep" {
				file, err := os.Open(filepath.Join(dir, hash))
				if err != nil {
					return plan, err
				}
				digest := sha256.New()
				readBytes, readErr := io.Copy(digest, file)
				closeErr := file.Close()
				if readErr != nil {
					return plan, readErr
				}
				if closeErr != nil {
					return plan, closeErr
				}
				if readBytes != st.Size() || fmt.Sprintf("%x", digest.Sum(nil)) != hash {
					return plan, fmt.Errorf("CAS content SHA-256 mismatch in repository: %s", hash)
				}
				plan.HashedObjects++
				if err := addPlanBytes(&plan.HashedBytes, readBytes); err != nil {
					return plan, err
				}
			}
			seen[hash] = true
			if size, referenced := all[hash]; referenced {
				if st.Size() != size {
					return plan, fmt.Errorf("CAS size mismatch in repository: %s", hash)
				}
				if retained[hash] {
					plan.RetainedObjects++
				} else {
					plan.DropOnlyObjects++
					if err := addPlanBytes(&plan.DropOnlyObjectBytes, st.Size()); err != nil {
						return plan, err
					}
				}
			} else {
				plan.UnreferencedObjects++
				if err := addPlanBytes(&plan.UnreferencedBytes, st.Size()); err != nil {
					return plan, err
				}
			}
		}
	}
	for hash := range all {
		if !seen[hash] {
			return plan, fmt.Errorf("referenced CAS missing from repository: %s", hash)
		}
	}
	for _, n := range []int64{plan.DropSnapshotBytes, plan.DropOnlyObjectBytes, plan.UnreferencedBytes} {
		if err := addPlanBytes(&plan.PotentialLogicalBytes, n); err != nil {
			return plan, err
		}
	}
	return plan, nil
}

func writeRetentionPlan(plan retentionPlan) error {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(plan)
}
