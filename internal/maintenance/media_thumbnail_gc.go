package maintenance

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const MediaThumbnailGCMinAge = 24 * time.Hour

type MediaThumbnailGCAction struct {
	StorageKey    string    `json:"storage_key"`
	Size          int64     `json:"size"`
	ModifiedAt    time.Time `json:"modified_at"`
	Applied       bool      `json:"applied"`
	SkippedReason string    `json:"skipped_reason,omitempty"`
}

type MediaThumbnailGCReport struct {
	DryRun         bool                     `json:"dry_run"`
	MinAgeSeconds  int64                    `json:"min_age_seconds"`
	ScannedFiles   int64                    `json:"scanned_files"`
	ScannedBytes   int64                    `json:"scanned_bytes"`
	CandidateFiles int64                    `json:"candidate_files"`
	CandidateBytes int64                    `json:"candidate_bytes"`
	DeletedFiles   int64                    `json:"deleted_files"`
	DeletedBytes   int64                    `json:"deleted_bytes"`
	Actions        []MediaThumbnailGCAction `json:"actions,omitempty"`
}

type thumbnailGCMetadataRow struct {
	NodeID       uint64
	NodeRevision uint64
	SHA256       string
	MediaKind    string
	ThumbnailKey string
}

// GarbageCollectMediaThumbnails removes only old, unreferenced xDrive-generated
// thumbnail-cache files. It never touches originals, CAS blobs, Source state, or
// provider data.
//
// Safety is intentionally conservative:
//   - only .xdrive-media/thumbnails is scanned;
//   - symlinked cache roots/subdirectories are never followed;
//   - current thumbnail_key references are protected;
//   - the deterministic Gallery-thumbnail and Photo-Intelligence analysis-preview
//     keys that every current image MediaMetadata row could generate are also
//     protected, even when thumbnail_key is currently empty;
//   - files younger than 24 hours are protected from Put -> DB-update races;
//   - immediately before deletion, normalized references are refreshed and the
//     exact DB reference, file type, size, mtime and path containment are checked.
func GarbageCollectMediaThumbnails(
	ctx context.Context,
	db *gorm.DB,
	storageRoot string,
	dryRun bool,
) (MediaThumbnailGCReport, error) {
	report := MediaThumbnailGCReport{
		DryRun:        dryRun,
		MinAgeSeconds: int64(MediaThumbnailGCMinAge / time.Second),
	}
	if db == nil {
		return report, fmt.Errorf("media thumbnail GC database is unavailable")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	storageAbs, thumbnailRoot, thumbnailReal, exists, err := thumbnailGCRoot(storageRoot)
	if err != nil {
		return report, err
	}
	if !exists {
		return report, nil
	}

	protected, err := loadProtectedThumbnailKeys(ctx, db)
	if err != nil {
		return report, err
	}

	now := time.Now().UTC()
	cutoff := now.Add(-MediaThumbnailGCMinAge)
	err = filepath.WalkDir(thumbnailRoot, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			if os.IsNotExist(walkErr) {
				return nil
			}
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			if os.IsNotExist(err) {
				return nil
			}
			return err
		}
		if !info.Mode().IsRegular() {
			return nil
		}

		report.ScannedFiles++
		report.ScannedBytes += info.Size()

		rel, err := filepath.Rel(storageAbs, path)
		if err != nil {
			return err
		}
		key, ok := validThumbnailStorageKey(filepath.ToSlash(rel))
		if !ok {
			return nil
		}
		if _, keep := protected[key]; keep {
			return nil
		}
		modified := info.ModTime().UTC()
		if modified.After(cutoff) {
			return nil
		}
		report.Actions = append(report.Actions, MediaThumbnailGCAction{
			StorageKey: key,
			Size:       info.Size(),
			ModifiedAt: modified,
		})
		return nil
	})
	if err != nil {
		return report, fmt.Errorf("scan thumbnail cache: %w", err)
	}

	sort.Slice(report.Actions, func(i, j int) bool {
		return report.Actions[i].StorageKey < report.Actions[j].StorageKey
	})
	for _, action := range report.Actions {
		report.CandidateFiles++
		report.CandidateBytes += action.Size
	}
	if dryRun || len(report.Actions) == 0 {
		return report, nil
	}

	// Refresh all normalized current references/prospective keys immediately
	// before applying the deletion batch. The per-file exact query below adds a
	// second guard for references created during this batch.
	protected, err = loadProtectedThumbnailKeys(ctx, db)
	if err != nil {
		return report, err
	}

	for index := range report.Actions {
		action := &report.Actions[index]
		if _, keep := protected[action.StorageKey]; keep {
			action.SkippedReason = "referenced_during_gc"
			continue
		}
		if err := applyMediaThumbnailGCAction(
			ctx,
			db,
			storageAbs,
			thumbnailRoot,
			thumbnailReal,
			cutoff,
			action,
		); err != nil {
			return report, err
		}
		if action.Applied {
			report.DeletedFiles++
			report.DeletedBytes += action.Size
		}
	}

	return report, nil
}

func loadProtectedThumbnailKeys(
	ctx context.Context,
	db *gorm.DB,
) (map[string]struct{}, error) {
	var metadata []thumbnailGCMetadataRow
	if err := db.WithContext(ctx).
		Model(&meta.MediaMetadata{}).
		Select("node_id", "node_revision", "sha256", "media_kind", "thumbnail_key").
		Find(&metadata).Error; err != nil {
		return nil, fmt.Errorf("query media thumbnail references: %w", err)
	}

	protected := make(map[string]struct{}, len(metadata)*2)
	for _, row := range metadata {
		if key, ok := validThumbnailStorageKey(row.ThumbnailKey); ok {
			protected[key] = struct{}{}
		}
		if row.MediaKind == meta.MediaKindImage {
			for _, edge := range []int{
				mediapkg.DefaultThumbnailEdge,
				mediapkg.AnalysisPreviewEdge,
			} {
				key := mediapkg.ThumbnailStorageKey(
					row.NodeID,
					row.NodeRevision,
					row.SHA256,
					edge,
				)
				if edge == mediapkg.AnalysisPreviewEdge {
					key = mediapkg.AnalysisPreviewStorageKey(
						row.NodeID,
						row.NodeRevision,
						row.SHA256,
					)
				}
				protected[key] = struct{}{}
			}
		}
	}
	return protected, nil
}

func applyMediaThumbnailGCAction(
	ctx context.Context,
	db *gorm.DB,
	storageAbs, thumbnailRoot, thumbnailReal string,
	cutoff time.Time,
	action *MediaThumbnailGCAction,
) error {
	if action == nil {
		return nil
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	var references int64
	if err := db.WithContext(ctx).
		Model(&meta.MediaMetadata{}).
		Where("thumbnail_key = ?", action.StorageKey).
		Count(&references).Error; err != nil {
		return fmt.Errorf(
			"recheck thumbnail reference %q: %w",
			action.StorageKey,
			err,
		)
	}
	if references != 0 {
		action.SkippedReason = "referenced_during_gc"
		return nil
	}

	full, err := thumbnailGCFilePath(
		storageAbs,
		thumbnailRoot,
		thumbnailReal,
		action.StorageKey,
	)
	if errors.Is(err, os.ErrNotExist) {
		action.SkippedReason = "already_missing"
		return nil
	}
	if err != nil {
		return err
	}
	info, err := os.Lstat(full)
	switch {
	case errors.Is(err, os.ErrNotExist):
		action.SkippedReason = "already_missing"
		return nil
	case err != nil:
		return fmt.Errorf("stat thumbnail GC candidate %q: %w", action.StorageKey, err)
	}
	if !info.Mode().IsRegular() {
		action.SkippedReason = "not_regular"
		return nil
	}
	if info.Size() != action.Size ||
		!info.ModTime().UTC().Equal(action.ModifiedAt) ||
		info.ModTime().UTC().After(cutoff) {
		action.SkippedReason = "changed_during_gc"
		return nil
	}
	if err := os.Remove(full); err != nil {
		if os.IsNotExist(err) {
			action.SkippedReason = "already_missing"
			return nil
		}
		return fmt.Errorf("delete orphan thumbnail %q: %w", action.StorageKey, err)
	}
	action.Applied = true
	return nil
}

func validThumbnailStorageKey(raw string) (string, bool) {
	key, err := cleanStorageKey(strings.TrimSpace(raw))
	if err != nil || !strings.HasPrefix(key, mediapkg.ThumbnailStoragePrefix) {
		return "", false
	}
	return key, true
}

func thumbnailGCRoot(
	storageRoot string,
) (storageAbs, thumbnailRoot, thumbnailReal string, exists bool, err error) {
	storageAbs, err = filepath.Abs(strings.TrimSpace(storageRoot))
	if err != nil {
		return "", "", "", false, err
	}
	rootInfo, err := os.Stat(storageAbs)
	if err != nil {
		return "", "", "", false, fmt.Errorf("stat media storage root: %w", err)
	}
	if !rootInfo.IsDir() {
		return "", "", "", false, fmt.Errorf("media storage root is not a directory")
	}

	mediaRoot := filepath.Join(storageAbs, ".xdrive-media")
	thumbnailRoot = filepath.Join(
		storageAbs,
		filepath.FromSlash(strings.TrimSuffix(mediapkg.ThumbnailStoragePrefix, "/")),
	)
	for _, path := range []string{mediaRoot, thumbnailRoot} {
		info, statErr := os.Lstat(path)
		switch {
		case os.IsNotExist(statErr):
			return storageAbs, thumbnailRoot, "", false, nil
		case statErr != nil:
			return "", "", "", false, statErr
		case info.Mode()&os.ModeSymlink != 0:
			return "", "", "", false, fmt.Errorf("thumbnail cache root must not be a symlink")
		case !info.IsDir():
			return "", "", "", false, fmt.Errorf("thumbnail cache root is not a directory")
		}
	}
	thumbnailReal, err = filepath.EvalSymlinks(thumbnailRoot)
	if err != nil {
		return "", "", "", false, err
	}
	return storageAbs, thumbnailRoot, thumbnailReal, true, nil
}

func thumbnailGCFilePath(
	storageAbs, thumbnailRoot, thumbnailReal, key string,
) (string, error) {
	key, ok := validThumbnailStorageKey(key)
	if !ok {
		return "", fmt.Errorf("invalid thumbnail GC storage key")
	}
	full := filepath.Join(storageAbs, filepath.FromSlash(key))
	rel, err := filepath.Rel(thumbnailRoot, full)
	if err != nil ||
		rel == ".." ||
		strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("thumbnail GC path escapes cache root")
	}

	parentReal, err := filepath.EvalSymlinks(filepath.Dir(full))
	if err != nil {
		return "", err
	}
	realRel, err := filepath.Rel(thumbnailReal, parentReal)
	if err != nil ||
		realRel == ".." ||
		strings.HasPrefix(realRel, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("thumbnail GC parent escapes cache root")
	}
	return full, nil
}
