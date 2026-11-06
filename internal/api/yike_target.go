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
	yikeSourceKind              = "yike_photos"
	yikeTargetRootName          = "同步文件夹"
	yikePullTargetRootName      = "Pull"
	yikePullTargetConnectorName = "Yike Photos"
	yikeLegacyTargetRootName    = "来源"
	yikeTargetConnectorName     = "一刻相册"
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

type yikeManagedTargetIDs map[uint64]struct{}

func loadYikeManagedTargetIDsDB(
	ctx context.Context,
	db *gorm.DB,
	ownerID uint64,
) (yikeManagedTargetIDs, error) {
	targets := make(yikeManagedTargetIDs)
	if db == nil || ownerID == 0 {
		return targets, nil
	}
	scoped := db.WithContext(ctx)
	// Some core-only deployments/tests intentionally create the node schema
	// without enabling external Sources. Managed-target protection is only
	// meaningful when the Sources table exists; ordinary node mutations must
	// remain independent of that optional schema.
	if !scoped.Migrator().HasTable(&meta.Source{}) {
		return targets, nil
	}

	var ids []uint64
	if err := scoped.Model(&meta.Source{}).
		Where("owner_id = ? AND kind = ? AND target_node_id IS NOT NULL", ownerID, yikeSourceKind).
		Pluck("target_node_id", &ids).Error; err != nil {
		return nil, err
	}
	for _, id := range ids {
		if id != 0 {
			targets[id] = struct{}{}
		}
	}
	return targets, nil
}

func yikeManagedTargetInIDs(targets yikeManagedTargetIDs, ids []uint64) bool {
	if len(targets) == 0 || len(ids) == 0 {
		return false
	}
	for _, id := range ids {
		if _, protected := targets[id]; protected {
			return true
		}
	}
	return false
}

func yikeManagedTargetInIDsDB(ctx context.Context, db *gorm.DB, ownerID uint64, ids []uint64) (bool, error) {
	if len(ids) == 0 {
		return false, nil
	}
	targets, err := loadYikeManagedTargetIDsDB(ctx, db, ownerID)
	if err != nil {
		return false, err
	}
	return yikeManagedTargetInIDs(targets, ids), nil
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
	for _, segment := range []string{yikeTargetRootName, yikePullTargetRootName, yikePullTargetConnectorName} {
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
	if source.Status == meta.SourceStatusArchived {
		return errSourceArchived
	}
	accountID, err := yikeAccountID(identity)
	if err != nil {
		return err
	}
	accountIDText := strconv.FormatInt(accountID, 10)
	if source.ProviderAccountID != "" && source.ProviderAccountID != accountIDText {
		return errYikeAccountMismatch
	}

	var target meta.Node
	if source.TargetNodeID != nil {
		if err := tx.WithContext(ctx).
			Where("id = ? AND owner_id = ? AND deleted_at IS NULL", *source.TargetNodeID, source.OwnerID).
			Take(&target).Error; err != nil {
			return err
		}
		if target.Type != meta.NodeTypeDir || target.ParentID == nil {
			return errYikeTargetContainsData
		}

		// New Sources already own Pull/Yike Photos/<SourceName>. Bind the
		// provider account identity without changing the Node ID or leaf.
		if source.TargetManaged && target.Name == source.Name {
			names, err := managedSourceTargetAncestorNamesTx(tx, *source, target)
			if err != nil {
				return errYikeTargetContainsData
			}
			if len(names) == 3 && names[0] == "Yike Photos" &&
				names[1] == yikePullTargetRootName && names[2] == yikeTargetRootName {
				return bindYikeProviderAccountTx(ctx, tx, source, accountIDText)
			}
		}

		// Existing uid_* targets are legacy identities. Preserve their exact
		// path and Node ID; never migrate or rename them as part of credential
		// refresh. Unmarked targets are accepted only at the verified legacy
		// location with the existing exclusive-subtree checks.
		if currentAccountID, managed := managedYikeTargetAccountID(target.Name); managed {
			if currentAccountID != accountID {
				return errYikeAccountMismatch
			}
			if !source.TargetManaged {
				proven, err := verifiedLegacyYikeTargetLocationTx(ctx, tx, *source, target)
				if err != nil {
					return err
				}
				if !proven {
					return errYikeTargetContainsData
				}
				if err := verifyYikeTargetRelocationTx(ctx, tx, *source, target); err != nil {
					return err
				}
			}
			return bindYikeProviderAccountTx(ctx, tx, source, accountIDText)
		}

		// Never take over, detach, or silently replace an ordinary directory,
		// even when it is empty. This is not a migration endpoint.
		return errYikeTargetContainsData
	}

	// Compatibility for a pre-existing Source that has never had a target.
	// It keeps the historical UID-based layout; all newly created Sources use
	// the new user-named leaf provisioned during POST /sources.
	target, err = createExclusiveYikeManagedTargetTx(ctx, tx, *source, identity)
	if err != nil {
		return err
	}
	return bindYikeLegacyCreatedTargetTx(ctx, tx, source, target, accountIDText)
}

func bindYikeLegacyCreatedTargetTx(ctx context.Context, tx *gorm.DB, source *meta.Source, target meta.Node, accountID string) error {
	var duplicateCount int64
	if err := tx.WithContext(ctx).Model(&meta.Source{}).
		Where("owner_id = ? AND id <> ? AND kind = ? AND provider_account_id = ?",
			source.OwnerID, source.ID, yikeSourceKind, accountID).
		Count(&duplicateCount).Error; err != nil {
		return err
	}
	if duplicateCount != 0 {
		return errYikeAccountAlreadyConfigured
	}
	targetID := target.ID
	updates := map[string]any{
		"target_node_id": target.ID,
		"target_managed": true,
		"provider_account_id": accountID,
		"updated_at": time.Now().UTC(),
		"status": meta.SourceStatusActive,
		"last_error": "",
		"revision": gorm.Expr("revision + 1"),
	}
	if err := tx.WithContext(ctx).Model(&meta.Source{}).
		Where("id = ? AND owner_id = ?", source.ID, source.OwnerID).
		Updates(updates).Error; err != nil {
		if isDuplicate(err) {
			return errYikeAccountAlreadyConfigured
		}
		return err
	}
	source.TargetNodeID = &targetID
	source.TargetManaged = true
	source.ProviderAccountID = accountID
	source.Status = meta.SourceStatusActive
	source.Revision++
	return nil
}

func bindYikeProviderAccountTx(ctx context.Context, tx *gorm.DB, source *meta.Source, accountID string) error {
	if source == nil || source.ID == 0 || accountID == "" {
		return errInvalidSourceConfig
	}
	if source.ProviderAccountID != "" && source.ProviderAccountID != accountID {
		return errYikeAccountMismatch
	}
	var duplicateCount int64
	if err := tx.WithContext(ctx).Model(&meta.Source{}).
		Where("owner_id = ? AND id <> ? AND kind = ? AND provider_account_id = ?",
			source.OwnerID, source.ID, yikeSourceKind, accountID).
		Count(&duplicateCount).Error; err != nil {
		return err
	}
	if duplicateCount != 0 {
		return errYikeAccountAlreadyConfigured
	}
	updates := map[string]any{}
	if source.ProviderAccountID != accountID {
		updates["provider_account_id"] = accountID
	}
	if source.Status != meta.SourceStatusActive {
		updates["status"] = meta.SourceStatusActive
		updates["last_error"] = ""
	}
	if len(updates) == 0 {
		return nil
	}
	updates["revision"] = gorm.Expr("revision + 1")
	updates["updated_at"] = time.Now().UTC()
	result := tx.WithContext(ctx).Model(&meta.Source{}).
		Where("id = ? AND owner_id = ? AND revision = ?", source.ID, source.OwnerID, source.Revision).
		Updates(updates)
	if result.Error != nil {
		if isDuplicate(result.Error) {
			return errYikeAccountAlreadyConfigured
		}
		return result.Error
	}
	if result.RowsAffected != 1 {
		return errRevisionConflict
	}
	source.ProviderAccountID = accountID
	if _, ok := updates["status"]; ok {
		source.Status = meta.SourceStatusActive
	}
	source.Revision++
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
	// Older/core-only test databases can omit the Share model entirely.
	// In a real Server deployment Shares are always migrated before Sources.
	hasShares := tx.Migrator().HasTable(&meta.Share{})
	var directShares int64
	if hasShares {
		if err := tx.WithContext(ctx).Model(&meta.Share{}).
			Where("owner_id = ? AND node_id = ?", ownerID, connector.ID).
			Count(&directShares).Error; err != nil {
			return err
		}
		if directShares != 0 {
			return nil
		}
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
		if hasShares {
			if err := tx.WithContext(ctx).Model(&meta.Share{}).
				Where("owner_id = ? AND node_id = ?", ownerID, legacyRoot.ID).
				Count(&directShares).Error; err != nil {
				return err
			}
			if directShares != 0 {
				return nil
			}
		}
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
