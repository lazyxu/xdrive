package localpush

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	sourcepkg "github.com/lazyxu/xdrive/internal/source"
)

const (
	DefaultInventoryBatchSize = 500
	maxInventoryBatchSize     = 500
	inventoryReadDirBatchSize = 256
)

// InventoryItem is metadata only. Scanning must not mint a SourceItem identity,
// hash a file body, start an upload or alter SyncRun/Mirror deletion evidence.
type InventoryItem struct {
	Path       string     `json:"path"`
	Kind       string     `json:"kind"`
	Size       int64      `json:"size"`
	ModifiedAt *time.Time `json:"modified_at,omitempty"`
	Ignored    bool       `json:"ignored"`
}

type InventorySummary struct {
	ScannedFiles       int64 `json:"scanned_files"`
	ScannedDirectories int64 `json:"scanned_directories"`
	ScannedBytes       int64 `json:"scanned_bytes"`
	IgnoredItems       int64 `json:"ignored_items"`
	IgnoredBytes       int64 `json:"ignored_bytes"`
	SkippedUnsafeItems int64 `json:"skipped_unsafe_items"`
	Complete           bool  `json:"complete"`
	// MissingInferenceSafe is intentionally false until a trusted identity
	// index and complete-inventory reconciliation protocol ship in L02/L03.
	MissingInferenceSafe bool `json:"missing_inference_safe"`
}

type InventoryScanner struct {
	IgnoreRules string
	BatchSize   int
}

// ScanInventory is a synchronous, backpressured, read-only inventory of a
// locally approved Root. The callback owns each batch and may abort the scan.
// In particular it MUST NOT treat partial batches as proof of remote deletion.
func (s InventoryScanner) ScanInventory(ctx context.Context, grant RootGrant, yield func([]InventoryItem) error) (InventorySummary, error) {
	var summary InventorySummary
	if ctx == nil {
		return summary, errors.New("scan context required")
	}
	if yield == nil {
		return summary, errors.New("inventory batch callback required")
	}
	if err := ctx.Err(); err != nil {
		return summary, err
	}
	if err := VerifyRootGrant(grant); err != nil {
		return summary, err
	}
	matcher, err := sourcepkg.CompileIgnoreRules(s.IgnoreRules)
	if err != nil {
		return summary, err
	}
	batchSize := s.BatchSize
	if batchSize <= 0 {
		batchSize = DefaultInventoryBatchSize
	}
	if batchSize > maxInventoryBatchSize {
		return summary, fmt.Errorf("inventory batch exceeds %d items", maxInventoryBatchSize)
	}
	items := make([]InventoryItem, 0, batchSize)
	flush := func() error {
		if len(items) == 0 {
			return nil
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		// Do not re-use the storage of an emitted batch. The consumer may
		// retain it, and the scanner must never mutate retained results.
		owned := append([]InventoryItem(nil), items...)
		if err := yield(owned); err != nil {
			return err
		}
		items = items[:0]
		return nil
	}
	directories := []string{grant.Path}
	for len(directories) != 0 {
		if err := ctx.Err(); err != nil {
			return summary, err
		}
		dir := directories[len(directories)-1]
		directories = directories[:len(directories)-1]
		f, err := os.Open(dir)
		if err != nil {
			return summary, fmt.Errorf("open local directory: %w", err)
		}
		for {
			if err := ctx.Err(); err != nil {
				_ = f.Close()
				return summary, err
			}
			entries, readErr := f.ReadDir(inventoryReadDirBatchSize)
			for _, entry := range entries {
				if err := ctx.Err(); err != nil {
					_ = f.Close()
					return summary, err
				}
				fullPath := filepath.Join(dir, entry.Name())
				info, err := os.Lstat(fullPath)
				if err != nil {
					_ = f.Close()
					return summary, fmt.Errorf("stat local inventory entry: %w", err)
				}
				if info.Mode()&os.ModeSymlink != 0 {
					// The target may cross the locally authorized Root, so
					// never traverse it or infer its disappearance.
					summary.SkippedUnsafeItems++
					continue
				}
				isDir := info.IsDir()
				if !isDir && !info.Mode().IsRegular() {
					summary.SkippedUnsafeItems++
					continue
				}
				relative, err := filepath.Rel(grant.Path, fullPath)
				if err != nil {
					_ = f.Close()
					return summary, fmt.Errorf("relative local inventory path: %w", err)
				}
				canonical := filepath.ToSlash(relative)
				normalized, err := sourcepkg.NormalizeRelativePath(canonical)
				if err != nil || normalized != canonical {
					_ = f.Close()
					return summary, fmt.Errorf("local inventory path cannot be represented safely: %q", canonical)
				}
				if isDir {
					directories = append(directories, fullPath)
					summary.ScannedDirectories++
				} else {
					summary.ScannedFiles++
					summary.ScannedBytes += info.Size()
				}
				modified := info.ModTime().UTC()
				kind := "file"
				size := info.Size()
				if isDir {
					kind = "directory"
					size = 0
				}
				ignored := matcher.Ignored(canonical, isDir)
				if ignored {
					summary.IgnoredItems++
					summary.IgnoredBytes += size
				}
				items = append(items, InventoryItem{
					Path: canonical, Kind: kind, Size: size, ModifiedAt: &modified,
					Ignored: ignored,
				})
				if len(items) == batchSize {
					if err := flush(); err != nil {
						_ = f.Close()
						return summary, err
					}
				}
			}
			if readErr != nil && !errors.Is(readErr, io.EOF) {
				_ = f.Close()
				return summary, fmt.Errorf("read local directory: %w", readErr)
			}
			if errors.Is(readErr, io.EOF) {
				break
			}
			if len(entries) == 0 {
				_ = f.Close()
				return summary, errors.New("directory reader made no progress")
			}
		}
		if err := f.Close(); err != nil {
			return summary, fmt.Errorf("close local directory: %w", err)
		}
	}
	if err := flush(); err != nil {
		return summary, err
	}
	if err := ctx.Err(); err != nil {
		return summary, err
	}
	if err := VerifyRootGrant(grant); err != nil {
		return summary, err
	}
	if err := ctx.Err(); err != nil {
		return summary, err
	}
	summary.Complete = true
	return summary, nil
}
