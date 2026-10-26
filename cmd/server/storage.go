package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	humanize "github.com/dustin/go-humanize"
	"github.com/lazyxu/xdrive/internal/config"
	"github.com/lazyxu/xdrive/internal/maintenance"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

const defaultStorageOwnerID = 65532

// v1 could remain current while cache files and independent lifecycle locks
// retained the host account's ownership after a migration.
const storageOwnershipMarker = ".ownership-v2"

func runStorageCommand(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: xdrive-server storage <prepare|health|verify|repair|repair-user-directories> [options]")
	}
	switch args[0] {
	case "prepare":
		return runStoragePrepare(args[1:])
	case "health":
		return runStorageHealth(args[1:])
	case "verify":
		return runStorageVerify(args[1:])
	case "repair":
		return runStorageRepair(args[1:])
	case "repair-user-directories":
		return runStorageRepairUserDirectories(args[1:])
	default:
		return fmt.Errorf("usage: xdrive-server storage <prepare|health|verify|repair|repair-user-directories> [options]")
	}
}

func runStorageVerify(args []string) error {
	fs := flag.NewFlagSet("storage verify", flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "write machine-readable JSON")
	summaryJSON := fs.Bool("summary-json", false, "write only issue counts and bounded samples")
	defaultMode := os.Getenv("XD_STORAGE_VERIFY_MODE")
	if defaultMode == "" {
		defaultMode = "fast"
	}
	modeName := fs.String("mode", defaultMode, "fast: metadata/read-access (default) or deep: full SHA-256")
	progress := fs.Bool("progress", os.Getenv("XD_STORAGE_VERIFY_PROGRESS") == "1", "emit bounded verification progress on stderr")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 || (*asJSON && *summaryJSON) {
		return fmt.Errorf("usage: xdrive-server storage verify [--mode fast|deep] [--json | --summary-json] [--progress]")
	}
	if *modeName != "fast" && *modeName != "deep" {
		return fmt.Errorf("unknown storage verify mode %q: expected fast or deep", *modeName)
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	options := maintenance.VerifyOptions{Mode: maintenance.VerifyMode(*modeName)}
	if *progress {
		options.OnProgress = func(p maintenance.VerifyProgress) {
			fmt.Fprintf(os.Stderr, "[xDrive] storage verify mode=%s phase=%s references=%d/%d hashed=%d bytes_read=%d scanned=%d elapsed_ms=%d\n",
				p.Mode, p.Phase, p.ReferencesDone, p.ReferencesTotal, p.HashedFiles, p.HashedBytes, p.ScannedEntries, p.ElapsedMillis)
		}
	}
	report, err := maintenance.VerifyWithOptions(context.Background(), db, cfg.StorageRoot, options)
	if err != nil {
		return err
	}
	if *summaryJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(summarizeStorageVerify(report)); err != nil {
			return err
		}
	} else if *asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(report); err != nil {
			return err
		}
	} else {
		fmt.Printf("referenced files:    %d\n", report.ReferencedFiles)
		fmt.Printf("referenced versions: %d\n", report.ReferencedVersions)
		fmt.Printf("blob files:          %d\n", report.BlobFiles)
		fmt.Printf("blob size:          %s\n", humanize.IBytes(uint64(max(int64(0), report.BlobBytes))))
		fmt.Printf("missing blobs:    %d\n", len(report.Missing))
		fmt.Printf("size mismatches:  %d\n", len(report.SizeMismatches))
		fmt.Printf("duplicate refs:   %d\n", len(report.DuplicateRefs))
		fmt.Printf("shared refs:      %d\n", len(report.SharedRefs))
		fmt.Printf("content ref drift:%d\n", len(report.ContentRefMismatch))
		fmt.Printf("orphan blobs:     %d\n", len(report.Orphans))
		fmt.Printf("hash mismatches:  %d\n", len(report.HashMismatches))
		fmt.Printf("ignored temp:     %d\n", report.IgnoredTemps)
		for _, issue := range report.Missing {
			fmt.Printf("MISSING node=%d key=%q expected=%s reason=%s\n", issue.NodeID, issue.StorageKey, humanize.IBytes(uint64(max(int64(0), issue.Expected))), issue.Reason)
		}
		for _, issue := range report.SizeMismatches {
			fmt.Printf("SIZE_MISMATCH node=%d key=%q expected=%s actual=%s\n", issue.NodeID, issue.StorageKey, humanize.IBytes(uint64(max(int64(0), issue.Expected))), humanize.IBytes(uint64(max(int64(0), issue.Actual))))
		}
		for _, issue := range report.DuplicateRefs {
			fmt.Printf("DUPLICATE_REFERENCE key=%q references=%d\n", issue.StorageKey, issue.References)
		}
		for _, issue := range report.SharedRefs {
			fmt.Printf("SHARED_REFERENCE key=%q references=%d\n", issue.StorageKey, issue.References)
		}
		for _, issue := range report.ContentRefMismatch {
			fmt.Printf("CONTENT_REF_MISMATCH sha256=%s key=%q expected=%d recorded=%d state=%s reason=%s\n",
				issue.SHA256, issue.StorageKey, issue.ExpectedRefs, issue.RecordedRefs, issue.State, issue.Reason)
		}
		for _, issue := range report.Orphans {
			fmt.Printf("ORPHAN key=%q size=%s\n", issue.StorageKey, humanize.IBytes(uint64(max(int64(0), issue.Size))))
		}
		for _, issue := range report.HashMismatches {
			fmt.Printf("HASH_MISMATCH node=%d version=%d key=%q expected=%s actual=%s\n",
				issue.NodeID, issue.VersionID, issue.StorageKey, issue.Expected, issue.Actual)
		}
	}
	if !report.OK() {
		return fmt.Errorf("storage consistency check failed")
	}
	return nil
}

func runStorageHealth(args []string) error {
	fs := flag.NewFlagSet("storage health", flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "write machine-readable JSON")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return fmt.Errorf("usage: xdrive-server storage health [--json]")
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	report, err := maintenance.CASHealth(db, maintenance.CASDeletingStaleAfter)
	if err != nil {
		return err
	}
	if *asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(report); err != nil {
			return err
		}
	} else {
		fmt.Printf("cas metadata health: status=%s ready=%d deleting=%d stale_deleting=%d missing_metadata=%d refcount_mismatch=%d state_mismatch=%d size_mismatch=%d key_hash_mismatch=%d invalid_state=%d\n",
			report.Status, report.ReadyBlobs, report.DeletingBlobs, report.StaleDeletingBlobs,
			report.MissingMetadata, report.RefCountMismatches, report.StateMismatches,
			report.SizeMismatches, report.KeyHashMismatches, report.InvalidStates)
	}
	if !report.Healthy {
		return fmt.Errorf("CAS metadata health check failed")
	}
	return nil
}

func runStorageRepair(args []string) error {
	fs := flag.NewFlagSet("storage repair", flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "write machine-readable JSON")
	dryRun := fs.Bool("dry-run", false, "show deterministic repairs without changing metadata")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return fmt.Errorf("usage: xdrive-server storage repair [--json] [--dry-run]")
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	report, err := maintenance.RepairCASMetadata(context.Background(), db, cfg.StorageRoot, *dryRun)
	if err != nil {
		return err
	}
	if *asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(report); err != nil {
			return err
		}
	} else {
		fmt.Printf("CAS repair: dry_run=%t actions=%d skipped=%d before=%s after=%s\n",
			report.DryRun, len(report.Actions), len(report.Skipped), report.Before.Status, report.After.Status)
		for _, action := range report.Actions {
			fmt.Printf("REPAIR kind=%s key=%q before_ref=%d after_ref=%d before_state=%s after_state=%s applied=%t\n",
				action.Kind, action.StorageKey, action.BeforeRefCount, action.AfterRefCount,
				action.BeforeState, action.AfterState, action.Applied)
		}
		for _, skipped := range report.Skipped {
			fmt.Printf("SKIP key=%q reason=%s\n", skipped.StorageKey, skipped.Reason)
		}
	}
	if !*dryRun && !report.After.Healthy {
		return fmt.Errorf("CAS metadata remains inconsistent after repair")
	}
	return nil
}

func runStoragePrepare(args []string) error {
	rootDefault := strings.TrimSpace(os.Getenv("XD_STORAGE_ROOT"))
	if rootDefault == "" {
		rootDefault = "/data"
	}

	fs := flag.NewFlagSet("storage prepare", flag.ContinueOnError)
	root := fs.String("root", rootDefault, "storage root")
	uid := fs.Int("uid", defaultStorageOwnerID, "runtime storage UID")
	gid := fs.Int("gid", defaultStorageOwnerID, "runtime storage GID")
	force := fs.Bool("force", false, "repair the complete storage tree even when the ownership marker is current")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 || *uid < 0 || *gid < 0 {
		return fmt.Errorf("usage: xdrive-server storage prepare [--root PATH] [--uid UID] [--gid GID] [--force]")
	}

	abs, err := prepareStorageRoot(*root, *uid, *gid, *force)
	if err != nil {
		return err
	}
	fmt.Printf("prepared storage root %s for uid=%d gid=%d\n", abs, *uid, *gid)
	return nil
}

func prepareStorageRoot(root string, uid, gid int, force bool) (string, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(abs, 0o750); err != nil {
		return "", fmt.Errorf("create storage root: %w", err)
	}
	info, err := os.Lstat(abs)
	if err != nil {
		return "", fmt.Errorf("stat storage root: %w", err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("storage root is not a directory")
	}

	staging := filepath.Join(abs, storage.UploadStagingDir)
	if existing, err := os.Lstat(staging); err == nil && (!existing.IsDir() || existing.Mode()&os.ModeSymlink != 0) {
		return "", fmt.Errorf("upload staging must be a real directory")
	} else if err != nil && !os.IsNotExist(err) {
		return "", err
	}
	if err := os.MkdirAll(staging, 0o750); err != nil {
		return "", fmt.Errorf("create upload staging directory: %w", err)
	}
	marker := filepath.Join(staging, storageOwnershipMarker)
	target := strconv.Itoa(uid) + ":" + strconv.Itoa(gid)
	if existing, err := os.Lstat(marker); err == nil {
		if !existing.Mode().IsRegular() {
			return "", fmt.Errorf("storage ownership marker must be a regular file")
		}
		if err := validateStorageSingleLink(existing); err != nil {
			return "", fmt.Errorf("storage ownership marker: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return "", err
	}

	fullRepair := force
	if !fullRepair {
		data, readErr := os.ReadFile(marker)
		fullRepair = readErr != nil || strings.TrimSpace(string(data)) != target
	}

	if fullRepair {
		if err := repairStorageTree(abs, abs, uid, gid); err != nil {
			return "", err
		}
	} else {
		if err := repairStorageEntry(abs, abs, uid, gid); err != nil {
			return "", err
		}
		if err := repairStorageTree(abs, staging, uid, gid); err != nil {
			return "", err
		}
	}

	// The upload ownership marker does not attest CAS traversal. A migrated
	// host can keep a correct marker while .xdrive-blobs or its sha256 shard
	// parents are unreadable to the runtime, breaking backup verification even
	// while /readyz is healthy. Touch ONLY the fixed CAS parent directories
	// (at most 258 paths), never walk/chown immutable blob files on this path.
	if err := repairCanonicalCASParents(abs, uid, gid); err != nil {
		return "", err
	}
	// All lifecycle lock inodes survive upgrades independently of the marker.
	// Live writers must open the same existing inodes after migration.
	if err := repairStorageLifecycleLocks(abs, uid, gid); err != nil {
		return "", err
	}
	// The upload ownership marker does not attest the separate, regenerable
	// thumbnail/poster cache. A migrated Server can be healthy while every
	// cold thumbnail PUT fails with EACCES. Repair only the fixed directories,
	// never recursively chown potentially 100k cached image files.
	if err := repairMediaCacheParents(abs, uid, gid); err != nil {
		return "", err
	}

	if err := writeStorageOwnershipMarker(abs, target, uid, gid); err != nil {
		return "", err
	}
	return abs, nil
}

// repairCanonicalCASParents repairs bounded directory metadata needed for
// immutable CAS reads. All paths are fixed canonical directories; files are
// deliberately untouched. Lstat prevents a symlink from escaping this root.
func repairCanonicalCASParents(root string, uid, gid int) error {
	casRoot := filepath.Join(root, storage.ContentBlobDir)
	found, err := repairCASParentIfPresent(root, casRoot, uid, gid)
	if err != nil || !found {
		return err
	}

	shaRoot := filepath.Join(casRoot, "sha256")
	found, err = repairCASParentIfPresent(root, shaRoot, uid, gid)
	if err != nil || !found {
		return err
	}

	// Every valid sha256 CAS object uses a two-hex shard directory. Probing
	// only these 256 possible parents is independent of library size.
	for shard := 0; shard < 256; shard++ {
		path := filepath.Join(shaRoot, fmt.Sprintf("%02x", shard))
		if _, err := repairCASParentIfPresent(root, path, uid, gid); err != nil {
			return err
		}
	}
	return nil
}

func repairCASParentIfPresent(root, path string, uid, gid int) (bool, error) {
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("stat canonical CAS directory %s: %w", path, err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return false, fmt.Errorf("canonical CAS parent %s must be a real directory", path)
	}
	if err := repairStorageEntryWithInfo(root, path, info, uid, gid); err != nil {
		return false, err
	}
	return true, nil
}

// repairStorageLifecycleLocks covers the temporary-write singleton plus both
// fixed shard directories, regardless of stored blob or cache-file count.
// No inode is removed, replaced, truncated, opened with O_TRUNC, or recreated:
// flock-based readers/writers must continue coordinating on the same inode.
// Unexpected/symlink/nonempty lock files are rejected, not silently blessed.
func repairStorageLifecycleLocks(root string, uid, gid int) error {
	for _, family := range storage.LifecycleLockFamilies() {
		lockRoot := filepath.Join(root, family.Directory)
		if family.Directory != "" {
			found, err := repairCASParentIfPresent(root, lockRoot, uid, gid)
			if err != nil {
				return err
			}
			if !found {
				continue
			}
		}
		for _, name := range family.Names {
			path := filepath.Join(lockRoot, name)
			info, err := os.Lstat(path)
			if os.IsNotExist(err) {
				continue
			}
			if err != nil {
				return fmt.Errorf("stat lifecycle lock %s: %w", path, err)
			}
			if !info.Mode().IsRegular() || info.Size() != 0 {
				return fmt.Errorf("lifecycle lock %s must be an empty regular file", path)
			}
			if err := validateStorageSingleLink(info); err != nil {
				return fmt.Errorf("lifecycle lock %s: %w", path, err)
			}
			if err := withPinnedStorageEntry(root, path, info, func(file *os.File, actual os.FileInfo) error {
				if err := validateStorageSingleLink(actual); err != nil {
					return err
				}
				if err := setStorageFileOwner(file, uid, gid); err != nil {
					return err
				}
				return setStorageFileMode(file, 0o600)
			}); err != nil {
				return fmt.Errorf("repair lifecycle lock %s: %w", path, err)
			}
		}
	}
	return nil
}

// repairMediaCacheParents makes existing regenerable cache directories
// readable/writable to the runtime even when the upload ownership marker is
// current. This is O(1) in photo count: one root, two categories, two "node"
// parents and at most 512 SHA-256 shard directories. Missing directories are
// created lazily by Local.Put; cached files and unrelated paths are untouched.
func repairMediaCacheParents(root string, uid, gid int) error {
	cacheRoot := filepath.Join(root, ".xdrive-media")
	found, err := repairMediaCacheParentIfPresent(root, cacheRoot, uid, gid)
	if err != nil || !found {
		return err
	}
	for _, category := range []string{"thumbnails", "posters"} {
		categoryRoot := filepath.Join(cacheRoot, category)
		found, err := repairMediaCacheParentIfPresent(root, categoryRoot, uid, gid)
		if err != nil {
			return err
		}
		if !found {
			continue
		}
		if _, err := repairMediaCacheParentIfPresent(root, filepath.Join(categoryRoot, "node"), uid, gid); err != nil {
			return err
		}
		for shard := 0; shard < 256; shard++ {
			if _, err := repairMediaCacheParentIfPresent(
				root, filepath.Join(categoryRoot, fmt.Sprintf("%02x", shard)), uid, gid,
			); err != nil {
				return err
			}
		}
	}
	return nil
}

// Reject symlinks and non-directories rather than following cache paths into
// arbitrary host locations. Only existing directory metadata is changed.
func repairMediaCacheParentIfPresent(root, path string, uid, gid int) (bool, error) {
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("stat media cache parent %s: %w", path, err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return false, fmt.Errorf("media cache parent %s must be a real directory", path)
	}
	if err := repairStorageEntryWithInfo(root, path, info, uid, gid); err != nil {
		return false, err
	}
	return true, nil
}

func repairStorageTree(root, tree string, uid, gid int) error {
	rootInfo, err := os.Lstat(root)
	if err != nil {
		return err
	}
	links, err := validateStorageTreeLinks(root, tree, rootInfo)
	if err != nil {
		return err
	}
	return filepath.Walk(tree, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := validateStorageSameDevice(rootInfo, info); err != nil {
			return fmt.Errorf("storage entry %s: %w", path, err)
		}
		if info.Mode().IsRegular() {
			identity, count, err := storageFileLinks(info)
			if err != nil {
				return err
			}
			if links[identity] != count {
				return fmt.Errorf("storage links changed after preflight")
			}
		}
		required := os.FileMode(0o400)
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		if filepath.Base(root) == storage.UploadStagingDir || relative == storage.UploadStagingDir ||
			strings.HasPrefix(relative, storage.UploadStagingDir+string(filepath.Separator)) {
			required = 0o600
		}
		return repairStorageEntryAccess(root, path, info, uid, gid, required)
	})
}

func repairStorageEntry(root, path string, uid, gid int) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	return repairStorageEntryWithInfo(root, path, info, uid, gid)
}

func repairStorageEntryWithInfo(root, path string, info os.FileInfo, uid, gid int) error {
	if info.Mode().IsRegular() {
		if err := validateStorageSingleLink(info); err != nil {
			return err
		}
	}
	return repairStorageEntryAccess(root, path, info, uid, gid, 0o400)
}

func repairStorageEntryAccess(root, path string, info os.FileInfo, uid, gid int, required os.FileMode) error {
	if !info.IsDir() && !info.Mode().IsRegular() {
		return fmt.Errorf("storage entry %s must be a real directory or regular file", path)
	}
	if info.IsDir() {
		required = 0o700
	}
	return withPinnedStorageEntry(root, path, info, func(file *os.File, actual os.FileInfo) error {
		if err := setStorageFileOwner(file, uid, gid); err != nil {
			return fmt.Errorf("set owner for %s: %w", path, err)
		}
		if actual.Mode().Perm()&required != required {
			if err := setStorageFileMode(file, actual.Mode()|required); err != nil {
				return fmt.Errorf("restore owner access for %s: %w", path, err)
			}
		}
		return nil
	})
}

func writeStorageOwnershipMarker(storageRoot, target string, uid, gid int) error {
	base, err := os.OpenRoot(storageRoot)
	if err != nil {
		return err
	}
	defer base.Close()
	expected, err := base.Lstat(storage.UploadStagingDir)
	if err != nil {
		return err
	}
	if !expected.IsDir() || expected.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("upload staging must be a real directory")
	}
	root, err := base.OpenRoot(storage.UploadStagingDir)
	if err != nil {
		return err
	}
	defer root.Close()
	actual, err := root.Stat(".")
	if err != nil {
		return err
	}
	if !os.SameFile(expected, actual) {
		return fmt.Errorf("upload staging changed before marker write")
	}
	baseInfo, err := base.Stat(".")
	if err != nil {
		return err
	}
	if err := validateStorageSameDevice(baseInfo, actual); err != nil {
		return err
	}
	var suffix [16]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		return err
	}
	name := fmt.Sprintf("%s.%x.tmp", storageOwnershipMarker, suffix)
	file, err := root.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o640)
	if err != nil {
		return err
	}
	defer root.Remove(name)
	defer file.Close()
	if err := file.Chown(uid, gid); err != nil {
		return err
	}
	if err := file.Chmod(0o640); err != nil {
		return err
	}
	if _, err := file.WriteString(target + "\n"); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	current, err := base.Lstat(storage.UploadStagingDir)
	if err != nil || !os.SameFile(actual, current) {
		return fmt.Errorf("upload staging changed during marker write")
	}
	return root.Rename(name, storageOwnershipMarker)
}
