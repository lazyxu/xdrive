package api

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const (
	yikeSourceKind           = "yike_photos"
	yikeTargetRootName       = "同步文件夹"
	yikeLegacyTargetRootName = "来源"
	yikeTargetConnectorName  = "一刻相册"
)

func yikeManagedTargetInSubtreeDB(ctx context.Context, db *gorm.DB, ownerID, nodeID uint64) (bool, error) {
	if db == nil || ownerID == 0 || nodeID == 0 {
		return false, nil
	}
	scoped := db.WithContext(ctx)
	// Some core-only deployments/tests intentionally create the node schema
	// without enabling external Sources. Managed-target protection is only
	// meaningful when the Sources table exists; ordinary node mutations must
	// remain independent of that optional schema.
	if !scoped.Migrator().HasTable(&meta.Source{}) {
		return false, nil
	}

	var protected bool
	row := scoped.Raw(`
WITH RECURSIVE subtree AS (
	SELECT id
	FROM xd_nodes
	WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
	UNION ALL
	SELECT child.id
	FROM xd_nodes AS child
	JOIN subtree AS parent ON child.parent_id = parent.id
	WHERE child.owner_id = ? AND child.deleted_at IS NULL
)
SELECT EXISTS (
	SELECT 1
	FROM xd_sources AS source
	JOIN subtree ON subtree.id = source.target_node_id
	WHERE source.owner_id = ? AND source.kind = ?
)`, nodeID, ownerID, ownerID, ownerID, yikeSourceKind).Row()
	if err := row.Scan(&protected); err != nil {
		return false, err
	}
	return protected, nil
}

func yikeManagedTargetInIDsDB(ctx context.Context, db *gorm.DB, ownerID uint64, ids []uint64) (bool, error) {
	if db == nil || ownerID == 0 || len(ids) == 0 {
		return false, nil
	}
	scoped := db.WithContext(ctx)
	// Some core-only deployments/tests intentionally create the node schema
	// without enabling external Sources. Managed-target protection is only
	// meaningful when the Sources table exists; ordinary node mutations must
	// remain independent of that optional schema.
	if !scoped.Migrator().HasTable(&meta.Source{}) {
		return false, nil
	}
	var count int64
	if err := scoped.Model(&meta.Source{}).
		Where("owner_id = ? AND kind = ? AND target_node_id IN ?", ownerID, yikeSourceKind, ids).
		Count(&count).Error; err != nil {
		return false, err
	}
	return count != 0, nil
}

func yikeAccountID(identity sourceCredentialTestDTO) (int64, error) {
	accountID, err := strconv.ParseInt(strings.TrimSpace(identity.AccountExternalID), 10, 64)
	if err != nil || accountID <= 0 {
		return 0, fmt.Errorf("invalid Yike account id %q", identity.AccountExternalID)
	}
	return accountID, nil
}

func yikeManagedTargetLeaf(accountID int64, accountName string) (string, error) {
	name := sanitizeYikeTargetSegment(accountName)
	if name == "" {
		name = "用户"
	}
	leaf := fmt.Sprintf("uid_%d_%s", accountID, name)
	leaf = truncateUTF8Bytes(leaf, 255)
	if err := meta.ValidateName(leaf); err != nil {
		return "", fmt.Errorf("invalid Yike target folder: %w", err)
	}
	return leaf, nil
}

func ensureYikeManagedParentTx(ctx context.Context, tx *gorm.DB, ownerID uint64) (meta.Node, error) {
	if tx == nil || ownerID == 0 {
		return meta.Node{}, fmt.Errorf("Yike target storage is unavailable")
	}
	var root meta.Node
	if err := tx.WithContext(ctx).
		Where("owner_id = ? AND parent_id IS NULL AND type = ? AND deleted_at IS NULL", ownerID, meta.NodeTypeDir).
		First(&root).Error; err != nil {
		return meta.Node{}, fmt.Errorf("load xDrive root: %w", err)
	}

	parent := root
	var err error
	for _, segment := range []string{yikeTargetRootName, yikeTargetConnectorName} {
		parent, err = ensureOwnedChildDirectoryTx(ctx, tx, ownerID, parent.ID, segment)
		if err != nil {
			return meta.Node{}, err
		}
	}
	return parent, nil
}

func ensureYikeManagedTargetTx(ctx context.Context, tx *gorm.DB, ownerID uint64, identity sourceCredentialTestDTO) (meta.Node, error) {
	accountID, err := yikeAccountID(identity)
	if err != nil {
		return meta.Node{}, err
	}
	leaf, err := yikeManagedTargetLeaf(accountID, identity.AccountName)
	if err != nil {
		return meta.Node{}, err
	}
	parent, err := ensureYikeManagedParentTx(ctx, tx, ownerID)
	if err != nil {
		return meta.Node{}, err
	}
	return ensureOwnedChildDirectoryTx(ctx, tx, ownerID, parent.ID, leaf)
}

func ensureOwnedChildDirectoryTx(ctx context.Context, tx *gorm.DB, ownerID, parentID uint64, name string) (meta.Node, error) {
	var existing meta.Node
	err := tx.WithContext(ctx).
		Where("owner_id = ? AND parent_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL", ownerID, parentID, name).
		First(&existing).Error
	if err == nil {
		if existing.Type != meta.NodeTypeDir {
			return meta.Node{}, fmt.Errorf("%w: %q is occupied by a file", errYikeTargetPathConflict, name)
		}
		return existing, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return meta.Node{}, err
	}

	created := meta.Node{OwnerID: ownerID, ParentID: &parentID, Name: name, Type: meta.NodeTypeDir, Revision: 1}
	if err := tx.WithContext(ctx).Create(&created).Error; err != nil {
		if !isDuplicate(err) {
			return meta.Node{}, err
		}
		if err := tx.WithContext(ctx).
			Where("owner_id = ? AND parent_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL", ownerID, parentID, name).
			First(&existing).Error; err != nil {
			return meta.Node{}, err
		}
		if existing.Type != meta.NodeTypeDir {
			return meta.Node{}, fmt.Errorf("%w: %q is occupied by a file", errYikeTargetPathConflict, name)
		}
		return existing, nil
	}
	return created, nil
}

func bindYikeManagedTargetTx(ctx context.Context, tx *gorm.DB, source *meta.Source, identity sourceCredentialTestDTO) error {
	if source == nil || source.ID == 0 || source.Kind != yikeSourceKind {
		return nil
	}
	accountID, err := yikeAccountID(identity)
	if err != nil {
		return err
	}

	var itemCount int64
	if err := tx.WithContext(ctx).Model(&meta.SourceItem{}).Where("source_id = ?", source.ID).Count(&itemCount).Error; err != nil {
		return err
	}
	// An already-populated Yike Source keeps the same target node ID. If it is
	// one of xDrive's managed uid_* targets, move that node in-place to the
	// current managed hierarchy instead of creating a second copy of the data.
	if itemCount > 0 && source.TargetNodeID != nil {
		var currentTarget meta.Node
		if err := tx.WithContext(ctx).
			Where("id = ? AND owner_id = ? AND deleted_at IS NULL", *source.TargetNodeID, source.OwnerID).
			First(&currentTarget).Error; err != nil {
			return err
		}
		if currentAccountID, managed := managedYikeTargetAccountID(currentTarget.Name); managed {
			if currentAccountID != accountID {
				return errYikeAccountMismatch
			}
			desiredLeaf, err := yikeManagedTargetLeaf(accountID, identity.AccountName)
			if err != nil {
				return err
			}
			desiredParent, err := ensureYikeManagedParentTx(ctx, tx, source.OwnerID)
			if err != nil {
				return err
			}
			parentChanged := currentTarget.ParentID == nil || *currentTarget.ParentID != desiredParent.ID
			if parentChanged || currentTarget.Name != desiredLeaf {
				var conflict meta.Node
				err := tx.WithContext(ctx).
					Where("owner_id = ? AND parent_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL",
						source.OwnerID, desiredParent.ID, desiredLeaf).
					First(&conflict).Error
				if err == nil && conflict.ID != currentTarget.ID {
					return errYikeAccountAlreadyConfigured
				}
				if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
					return err
				}

				oldParentID := currentTarget.ParentID
				now := time.Now().UTC()
				if err := tx.WithContext(ctx).Model(&meta.Node{}).
					Where("id = ? AND owner_id = ? AND deleted_at IS NULL", currentTarget.ID, source.OwnerID).
					Updates(map[string]any{
						"parent_id":  desiredParent.ID,
						"name":       desiredLeaf,
						"revision":   gorm.Expr("revision + 1"),
						"updated_at": now,
					}).Error; err != nil {
					return err
				}
				if oldParentID != nil && *oldParentID != desiredParent.ID {
					if err := pruneLegacyYikeParentsTx(ctx, tx, source.OwnerID, *oldParentID); err != nil {
						return err
					}
				}
			}
		}
		if source.Status != meta.SourceStatusActive {
			now := time.Now().UTC()
			if err := tx.WithContext(ctx).Model(&meta.Source{}).
				Where("id = ? AND owner_id = ?", source.ID, source.OwnerID).
				Updates(map[string]any{
					"status":     meta.SourceStatusActive,
					"revision":   gorm.Expr("revision + 1"),
					"updated_at": now,
					"last_error": "",
				}).Error; err != nil {
				return err
			}
			source.Status = meta.SourceStatusActive
			source.Revision++
		}
		return nil
	}

	target, err := ensureYikeManagedTargetTx(ctx, tx, source.OwnerID, identity)
	if err != nil {
		return err
	}
	var duplicateCount int64
	if err := tx.WithContext(ctx).Model(&meta.Source{}).
		Where("owner_id = ? AND kind = ? AND id <> ? AND target_node_id = ?", source.OwnerID, yikeSourceKind, source.ID, target.ID).
		Count(&duplicateCount).Error; err != nil {
		return err
	}
	if duplicateCount != 0 {
		return errYikeAccountAlreadyConfigured
	}
	if source.TargetNodeID == nil || *source.TargetNodeID != target.ID {
		var childCount int64
		if err := tx.WithContext(ctx).Model(&meta.Node{}).
			Where("owner_id = ? AND parent_id = ? AND deleted_at IS NULL", source.OwnerID, target.ID).
			Count(&childCount).Error; err != nil {
			return err
		}
		if childCount != 0 {
			return errYikeTargetContainsData
		}
	}
	updates := map[string]any{
		"target_node_id": target.ID,
		"updated_at":     time.Now().UTC(),
	}
	if source.Status != meta.SourceStatusActive {
		updates["status"] = meta.SourceStatusActive
		updates["last_error"] = ""
	}
	if source.TargetNodeID == nil || *source.TargetNodeID != target.ID || source.Status != meta.SourceStatusActive {
		updates["revision"] = gorm.Expr("revision + 1")
	}
	if err := tx.WithContext(ctx).Model(&meta.Source{}).
		Where("id = ? AND owner_id = ?", source.ID, source.OwnerID).
		Updates(updates).Error; err != nil {
		return err
	}
	targetID := target.ID
	source.TargetNodeID = &targetID
	if _, ok := updates["status"]; ok {
		source.Status = meta.SourceStatusActive
	}
	if _, ok := updates["revision"]; ok {
		source.Revision++
	}
	return nil
}

func pruneLegacyYikeParentsTx(ctx context.Context, tx *gorm.DB, ownerID, connectorID uint64) error {
	var connector meta.Node
	if err := tx.WithContext(ctx).
		Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL", connectorID, ownerID, meta.NodeTypeDir).
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
	if err := tx.WithContext(ctx).
		Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL", *connector.ParentID, ownerID, meta.NodeTypeDir).
		First(&legacyRoot).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if legacyRoot.Name != yikeLegacyTargetRootName {
		return nil
	}

	var childCount int64
	if err := tx.WithContext(ctx).Model(&meta.Node{}).
		Where("owner_id = ? AND parent_id = ? AND deleted_at IS NULL", ownerID, connector.ID).
		Count(&childCount).Error; err != nil {
		return err
	}
	if childCount != 0 {
		return nil
	}

	now := time.Now().UTC()
	if err := tx.WithContext(ctx).Model(&meta.Node{}).
		Where("id = ? AND owner_id = ? AND deleted_at IS NULL", connector.ID, ownerID).
		Updates(map[string]any{"deleted_at": now, "revision": gorm.Expr("revision + 1"), "updated_at": now}).Error; err != nil {
		return err
	}

	if err := tx.WithContext(ctx).Model(&meta.Node{}).
		Where("owner_id = ? AND parent_id = ? AND deleted_at IS NULL", ownerID, legacyRoot.ID).
		Count(&childCount).Error; err != nil {
		return err
	}
	if childCount == 0 {
		if err := tx.WithContext(ctx).Model(&meta.Node{}).
			Where("id = ? AND owner_id = ? AND deleted_at IS NULL", legacyRoot.ID, ownerID).
			Updates(map[string]any{"deleted_at": now, "revision": gorm.Expr("revision + 1"), "updated_at": now}).Error; err != nil {
			return err
		}
	}
	return nil
}

func managedYikeTargetAccountID(name string) (int64, bool) {
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
	if err != nil || accountID <= 0 {
		return 0, false
	}
	return accountID, true
}

func sanitizeYikeTargetSegment(value string) string {
	value = strings.TrimSpace(value)
	var b strings.Builder
	for _, r := range value {
		switch {
		case r < 32:
			b.WriteRune('_')
		case strings.ContainsRune(`<>:"/\\|?*`, r):
			b.WriteRune('_')
		default:
			b.WriteRune(r)
		}
	}
	return strings.TrimRight(strings.TrimSpace(b.String()), " .")
}

func truncateUTF8Bytes(value string, max int) string {
	if max <= 0 {
		return ""
	}
	for len([]byte(value)) > max {
		_, size := utf8.DecodeLastRuneInString(value)
		if size == 0 {
			return ""
		}
		value = value[:len(value)-size]
	}
	return value
}
