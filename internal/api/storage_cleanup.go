package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

type storageCacheCleanupDTO struct {
	Kind         string              `json:"kind"`
	DeletedFiles int64               `json:"deleted_files"`
	DeletedBytes int64               `json:"deleted_bytes"`
	FailedFiles  int64               `json:"failed_files"`
	Inventory    storageInventoryDTO `json:"inventory"`
}

func storageCleanupKindValid(kind string) bool {
	switch kind {
	case storageCleanupThumbnail, storageCleanupAnalysis, storageCleanupStaging, storageCleanupTemp, storageCleanupAll:
		return true
	default:
		return false
	}
}

func storageCleanupMatches(kind string, file storage.ManagedFile, cutoff time.Time) bool {
	category := storageInventoryCategory(file.Key)
	switch kind {
	case storageCleanupThumbnail:
		return category == "media_thumbnail"
	case storageCleanupAnalysis:
		return category == "analysis_preview"
	case storageCleanupTemp:
		return (category == "write_temp" || category == "readiness_temp") &&
			file.ModifiedAt.Before(cutoff)
	case storageCleanupAll:
		return category == "media_thumbnail" ||
			category == "analysis_preview" ||
			((category == "write_temp" || category == "readiness_temp") &&
				file.ModifiedAt.Before(cutoff))
	default:
		return false
	}
}

func (s *Server) cleanupStorageCache(ctx context.Context, kind string) (storageCacheCleanupDTO, error) {
	var out storageCacheCleanupDTO
	kind = strings.TrimSpace(kind)
	if !storageCleanupKindValid(kind) {
		return out, errors.New("invalid storage cleanup kind")
	}
	out.Kind = kind

	if kind == storageCleanupStaging || kind == storageCleanupAll {
		result, err := s.cleanupUploadStaging(ctx, meta.StagingCleanupTriggerManual)
		if err != nil {
			return out, err
		}
		out.DeletedFiles += result.DeletedFiles
		out.DeletedBytes += result.DeletedBytes
		out.FailedFiles += result.FailedFiles
	}

	var deletedThumbnailFiles int64
	if kind != storageCleanupStaging {
		walker, ok := s.Store.(storage.ManagedFileWalker)
		if !ok {
			return out, errors.New("storage backend does not support managed cache cleanup")
		}
		cutoff := time.Now().Add(-storageTempReclaimableAge)
		var targets []storage.ManagedFile
		if err := walker.WalkManagedFiles(ctx, func(file storage.ManagedFile) error {
			if storageCleanupMatches(kind, file, cutoff) {
				targets = append(targets, file)
			}
			return nil
		}); err != nil {
			return out, err
		}
		for _, file := range targets {
			if err := ctx.Err(); err != nil {
				return out, err
			}
			category := storageInventoryCategory(file.Key)
			if err := s.Store.Delete(ctx, file.Key); err != nil {
				out.FailedFiles++
				continue
			}
			out.DeletedFiles++
			out.DeletedBytes += file.Size
			if category == "media_thumbnail" {
				deletedThumbnailFiles++
			}
		}
	}

	if deletedThumbnailFiles > 0 {
		if err := s.DB.WithContext(ctx).Model(&meta.MediaMetadata{}).
			Where("thumbnail_key <> ''").
			Updates(map[string]any{
				"thumbnail_key":       "",
				"thumbnail_mime_type": "",
				"thumbnail_width":     0,
				"thumbnail_height":    0,
			}).Error; err != nil {
			return out, err
		}
	}

	s.invalidateUploadStagingSnapshot()
	s.invalidateStorageInventory()
	inventory, err := s.loadStorageInventory(ctx)
	if err != nil {
		return out, err
	}
	out.Inventory = inventory
	return out, nil
}

func (s *Server) adminCleanupStorageCache(c *gin.Context) {
	var input struct {
		Kind string `json:"kind"`
	}
	if err := c.ShouldBindJSON(&input); err != nil ||
		!storageCleanupKindValid(strings.TrimSpace(input.Kind)) {
		fail(c, http.StatusBadRequest, "invalid storage cleanup kind")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Minute)
	defer cancel()

	result, err := s.cleanupStorageCache(ctx, strings.TrimSpace(input.Kind))
	if err != nil {
		fail(c, http.StatusInternalServerError, "cleanup storage cache failed")
		return
	}
	s.recordAuditBestEffort(c, auditpkg.Event{
		Action:      auditpkg.ActionAdminStorageCleanup,
		TargetType:  "storage",
		TargetLabel: result.Kind,
		Result:      auditpkg.ResultSuccess,
		Metadata: map[string]any{
			"deleted_files": result.DeletedFiles,
			"deleted_bytes": result.DeletedBytes,
			"failed_files":  result.FailedFiles,
		},
	})
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, result)
}
