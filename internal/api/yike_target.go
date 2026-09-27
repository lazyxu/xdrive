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
	yikeSourceKind          = "yike_photos"
	yikeTargetRootName      = "来源"
	yikeTargetConnectorName = "一刻相册"
)

func yikeAccountID(identity sourceCredentialTestDTO) (int64, error) {
	accountID, err := strconv.ParseInt(strings.TrimSpace(identity.AccountExternalID), 10, 64)
	if err != nil || accountID <= 0 {
		return 0, fmt.Errorf("invalid Yike account id %q", identity.AccountExternalID)
	}
	return accountID, nil
}

func ensureYikeManagedTargetTx(ctx context.Context, tx *gorm.DB, ownerID uint64, identity sourceCredentialTestDTO) (meta.Node, error) {
	if tx == nil || ownerID == 0 {
		return meta.Node{}, fmt.Errorf("Yike target storage is unavailable")
	}
	accountID, err := yikeAccountID(identity)
	if err != nil {
		return meta.Node{}, err
	}
	name := sanitizeYikeTargetSegment(identity.AccountName)
	if name == "" {
		name = "用户"
	}
	leaf := fmt.Sprintf("uid_%d_%s", accountID, name)
	leaf = truncateUTF8Bytes(leaf, 255)
	if err := meta.ValidateName(leaf); err != nil {
		return meta.Node{}, fmt.Errorf("invalid Yike target folder: %w", err)
	}

	var root meta.Node
	if err := tx.WithContext(ctx).
		Where("owner_id = ? AND parent_id IS NULL AND type = ? AND deleted_at IS NULL", ownerID, meta.NodeTypeDir).
		First(&root).Error; err != nil {
		return meta.Node{}, fmt.Errorf("load xDrive root: %w", err)
	}

	parent := root
	for _, segment := range []string{yikeTargetRootName, yikeTargetConnectorName, leaf} {
		parent, err = ensureOwnedChildDirectoryTx(ctx, tx, ownerID, parent.ID, segment)
		if err != nil {
			return meta.Node{}, err
		}
	}
	return parent, nil
}

func ensureOwnedChildDirectoryTx(ctx context.Context, tx *gorm.DB, ownerID, parentID uint64, name string) (meta.Node, error) {
	var existing meta.Node
	err := tx.WithContext(ctx).
		Where("owner_id = ? AND parent_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL", ownerID, parentID, name).
		First(&existing).Error
	if err == nil {
		if existing.Type != meta.NodeTypeDir {
			return meta.Node{}, fmt.Errorf("Yike managed target %q is occupied by a file", name)
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
			return meta.Node{}, fmt.Errorf("Yike managed target %q is occupied by a file", name)
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
	// Never silently relocate an already-populated Source. Managed targets encode
	// the account UID, so a Cookie replacement must still belong to that UID.
	if itemCount > 0 && source.TargetNodeID != nil {
		var currentTarget meta.Node
		if err := tx.WithContext(ctx).
			Where("id = ? AND owner_id = ? AND deleted_at IS NULL", *source.TargetNodeID, source.OwnerID).
			First(&currentTarget).Error; err != nil {
			return err
		}
		if currentAccountID, ok := managedYikeTargetAccountID(currentTarget.Name); ok && currentAccountID != accountID {
			return errYikeAccountMismatch
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
