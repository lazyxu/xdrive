package api

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	errLocalDraftUnauthorized = errors.New("owning device credential required for local draft")
	errLocalDraftNotEmpty     = errors.New("local draft has binding or history")
	errLocalDraftWrongType    = errors.New("local folder push draft required")
)

// discardLocalSourceDraft is intentionally distinct from DELETE /sources/:id.
// The generic endpoint continues to require an authorized Root for bound Push.
// This endpoint deletes only an empty, paused, never-bound local creation
// draft; no remotely stored files, SourceItems, runs or Root grants are touched.
func (s *Server) discardLocalSourceDraft(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	parsed, err := uuid.Parse(strings.TrimSpace(c.GetHeader("X-XDrive-Device-ID")))
	if err != nil {
		fail(c, http.StatusForbidden, "owning device credential required")
		return
	}
	deviceID := parsed.String()
	var currentRevision uint64
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		// Match revocation and first-bind ordering: device lock precedes
		// Source lock. Recheck the secret and status inside the write txn.
		var device meta.ClientDevice
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", deviceID, userID(c)).
			Take(&device).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errLocalDraftUnauthorized
			}
			return err
		}
		if !clientDeviceCredentialMatches(device, c.GetHeader("X-XDrive-Device-Token")) {
			return errLocalDraftUnauthorized
		}
		var source meta.Source
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", id, userID(c)).
			Take(&source).Error; err != nil {
			return err
		}
		currentRevision = source.Revision
		if source.Kind != meta.SourceKindLocalFolder || source.Direction != meta.SourceDirectionPush {
			return errLocalDraftWrongType
		}
		// A legacy unclaimed draft must not be reclaimed by a new device
		// simply because that device has the same account JWT.
		if source.LocalCreatorDeviceID == nil || *source.LocalCreatorDeviceID != device.ID {
			return errLocalDraftUnauthorized
		}
		if source.Revision != expected {
			return errRevisionConflict
		}
		if source.Status != meta.SourceStatusPaused || source.RunRequestedAt != nil ||
			source.Checkpoint != "" || source.LastRunAt != nil || source.LastSuccessAt != nil ||
			source.RetryAttempt != 0 || source.RetryAt != nil {
			return errLocalDraftNotEmpty
		}
		// The first bind also locks device then Source. Counts here cannot
		// race a new binding after we acquired both locks. Never cascade
		// deletion of existing history, files, credentials, or collections.
		for _, model := range []any{
			&meta.LocalSourceBinding{},
			&meta.SyncRun{},
			&meta.SourceItem{},
			&meta.SourceRunFailure{},
			&meta.SourceCollection{},
			&meta.SourceCredential{},
			&meta.SourceConnectorConfig{},
		} {
			var count int64
			if err := tx.Model(model).Where("source_id = ?", id).
				Limit(1).Count(&count).Error; err != nil {
				return err
			}
			if count != 0 {
				return errLocalDraftNotEmpty
			}
		}
		// A never-bound, pristine Source now owns a newly-provisioned empty
		// cloud leaf. Only the draft-specific cancellation endpoint may
		// remove that leaf. A normal Source delete must still preserve files.
		if source.TargetManaged && source.TargetNodeID != nil {
			if err := discardPristineLocalManagedTargetTx(c.Request.Context(), tx, source); err != nil {
				return err
			}
		}
		return tx.Delete(&source).Error
	})
	if err != nil {
		switch {
		case errors.Is(err, errLocalDraftUnauthorized):
			fail(c, http.StatusForbidden, "owning device credential invalid or revoked")
		case errors.Is(err, errLocalDraftWrongType):
			fail(c, http.StatusBadRequest, "local folder push draft required")
		case errors.Is(err, errRevisionConflict):
			revisionConflict(c, expected, currentRevision)
		case errors.Is(err, errLocalDraftNotEmpty):
			fail(c, http.StatusConflict, "local draft is bound, active, or has history")
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "source not found")
		default:
			fail(c, http.StatusInternalServerError, "discard local draft failed")
		}
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.Status(http.StatusNoContent)
}

// discardPristineLocalManagedTargetTx is only reachable after verifying the
// creating device, Source revision, paused status and absence of sync history.
// Do not detach a Source that is already visible via a Share, pin, upload, or
// another Source. Preserve legacy manually selected targets without touching
// their Nodes.
func discardPristineLocalManagedTargetTx(ctx context.Context, tx *gorm.DB, source meta.Source) error {
	if !isLocalFolderPush(source) || !source.TargetManaged || source.TargetNodeID == nil {
		return errLocalDraftNotEmpty
	}
	var target meta.Node
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			*source.TargetNodeID, source.OwnerID, meta.NodeTypeDir).
		Take(&target).Error; err != nil {
		return errLocalDraftNotEmpty
	}
	if target.Name != source.Name || target.ParentID == nil {
		return errLocalDraftNotEmpty
	}
	if _, err := managedSourceTargetAncestorIDsTx(tx, source, target); err != nil {
		return errLocalDraftNotEmpty
	}
	// Any direct or indirect metadata reference must make cancellation
	// non-destructive. Tests with a minimal schema may omit optional tables.
	type guard struct {
		model     any
		predicate string
		args      []any
	}
	checks := []guard{
		{&meta.Node{}, "parent_id = ?", []any{target.ID}},
		{&meta.Source{}, "target_node_id = ? AND id <> ?", []any{target.ID, source.ID}},
		{&meta.File{}, "node_id = ?", []any{target.ID}},
		{&meta.FileVersion{}, "node_id = ?", []any{target.ID}},
		{&meta.Share{}, "node_id = ?", []any{target.ID}},
		{&meta.UploadSession{}, "parent_id = ? OR node_id = ? OR result_node_id = ?", []any{target.ID, target.ID, target.ID}},
		{&meta.FileQuickAccess{}, "node_id = ?", []any{target.ID}},
		{&meta.FileFavorite{}, "node_id = ?", []any{target.ID}},
		{&meta.FileRecentAccess{}, "node_id = ?", []any{target.ID}},
		{&meta.FileOperation{}, "parent_id = ?", []any{target.ID}},
	}
	for _, check := range checks {
		if !tx.Migrator().HasTable(check.model) {
			continue
		}
		var count int64
		if err := tx.WithContext(ctx).Model(check.model).
			Where(check.predicate, check.args...).Limit(1).Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return errLocalDraftNotEmpty
		}
	}
	// Target is an empty, exclusively-owned directory. Hard deletion here
	// does not remove data, CAS, SourceItems or the old user-selected folder.
	if err := tx.Delete(&target).Error; err != nil {
		return err
	}
	// A cancelled first Source should not leave an orphaned device group
	// that then blocks creation of another Source on the same device. Only
	// prune the group if it is empty and has no user-facing references.
	if target.ParentID != nil {
		var group meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
				*target.ParentID, source.OwnerID, meta.NodeTypeDir).
			Take(&group).Error; err != nil {
			return err
		}
		// Flat managed Push targets have no per-device ancestor to prune.
		// The fixed Push namespace must survive even the last draft deletion.
		if group.Name == "Push" {
			return nil
		}
		var childCount int64
		if err := tx.Model(&meta.Node{}).Where("parent_id = ?", group.ID).Count(&childCount).Error; err != nil {
			return err
		}
		if childCount == 0 {
			refs := []guard{
				{&meta.Source{}, "target_node_id = ? AND id <> ?", []any{group.ID, source.ID}},
				{&meta.Share{}, "node_id = ?", []any{group.ID}},
				{&meta.UploadSession{}, "parent_id = ? OR node_id = ? OR result_node_id = ?", []any{group.ID, group.ID, group.ID}},
				{&meta.FileQuickAccess{}, "node_id = ?", []any{group.ID}},
				{&meta.FileFavorite{}, "node_id = ?", []any{group.ID}},
				{&meta.FileRecentAccess{}, "node_id = ?", []any{group.ID}},
				{&meta.FileOperation{}, "parent_id = ?", []any{group.ID}},
			}
			pinned := false
			for _, ref := range refs {
				if !tx.Migrator().HasTable(ref.model) {
					continue
				}
				var count int64
				if err := tx.Model(ref.model).Where(ref.predicate, ref.args...).Limit(1).Count(&count).Error; err != nil {
					return err
				}
				if count != 0 {
					pinned = true
					break
				}
			}
			if !pinned {
				if err := tx.Delete(&group).Error; err != nil {
					return err
				}
			}
		}
	}
	return nil
}
