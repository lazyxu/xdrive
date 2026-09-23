package maintenance

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

type MissingBlob struct {
	NodeID     uint64 `json:"node_id"`
	VersionID  uint64 `json:"version_id,omitempty"`
	StorageKey string `json:"storage_key"`
	Expected   int64  `json:"expected_size"`
	Reason     string `json:"reason"`
}

type SizeMismatch struct {
	NodeID     uint64 `json:"node_id"`
	VersionID  uint64 `json:"version_id,omitempty"`
	StorageKey string `json:"storage_key"`
	Expected   int64  `json:"expected_size"`
	Actual     int64  `json:"actual_size"`
}

type DuplicateReference struct {
	StorageKey string `json:"storage_key"`
	References int    `json:"references"`
}

type OrphanBlob struct {
	StorageKey string `json:"storage_key"`
	Size       int64  `json:"size"`
}

type VerifyReport struct {
	ReferencedFiles    int                  `json:"referenced_files"`
	ReferencedVersions int                  `json:"referenced_versions"`
	BlobFiles          int                  `json:"blob_files"`
	BlobBytes          int64                `json:"blob_bytes"`
	Missing            []MissingBlob        `json:"missing"`
	SizeMismatches     []SizeMismatch       `json:"size_mismatches"`
	DuplicateRefs      []DuplicateReference `json:"duplicate_references"`
	Orphans            []OrphanBlob         `json:"orphans"`
	IgnoredTemps       int                  `json:"ignored_temporary_files"`
}

func (r VerifyReport) OK() bool {
	return len(r.Missing) == 0 && len(r.SizeMismatches) == 0 && len(r.DuplicateRefs) == 0 && len(r.Orphans) == 0
}

type blobReference struct {
	NodeID    uint64
	VersionID uint64
	Size      int64
}

func Verify(db *gorm.DB, storageRoot string) (VerifyReport, error) {
	var report VerifyReport
	root, err := filepath.Abs(storageRoot)
	if err != nil {
		return report, err
	}
	if err := os.MkdirAll(root, 0o750); err != nil {
		return report, err
	}

	var files []meta.File
	if err := db.Order("node_id ASC").Find(&files).Error; err != nil {
		return report, fmt.Errorf("query file metadata: %w", err)
	}
	var versions []meta.FileVersion
	if err := db.Order("node_id ASC, revision ASC").Find(&versions).Error; err != nil {
		return report, fmt.Errorf("query file version metadata: %w", err)
	}
	report.ReferencedFiles = len(files)
	report.ReferencedVersions = len(versions)

	references := make(map[string][]blobReference, len(files)+len(versions))
	for _, file := range files {
		addReference(&report, references, root, file.StorageKey, blobReference{
			NodeID: file.NodeID, Size: file.Size,
		})
	}
	for _, version := range versions {
		addReference(&report, references, root, version.StorageKey, blobReference{
			NodeID: version.NodeID, VersionID: version.ID, Size: version.Size,
		})
	}
	for key, refs := range references {
		if len(refs) > 1 {
			report.DuplicateRefs = append(report.DuplicateRefs, DuplicateReference{StorageKey: key, References: len(refs)})
		}
	}

	err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		if strings.HasPrefix(entry.Name(), ".xdrive-upload-") {
			report.IgnoredTemps++
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		key := filepath.ToSlash(rel)
		report.BlobFiles++
		report.BlobBytes += info.Size()
		if _, ok := references[key]; !ok {
			report.Orphans = append(report.Orphans, OrphanBlob{StorageKey: key, Size: info.Size()})
		}
		return nil
	})
	if err != nil {
		return report, fmt.Errorf("walk storage: %w", err)
	}

	sort.Slice(report.Missing, func(i, j int) bool { return report.Missing[i].StorageKey < report.Missing[j].StorageKey })
	sort.Slice(report.SizeMismatches, func(i, j int) bool { return report.SizeMismatches[i].StorageKey < report.SizeMismatches[j].StorageKey })
	sort.Slice(report.DuplicateRefs, func(i, j int) bool { return report.DuplicateRefs[i].StorageKey < report.DuplicateRefs[j].StorageKey })
	sort.Slice(report.Orphans, func(i, j int) bool { return report.Orphans[i].StorageKey < report.Orphans[j].StorageKey })
	return report, nil
}

func addReference(report *VerifyReport, references map[string][]blobReference, root, rawKey string, ref blobReference) {
	key, err := cleanStorageKey(rawKey)
	if err != nil {
		report.Missing = append(report.Missing, MissingBlob{
			NodeID: ref.NodeID, VersionID: ref.VersionID, StorageKey: rawKey, Expected: ref.Size, Reason: "invalid_storage_key",
		})
		return
	}
	references[key] = append(references[key], ref)
	full := filepath.Join(root, filepath.FromSlash(key))
	info, statErr := os.Stat(full)
	if statErr != nil {
		reason := "not_found"
		if !os.IsNotExist(statErr) {
			reason = statErr.Error()
		}
		report.Missing = append(report.Missing, MissingBlob{
			NodeID: ref.NodeID, VersionID: ref.VersionID, StorageKey: key, Expected: ref.Size, Reason: reason,
		})
		return
	}
	if !info.Mode().IsRegular() {
		report.Missing = append(report.Missing, MissingBlob{
			NodeID: ref.NodeID, VersionID: ref.VersionID, StorageKey: key, Expected: ref.Size, Reason: "not_regular_file",
		})
		return
	}
	if info.Size() != ref.Size {
		report.SizeMismatches = append(report.SizeMismatches, SizeMismatch{
			NodeID: ref.NodeID, VersionID: ref.VersionID, StorageKey: key, Expected: ref.Size, Actual: info.Size(),
		})
	}
}

func cleanStorageKey(key string) (string, error) {
	key = filepath.ToSlash(strings.TrimSpace(key))
	if key == "" || strings.HasPrefix(key, "/") {
		return "", fmt.Errorf("invalid storage key")
	}
	clean := filepath.ToSlash(filepath.Clean(filepath.FromSlash(key)))
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") {
		return "", fmt.Errorf("invalid storage key")
	}
	return clean, nil
}
