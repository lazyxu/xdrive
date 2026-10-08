package api

import (
	"context"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

type currentFileDownloadMetadata struct {
	Name       string    `gorm:"column:name"`
	Size       int64     `gorm:"column:size"`
	Revision   uint64    `gorm:"column:revision"`
	StorageKey string    `gorm:"column:storage_key"`
	SHA256     string    `gorm:"column:sha256"`
	UpdatedAt  time.Time `gorm:"column:updated_at"`
}

type fileVersionDownloadMetadata struct {
	Name         string    `gorm:"column:name"`
	Size         int64     `gorm:"column:size"`
	VersionFound bool      `gorm:"column:version_found"`
	StorageKey   string    `gorm:"column:storage_key"`
	SHA256       string    `gorm:"column:sha256"`
	CreatedAt    time.Time `gorm:"column:created_at"`
}

func loadCurrentFileDownloadMetadata(
	ctx context.Context,
	db *gorm.DB,
	ownerID uint64,
	nodeID uint64,
) (currentFileDownloadMetadata, error) {
	var out currentFileDownloadMetadata
	result := db.WithContext(ctx).Raw(`
SELECT n.name,
       f.size,
       n.revision,
       f.storage_key,
       f.sha256,
       f.updated_at
FROM xd_nodes AS n
JOIN xd_files AS f ON f.node_id = n.id
WHERE n.id = ?
  AND n.owner_id = ?
  AND n.type = ?
  AND n.deleted_at IS NULL
LIMIT 1
`, nodeID, ownerID, meta.NodeTypeFile).Scan(&out)
	if result.Error != nil {
		return currentFileDownloadMetadata{}, result.Error
	}
	if result.RowsAffected == 0 {
		return currentFileDownloadMetadata{}, gorm.ErrRecordNotFound
	}
	return out, nil
}

func loadFileVersionDownloadMetadata(
	ctx context.Context,
	db *gorm.DB,
	ownerID uint64,
	nodeID uint64,
	versionID uint64,
) (fileVersionDownloadMetadata, error) {
	var out fileVersionDownloadMetadata
	result := db.WithContext(ctx).Raw(`
SELECT n.name,
       COALESCE(v.size, 0) AS size,
       (v.id IS NOT NULL) AS version_found,
       COALESCE(v.storage_key, '') AS storage_key,
       COALESCE(v.sha256, '') AS sha256,
       COALESCE(v.created_at, '0001-01-01 00:00:00+00'::timestamptz) AS created_at
FROM xd_nodes AS n
LEFT JOIN xd_file_versions AS v
  ON v.node_id = n.id
 AND v.id = ?
WHERE n.id = ?
  AND n.owner_id = ?
  AND n.type = ?
  AND n.deleted_at IS NULL
LIMIT 1
`, versionID, nodeID, ownerID, meta.NodeTypeFile).Scan(&out)
	if result.Error != nil {
		return fileVersionDownloadMetadata{}, result.Error
	}
	if result.RowsAffected == 0 {
		return fileVersionDownloadMetadata{}, gorm.ErrRecordNotFound
	}
	return out, nil
}
