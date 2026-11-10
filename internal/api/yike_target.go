package api

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const (
	yikeSourceKind              = "yike_photos"
	yikeTargetRootName          = "同步文件夹"
	yikePullTargetRootName      = "Pull"
	yikePullTargetConnectorName = "Yike Photos"
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

// Yike credentials activate only the canonical Source target provisioned
// atomically by POST /sources. Credential refresh never creates, adopts or
// reparents an old uid_* folder.
func bindYikeManagedTargetTx(ctx context.Context, tx *gorm.DB, source *meta.Source, identity sourceCredentialTestDTO) error {
	if source == nil || source.ID == 0 || source.Kind != yikeSourceKind {
		return errInvalidSourceConfig
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
	if source.Direction != meta.SourceDirectionPull || source.TargetNodeID == nil ||
		*source.TargetNodeID == 0 || !source.TargetManaged {
		return errYikeTargetContainsData
	}
	var target meta.Node
	if err := tx.WithContext(ctx).
		Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			*source.TargetNodeID, source.OwnerID, meta.NodeTypeDir).
		Take(&target).Error; err != nil {
		return err
	}
	if target.ParentID == nil || target.Name != source.Name {
		return errYikeTargetContainsData
	}
	names, err := managedSourceTargetAncestorNamesTx(tx, *source, target)
	if err != nil || len(names) != 3 || names[0] != yikePullTargetConnectorName ||
		names[1] != yikePullTargetRootName || names[2] != yikeTargetRootName {
		return errYikeTargetContainsData
	}
	return bindYikeProviderAccountTx(ctx, tx, source, accountIDText)
}

func bindYikeProviderAccountTx(ctx context.Context, tx *gorm.DB, source *meta.Source, accountID string) error {
	if source == nil || source.ID == 0 || accountID == "" {
		return errInvalidSourceConfig
	}
	if source.ProviderAccountID != "" && source.ProviderAccountID != accountID {
		return errYikeAccountMismatch
	}
	if err := requireYikeAccountNotClaimedTx(ctx, tx, *source, accountID); err != nil {
		return err
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

// The provider account ID is the sole duplicate-account authority, including
// archived Sources. A uid_* directory name is never adopted as an identity.
func requireYikeAccountNotClaimedTx(
	ctx context.Context, tx *gorm.DB, source meta.Source, accountID string,
) error {
	var count int64
	if err := tx.WithContext(ctx).Model(&meta.Source{}).
		Where("owner_id = ? AND id <> ? AND kind = ? AND provider_account_id = ?",
			source.OwnerID, source.ID, yikeSourceKind, accountID).
		Count(&count).Error; err != nil {
		return err
	}
	if count != 0 {
		return errYikeAccountAlreadyConfigured
	}
	return nil
}
