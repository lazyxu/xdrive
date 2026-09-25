package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/lazyxu/xdrive/internal/config"
	"github.com/lazyxu/xdrive/internal/maintenance"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

const defaultStorageOwnerID = 65532

func runStorageCommand(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: xdrive-server storage <prepare|health|verify|repair> [options]")
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
	default:
		return fmt.Errorf("usage: xdrive-server storage <prepare|health|verify|repair> [options]")
	}
}

func runStorageVerify(args []string) error {
	fs := flag.NewFlagSet("storage verify", flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "write machine-readable JSON")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return fmt.Errorf("usage: xdrive-server storage verify [--json]")
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	report, err := maintenance.Verify(db, cfg.StorageRoot)
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
		fmt.Printf("referenced files:    %d\n", report.ReferencedFiles)
		fmt.Printf("referenced versions: %d\n", report.ReferencedVersions)
		fmt.Printf("blob files:          %d\n", report.BlobFiles)
		fmt.Printf("blob bytes:       %d\n", report.BlobBytes)
		fmt.Printf("missing blobs:    %d\n", len(report.Missing))
		fmt.Printf("size mismatches:  %d\n", len(report.SizeMismatches))
		fmt.Printf("duplicate refs:   %d\n", len(report.DuplicateRefs))
		fmt.Printf("shared refs:      %d\n", len(report.SharedRefs))
		fmt.Printf("content ref drift:%d\n", len(report.ContentRefMismatch))
		fmt.Printf("orphan blobs:     %d\n", len(report.Orphans))
		fmt.Printf("hash mismatches:  %d\n", len(report.HashMismatches))
		fmt.Printf("ignored temp:     %d\n", report.IgnoredTemps)
		for _, issue := range report.Missing {
			fmt.Printf("MISSING node=%d key=%q expected=%d reason=%s\n", issue.NodeID, issue.StorageKey, issue.Expected, issue.Reason)
		}
		for _, issue := range report.SizeMismatches {
			fmt.Printf("SIZE_MISMATCH node=%d key=%q expected=%d actual=%d\n", issue.NodeID, issue.StorageKey, issue.Expected, issue.Actual)
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
			fmt.Printf("ORPHAN key=%q size=%d\n", issue.StorageKey, issue.Size)
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
	info, err := os.Stat(abs)
	if err != nil {
		return "", fmt.Errorf("stat storage root: %w", err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("storage root is not a directory")
	}

	staging := filepath.Join(abs, storage.UploadStagingDir)
	if err := os.MkdirAll(staging, 0o750); err != nil {
		return "", fmt.Errorf("create upload staging directory: %w", err)
	}
	marker := filepath.Join(staging, ".ownership-v1")
	target := strconv.Itoa(uid) + ":" + strconv.Itoa(gid)

	fullRepair := force
	if !fullRepair {
		data, readErr := os.ReadFile(marker)
		fullRepair = readErr != nil || strings.TrimSpace(string(data)) != target
	}

	if fullRepair {
		if err := repairStorageTree(abs, uid, gid); err != nil {
			return "", err
		}
	} else {
		if err := repairStorageEntry(abs, uid, gid); err != nil {
			return "", err
		}
		if err := repairStorageTree(staging, uid, gid); err != nil {
			return "", err
		}
	}

	if err := os.WriteFile(marker, []byte(target+"\n"), 0o640); err != nil {
		return "", fmt.Errorf("write storage ownership marker: %w", err)
	}
	if err := os.Lchown(marker, uid, gid); err != nil {
		return "", fmt.Errorf("set storage ownership marker owner: %w", err)
	}
	if err := os.Chmod(marker, 0o640); err != nil {
		return "", fmt.Errorf("set storage ownership marker mode: %w", err)
	}
	return abs, nil
}

func repairStorageTree(root string, uid, gid int) error {
	return filepath.Walk(root, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		return repairStorageEntryWithInfo(path, info, uid, gid)
	})
}

func repairStorageEntry(path string, uid, gid int) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	return repairStorageEntryWithInfo(path, info, uid, gid)
}

func repairStorageEntryWithInfo(path string, info os.FileInfo, uid, gid int) error {
	if err := os.Lchown(path, uid, gid); err != nil {
		return fmt.Errorf("set owner for %s: %w", path, err)
	}
	if info.IsDir() && info.Mode().Perm()&0o700 != 0o700 {
		if err := os.Chmod(path, info.Mode()|0o700); err != nil {
			return fmt.Errorf("make directory writable %s: %w", path, err)
		}
	}
	return nil
}
