package main

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const (
	legacyYikeTargetRootName = "来源"
	yikeTargetRootName       = "同步文件夹"
	yikeTargetConnectorName  = "一刻相册"
)

var errLegacyYikeTargetMigrationBlocked = errors.New("legacy Yike target migration blocked")

func migrateLegacyYikeTargets(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("database is required")
	}
	var sources []meta.Source
	if err := db.
		Where("kind = ? AND target_node_id IS NOT NULL", "yike_photos").
		Find(&sources).Error; err != nil {
		return err
	}

	for _, source := range sources {
		err := db.Transaction(func(tx *gorm.DB) error {
			return migrateLegacyYikeTarget(tx, source)
		})
		if err == nil {
			continue
		}
		if !errors.Is(err, errLegacyYikeTargetMigrationBlocked) {
			return err
		}

		now := time.Now().UTC()
		if updateErr := db.Model(&meta.Source{}).
			Where("id = ? AND owner_id = ?", source.ID, source.OwnerID).
			Updates(map[string]any{
				"status":     meta.SourceStatusPaused,
				"last_error": "一刻相册固定目录迁移被现有同名文件或目录阻挡，请整理“同步文件夹/一刻相册”后重新配置 Cookie",
				"revision":   gorm.Expr("revision + 1"),
				"updated_at": now,
			}).Error; updateErr != nil {
			return updateErr
		}
	}
	return nil
}

func migrateLegacyYikeTarget(tx *gorm.DB, source meta.Source) error {
	if source.TargetNodeID == nil {
		return nil
	}
	var target meta.Node
	if err := tx.
		Where("id = ? AND owner_id = ? AND deleted_at IS NULL", *source.TargetNodeID, source.OwnerID).
		First(&target).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if _, ok := legacyYikeTargetAccountID(target.Name); !ok || target.ParentID == nil {
		return nil
	}

	var connector meta.Node
	if err := tx.
		Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			*target.ParentID, source.OwnerID, meta.NodeTypeDir).
		First(&connector).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if connector.Name != yikeTargetConnectorName || connector.ParentID == nil {
		return nil
	}

	var legacyRoot meta.Node
	if err := tx.
		Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			*connector.ParentID, source.OwnerID, meta.NodeTypeDir).
		First(&legacyRoot).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if legacyRoot.Name != legacyYikeTargetRootName || legacyRoot.ParentID == nil {
		return nil
	}

	syncRoot, err := ensureMigrationDirectory(tx, source.OwnerID, *legacyRoot.ParentID, yikeTargetRootName)
	if err != nil {
		return err
	}
	syncConnector, err := ensureMigrationDirectory(tx, source.OwnerID, syncRoot.ID, yikeTargetConnectorName)
	if err != nil {
		return err
	}

	var conflict meta.Node
	err = tx.
		Where("owner_id = ? AND parent_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL",
			source.OwnerID, syncConnector.ID, target.Name).
		First(&conflict).Error
	if err == nil && conflict.ID != target.ID {
		return fmt.Errorf("%w: target %q already exists", errLegacyYikeTargetMigrationBlocked, target.Name)
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	if target.ParentID == nil || *target.ParentID != syncConnector.ID {
		now := time.Now().UTC()
		if err := tx.Model(&meta.Node{}).
			Where("id = ? AND owner_id = ? AND deleted_at IS NULL", target.ID, source.OwnerID).
			Updates(map[string]any{
				"parent_id":  syncConnector.ID,
				"revision":   gorm.Expr("revision + 1"),
				"updated_at": now,
			}).Error; err != nil {
			return err
		}
	}
	return pruneLegacyMigrationParents(tx, source.OwnerID, connector.ID, legacyRoot.ID)
}

func legacyYikeTargetAccountID(name string) (int64, bool) {
	name = strings.TrimSpace(name)
	if !strings.HasPrefix(name, "uid_") {
		return 0, false
	}
	rest := strings.TrimPrefix(name, "uid_")
	separator := strings.IndexByte(rest, '_')
	if separator <= 0 {
		return 0, false
	}
	accountID, err := strconv.ParseInt(rest[:separator], 10, 64)
	return accountID, err == nil && accountID > 0
}

func ensureMigrationDirectory(tx *gorm.DB, ownerID, parentID uint64, name string) (meta.Node, error) {
	var existing meta.Node
	err := tx.
		Where("owner_id = ? AND parent_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL",
			ownerID, parentID, name).
		First(&existing).Error
	if err == nil {
		if existing.Type != meta.NodeTypeDir {
			return meta.Node{}, fmt.Errorf("%w: migration target %q is occupied by a file", errLegacyYikeTargetMigrationBlocked, name)
		}
		return existing, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return meta.Node{}, err
	}

	created := meta.Node{
		OwnerID: ownerID, ParentID: &parentID, Name: name, Type: meta.NodeTypeDir, Revision: 1,
	}
	if err := tx.Create(&created).Error; err != nil {
		return meta.Node{}, err
	}
	return created, nil
}

func pruneLegacyMigrationParents(tx *gorm.DB, ownerID, connectorID, rootID uint64) error {
	var childCount int64
	if err := tx.Model(&meta.Node{}).
		Where("owner_id = ? AND parent_id = ? AND deleted_at IS NULL", ownerID, connectorID).
		Count(&childCount).Error; err != nil {
		return err
	}
	if childCount != 0 {
		return nil
	}

	now := time.Now().UTC()
	if err := tx.Model(&meta.Node{}).
		Where("id = ? AND owner_id = ? AND deleted_at IS NULL", connectorID, ownerID).
		Updates(map[string]any{
			"deleted_at": now,
			"revision":   gorm.Expr("revision + 1"),
			"updated_at": now,
		}).Error; err != nil {
		return err
	}

	if err := tx.Model(&meta.Node{}).
		Where("owner_id = ? AND parent_id = ? AND deleted_at IS NULL", ownerID, rootID).
		Count(&childCount).Error; err != nil {
		return err
	}
	if childCount != 0 {
		return nil
	}
	return tx.Model(&meta.Node{}).
		Where("id = ? AND owner_id = ? AND deleted_at IS NULL", rootID, ownerID).
		Updates(map[string]any{
			"deleted_at": now,
			"revision":   gorm.Expr("revision + 1"),
			"updated_at": now,
		}).Error
}
