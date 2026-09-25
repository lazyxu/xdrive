package maintenance

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
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

type ContentReferenceMismatch struct {
	SHA256       string `json:"sha256"`
	StorageKey   string `json:"storage_key"`
	ExpectedRefs int64  `json:"expected_refs"`
	RecordedRefs int64  `json:"recorded_refs"`
	State        string `json:"state"`
	Reason       string `json:"reason"`
}

type OrphanBlob struct {
	StorageKey string `json:"storage_key"`
	Size       int64  `json:"size"`
}

type HashMismatch struct {
	NodeID     uint64 `json:"node_id"`
	VersionID  uint64 `json:"version_id,omitempty"`
	StorageKey string `json:"storage_key"`
	Expected   string `json:"expected_sha256"`
	Actual     string `json:"actual_sha256"`
}

type VerifyReport struct {
	ReferencedFiles    int                        `json:"referenced_files"`
	ReferencedVersions int                        `json:"referenced_versions"`
	BlobFiles          int                        `json:"blob_files"`
	BlobBytes          int64                      `json:"blob_bytes"`
	Missing            []MissingBlob              `json:"missing"`
	SizeMismatches     []SizeMismatch             `json:"size_mismatches"`
	DuplicateRefs      []DuplicateReference       `json:"duplicate_references"`
	SharedRefs         []DuplicateReference       `json:"shared_references"`
	ContentRefMismatch []ContentReferenceMismatch `json:"content_reference_mismatches"`
	Orphans            []OrphanBlob               `json:"orphans"`
	HashMismatches     []HashMismatch             `json:"hash_mismatches"`
	IgnoredTemps       int                        `json:"ignored_temporary_files"`
}

func (r VerifyReport) OK() bool {
	return len(r.Missing) == 0 &&
		len(r.SizeMismatches) == 0 &&
		len(r.DuplicateRefs) == 0 &&
		len(r.ContentRefMismatch) == 0 &&
		len(r.Orphans) == 0 &&
		len(r.HashMismatches) == 0
}

type blobInspection struct {
	Size         int64
	Hash         string
	HashComputed bool
	Err          error
	Regular      bool
}

type blobReference struct {
	NodeID    uint64
	VersionID uint64
	Size      int64
	SHA256    string
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
	inspections := make(map[string]*blobInspection, len(files)+len(versions))
	for _, file := range files {
		addReference(&report, references, inspections, root, file.StorageKey, blobReference{
			NodeID: file.NodeID, Size: file.Size, SHA256: file.SHA256,
		})
	}
	for _, version := range versions {
		addReference(&report, references, inspections, root, version.StorageKey, blobReference{
			NodeID: version.NodeID, VersionID: version.ID, Size: version.Size, SHA256: version.SHA256,
		})
	}
	for key, refs := range references {
		if len(refs) <= 1 {
			continue
		}
		ref := DuplicateReference{StorageKey: key, References: len(refs)}
		if storage.IsContentAddressedKey(key) {
			report.SharedRefs = append(report.SharedRefs, ref)
		} else {
			report.DuplicateRefs = append(report.DuplicateRefs, ref)
		}
	}

	var blobs []meta.ContentBlob
	if err := db.Order("sha256 ASC").Find(&blobs).Error; err != nil {
		return report, fmt.Errorf("query content blob metadata: %w", err)
	}
	blobByKey := make(map[string]meta.ContentBlob, len(blobs))
	for _, blob := range blobs {
		blobByKey[blob.StorageKey] = blob
		refs := int64(len(references[blob.StorageKey]))
		expectedState := meta.ContentBlobStateReady
		if refs == 0 {
			expectedState = meta.ContentBlobStateDeleting
		}
		if refs != blob.RefCount || blob.State != expectedState {
			report.ContentRefMismatch = append(report.ContentRefMismatch, ContentReferenceMismatch{
				SHA256: blob.SHA256, StorageKey: blob.StorageKey,
				ExpectedRefs: refs, RecordedRefs: blob.RefCount, State: blob.State,
				Reason: "refcount_or_state_mismatch",
			})
		}
		if hash, ok := storage.ContentHashFromKey(blob.StorageKey); !ok || hash != blob.SHA256 {
			report.ContentRefMismatch = append(report.ContentRefMismatch, ContentReferenceMismatch{
				SHA256: blob.SHA256, StorageKey: blob.StorageKey,
				ExpectedRefs: refs, RecordedRefs: blob.RefCount, State: blob.State,
				Reason: "content_key_hash_mismatch",
			})
		}
	}
	for key, refs := range references {
		if !storage.IsContentAddressedKey(key) || len(refs) == 0 {
			continue
		}
		if _, ok := blobByKey[key]; ok {
			continue
		}
		hash, _ := storage.ContentHashFromKey(key)
		report.ContentRefMismatch = append(report.ContentRefMismatch, ContentReferenceMismatch{
			SHA256: hash, StorageKey: key,
			ExpectedRefs: int64(len(refs)), RecordedRefs: 0, State: "",
			Reason: "content_blob_metadata_missing",
		})
	}

	err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if path != root {
				rel, relErr := filepath.Rel(root, path)
				if relErr != nil {
					return relErr
				}
				if filepath.ToSlash(rel) == ".xdrive-uploads" {
					return filepath.SkipDir
				}
			}
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
			// A zero-reference CAS row in deleting state is a managed GC
			// candidate, not an orphan. The upload janitor will finalize it
			// once no temporary reused upload part still depends on it.
			if blob, managed := blobByKey[key]; managed &&
				blob.RefCount == 0 && blob.State == meta.ContentBlobStateDeleting {
				return nil
			}
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
	sort.Slice(report.SharedRefs, func(i, j int) bool { return report.SharedRefs[i].StorageKey < report.SharedRefs[j].StorageKey })
	sort.Slice(report.ContentRefMismatch, func(i, j int) bool {
		return report.ContentRefMismatch[i].StorageKey < report.ContentRefMismatch[j].StorageKey
	})
	sort.Slice(report.Orphans, func(i, j int) bool { return report.Orphans[i].StorageKey < report.Orphans[j].StorageKey })
	sort.Slice(report.HashMismatches, func(i, j int) bool { return report.HashMismatches[i].StorageKey < report.HashMismatches[j].StorageKey })
	return report, nil
}

func addReference(
	report *VerifyReport,
	references map[string][]blobReference,
	inspections map[string]*blobInspection,
	root, rawKey string,
	ref blobReference,
) {
	key, err := cleanStorageKey(rawKey)
	if err != nil {
		report.Missing = append(report.Missing, MissingBlob{
			NodeID: ref.NodeID, VersionID: ref.VersionID, StorageKey: rawKey, Expected: ref.Size, Reason: "invalid_storage_key",
		})
		return
	}
	references[key] = append(references[key], ref)
	inspection := inspections[key]
	if inspection == nil {
		inspection = &blobInspection{}
		inspections[key] = inspection
		full := filepath.Join(root, filepath.FromSlash(key))
		info, statErr := os.Stat(full)
		if statErr != nil {
			inspection.Err = statErr
		} else {
			inspection.Size = info.Size()
			inspection.Regular = info.Mode().IsRegular()
		}
	}
	if inspection.Err != nil {
		reason := "not_found"
		if !os.IsNotExist(inspection.Err) {
			reason = inspection.Err.Error()
		}
		report.Missing = append(report.Missing, MissingBlob{
			NodeID: ref.NodeID, VersionID: ref.VersionID, StorageKey: key, Expected: ref.Size, Reason: reason,
		})
		return
	}
	if !inspection.Regular {
		report.Missing = append(report.Missing, MissingBlob{
			NodeID: ref.NodeID, VersionID: ref.VersionID, StorageKey: key, Expected: ref.Size, Reason: "not_regular_file",
		})
		return
	}
	if inspection.Size != ref.Size {
		report.SizeMismatches = append(report.SizeMismatches, SizeMismatch{
			NodeID: ref.NodeID, VersionID: ref.VersionID, StorageKey: key, Expected: ref.Size, Actual: inspection.Size,
		})
	}
	if ref.SHA256 == "" {
		return
	}
	if !inspection.HashComputed {
		full := filepath.Join(root, filepath.FromSlash(key))
		file, openErr := os.Open(full)
		if openErr != nil {
			inspection.Err = openErr
		} else {
			h := sha256.New()
			_, copyErr := io.Copy(h, file)
			closeErr := file.Close()
			if copyErr != nil {
				inspection.Err = copyErr
			} else if closeErr != nil {
				inspection.Err = closeErr
			} else {
				inspection.Hash = hex.EncodeToString(h.Sum(nil))
				inspection.HashComputed = true
			}
		}
	}
	if inspection.Err != nil {
		report.Missing = append(report.Missing, MissingBlob{
			NodeID: ref.NodeID, VersionID: ref.VersionID, StorageKey: key,
			Expected: ref.Size, Reason: inspection.Err.Error(),
		})
		return
	}
	if !strings.EqualFold(inspection.Hash, ref.SHA256) {
		report.HashMismatches = append(report.HashMismatches, HashMismatch{
			NodeID: ref.NodeID, VersionID: ref.VersionID, StorageKey: key,
			Expected: ref.SHA256, Actual: inspection.Hash,
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
