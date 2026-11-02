package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	notesSystemDirectory = "@xDrive"
	notesRootDirectory = "@备忘录"
	notesIOSDirectory = "iOS备份"
	notesMineDirectory = "我的备忘录"
)

var (
	errNotesManagedPath = errors.New("notes managed directory must be changed through notes API")
	errNotesPathConflict = errors.New("notes managed path already occupied")
	errNotesNamespaceCorrupt = errors.New("notes namespace binding is unavailable or inconsistent")
)

type notesNamespaceDTO struct {
	SystemNodeID uint64 `json:"system_node_id"`
	NotesNodeID uint64 `json:"notes_node_id"`
	IOSNodeID uint64 `json:"ios_backup_node_id"`
	MineNodeID uint64 `json:"my_notes_node_id"`
}

func notesNamespaceView(n meta.NotesNamespace) notesNamespaceDTO {
	return notesNamespaceDTO{SystemNodeID:n.SystemNodeID,
		NotesNodeID:n.NotesNodeID, IOSNodeID:n.IOSNodeID,
		MineNodeID:n.MineNodeID}
}

func notesNodeMatchesTx(ctx context.Context, tx *gorm.DB, uid, id, parent uint64, name string) error {
	var n meta.Node
	if err := tx.WithContext(ctx).Where(
		"id = ? AND owner_id = ? AND parent_id = ? AND deleted_at IS NULL",
		id, uid, parent,
	).First(&n).Error; err != nil { return errNotesNamespaceCorrupt }
	if n.Type != meta.NodeTypeDir || n.Name != name { return errNotesNamespaceCorrupt }
	return nil
}

func notesExistingNamespaceTx(ctx context.Context, tx *gorm.DB, uid uint64) (meta.NotesNamespace, bool, error) {
	var saved meta.NotesNamespace
	err := tx.WithContext(ctx).Where("owner_id = ?", uid).Take(&saved).Error
	if errors.Is(err, gorm.ErrRecordNotFound) { return meta.NotesNamespace{}, false, nil }
	if err != nil { return meta.NotesNamespace{}, false, err }
	var system meta.Node
	if err := tx.WithContext(ctx).Where(
		"id = ? AND owner_id = ? AND deleted_at IS NULL", saved.SystemNodeID, uid,
	).Take(&system).Error; err != nil { return saved, false, errNotesNamespaceCorrupt }
	if system.ParentID == nil || system.Name != notesSystemDirectory ||
		system.Type != meta.NodeTypeDir { return saved, false, errNotesNamespaceCorrupt }
	var root meta.Node
	if err := tx.WithContext(ctx).Where(
		"id = ? AND owner_id = ? AND parent_id IS NULL AND deleted_at IS NULL",
		*system.ParentID, uid,
	).Take(&root).Error; err != nil { return saved, false, errNotesNamespaceCorrupt }
	if err := notesNodeMatchesTx(ctx, tx, uid, saved.NotesNodeID, saved.SystemNodeID, notesRootDirectory); err != nil { return saved, false, err }
	if err := notesNodeMatchesTx(ctx, tx, uid, saved.IOSNodeID, saved.NotesNodeID, notesIOSDirectory); err != nil { return saved, false, err }
	if err := notesNodeMatchesTx(ctx, tx, uid, saved.MineNodeID, saved.NotesNodeID, notesMineDirectory); err != nil { return saved, false, err }
	return saved, true, nil
}

// POST is deliberate: first use is the only place where the notes directory
// tree is created. GET /nodes remains a side-effect-free Files operation.
// Existing user content at /@xDrive/@备忘录 is never silently claimed.
func (s *Server) initializeNotesNamespace(c *gin.Context) {
	uid := userID(c)
	if uid == 0 { fail(c, http.StatusUnauthorized, "owner required"); return }
	var ns meta.NotesNamespace
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var root meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(
			"owner_id = ? AND parent_id IS NULL AND type = ? AND deleted_at IS NULL",
			uid, meta.NodeTypeDir,
		).Take(&root).Error; err != nil { return err }
		existing, exists, err := notesExistingNamespaceTx(c.Request.Context(), tx, uid)
		if err != nil { return err }
		if exists { ns = existing; return nil }
		var system meta.Node
		err = tx.Where("owner_id = ? AND parent_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL",
			uid, root.ID, notesSystemDirectory).Take(&system).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			system = meta.Node{OwnerID:uid, ParentID:&root.ID,
				Name:notesSystemDirectory, Type:meta.NodeTypeDir, Revision:1}
			if err := tx.Create(&system).Error; err != nil { return err }
		} else if err != nil { return err }
		if system.Type != meta.NodeTypeDir { return errNotesPathConflict }
		// A pre-existing public share of the parent would expose future Notes.
		// Do not create an account-private namespace under an active share.
		var shared int64
		if err := tx.Model(&meta.Share{}).Where(
			"owner_id = ? AND node_id = ? AND revoked_at IS NULL",
			uid, system.ID,
		).Count(&shared).Error; err != nil { return err }
		if shared != 0 { return errNotesPathConflict }
		var occupied int64
		if err := tx.Model(&meta.Node{}).Where(
			"owner_id = ? AND parent_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL",
			uid, system.ID, notesRootDirectory).Count(&occupied).Error; err != nil { return err }
		if occupied != 0 { return errNotesPathConflict }
		noteRoot := meta.Node{OwnerID:uid, ParentID:&system.ID,
			Name:notesRootDirectory, Type:meta.NodeTypeDir, Revision:1}
		if err := tx.Create(&noteRoot).Error; err != nil { return err }
		iosRoot := meta.Node{OwnerID:uid, ParentID:&noteRoot.ID,
			Name:notesIOSDirectory, Type:meta.NodeTypeDir, Revision:1}
		if err := tx.Create(&iosRoot).Error; err != nil { return err }
		mineRoot := meta.Node{OwnerID:uid, ParentID:&noteRoot.ID,
			Name:notesMineDirectory, Type:meta.NodeTypeDir, Revision:1}
		if err := tx.Create(&mineRoot).Error; err != nil { return err }
		ns = meta.NotesNamespace{OwnerID:uid, SystemNodeID:system.ID,
			NotesNodeID:noteRoot.ID, IOSNodeID:iosRoot.ID, MineNodeID:mineRoot.ID}
		return tx.Create(&ns).Error
	})
	if err != nil {
		if errors.Is(err, errNotesPathConflict) { fail(c, http.StatusConflict, "notes path already exists; no existing content was adopted"); return }
		if errors.Is(err, errNotesNamespaceCorrupt) { fail(c, http.StatusConflict, "notes namespace is inconsistent; no data was changed"); return }
		fail(c, http.StatusInternalServerError, "initialize notes directory failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, notesNamespaceView(ns))
}

// Non-Notes endpoints must not modify a managed Notes subtree, including the
// system parent whose rename/delete would indirectly change the whole tree.
// File reads and downloads remain available through existing Owner APIs.
func notesProtectedNodeTx(ctx context.Context, tx *gorm.DB, uid, nodeID uint64) (bool, error) {
	if tx == nil || uid == 0 || nodeID == 0 { return false, nil }
	// Core-only test databases may intentionally omit optional feature tables.
	// Production startup migrates this table before accepting HTTP traffic.
	if !tx.Migrator().HasTable(&meta.NotesNamespace{}) { return false, nil }
	ns, exists, err := notesExistingNamespaceTx(ctx, tx, uid)
	if err != nil { return false, err }
	if !exists { return false, nil }
	if nodeID == ns.SystemNodeID || nodeID == ns.NotesNodeID ||
		nodeID == ns.IOSNodeID || nodeID == ns.MineNodeID {
		return true, nil
	}
	var inside bool
	if err := tx.WithContext(ctx).Raw(`
WITH RECURSIVE lineage AS (
  SELECT id, parent_id FROM xd_nodes
  WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
  UNION ALL
  SELECT parent.id, parent.parent_id
  FROM xd_nodes AS parent JOIN lineage ON parent.id = lineage.parent_id
  WHERE parent.owner_id = ? AND parent.deleted_at IS NULL
)
SELECT EXISTS(SELECT 1 FROM lineage WHERE id = ?)
`, nodeID, uid, uid, ns.NotesNodeID).Scan(&inside).Error; err != nil {
		return false, err
	}
	return inside, nil
}

func notesWritableParentTx(ctx context.Context, tx *gorm.DB, uid, parentID uint64) (bool, error) {
	if tx == nil || uid == 0 || parentID == 0 { return false, nil }
	if !tx.Migrator().HasTable(&meta.NotesNamespace{}) { return true, nil }
	ns, exists, err := notesExistingNamespaceTx(ctx, tx, uid)
	if err != nil { return false, err }
	if !exists { return true, nil }
	// Creating an unrelated sibling under /@xDrive remains permitted; the
	// managed structure itself may not be deleted or moved.
	if parentID == ns.SystemNodeID { return true, nil }
	protected, err := notesProtectedNodeTx(ctx, tx, uid, parentID)
	return !protected, err
}

func notesReservedNameTx(ctx context.Context, tx *gorm.DB, uid, parentID uint64, name string) (bool, error) {
	if tx == nil || uid == 0 || parentID == 0 { return false, nil }
	name = strings.TrimSpace(name)
	if !strings.EqualFold(name, notesSystemDirectory) &&
		!strings.EqualFold(name, notesRootDirectory) { return false, nil }
	var parent meta.Node
	if err := tx.WithContext(ctx).Where("id = ? AND owner_id = ? AND deleted_at IS NULL", parentID, uid).
		First(&parent).Error; err != nil { return false, err }
	if parent.ParentID == nil {
		return strings.EqualFold(name, notesSystemDirectory), nil
	}
	if parent.Name == notesSystemDirectory && strings.EqualFold(name, notesRootDirectory) {
		var root meta.Node
		if err := tx.WithContext(ctx).Where(
			"id = ? AND owner_id = ? AND parent_id IS NULL AND deleted_at IS NULL",
			*parent.ParentID, uid,
		).First(&root).Error; err == nil {
			return true, nil
		} else if errors.Is(err, gorm.ErrRecordNotFound) { return false, nil
		} else { return false, err }
	}
	return false, nil
}

func notesRejectDestination(c *gin.Context, tx *gorm.DB, parentID uint64, name string) bool {
	uid := userID(c)
	ok, err := notesWritableParentTx(c.Request.Context(), tx, uid, parentID)
	if err != nil { fail(c, http.StatusInternalServerError, "notes destination authorization failed"); return true }
	reserved, err := notesReservedNameTx(c.Request.Context(), tx, uid, parentID, name)
	if err != nil { fail(c, http.StatusInternalServerError, "notes reserved path check failed"); return true }
	if !ok || reserved { fail(c, http.StatusConflict, errNotesManagedPath.Error()); return true }
	return false
}

func notesRejectNodeMutation(c *gin.Context, tx *gorm.DB, nodeID uint64) bool {
	protected, err := notesProtectedNodeTx(c.Request.Context(), tx, userID(c), nodeID)
	if err != nil { fail(c, http.StatusInternalServerError, "notes node authorization failed"); return true }
	if protected { fail(c, http.StatusConflict, errNotesManagedPath.Error()); return true }
	return false
}

func notesRejectDestinationWithReason(ctx context.Context, tx *gorm.DB, uid, parentID uint64, name string) error {
	ok, err := notesWritableParentTx(ctx, tx, uid, parentID)
	if err != nil { return err }
	reserved, err := notesReservedNameTx(ctx, tx, uid, parentID, name)
	if err != nil { return err }
	if !ok || reserved { return errNotesManagedPath }
	return nil
}

func notesRejectNodeWithReason(ctx context.Context, tx *gorm.DB, uid, nodeID uint64) error {
	locked, err := notesProtectedNodeTx(ctx, tx, uid, nodeID)
	if err != nil { return fmt.Errorf("check managed notes: %w", err) }
	if locked { return errNotesManagedPath }
	return nil
}
