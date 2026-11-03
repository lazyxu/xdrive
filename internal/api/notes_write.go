package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type notesStagedMarkdown struct {
	key    string
	hash   string
	casKey string
	size   int64
}

func (s *Server) stageNoteMarkdown(ctx context.Context, uid uint64, markdown string) (notesStagedMarkdown, error) {
	data := []byte(markdown)
	size := int64(len(data))
	if err := s.ensureStorageWriteCapacityWithReservations(ctx, size, ""); err != nil {
		return notesStagedMarkdown{}, err
	}
	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])
	casKey, err := storage.ContentAddressedKey(hash)
	if err != nil {
		return notesStagedMarkdown{}, err
	}
	key := storageKey(uid, "@xDrive/@备忘录", uuid.NewString())
	written, err := s.Store.Put(ctx, key, bytes.NewReader(data))
	if err != nil || written != size {
		_ = s.Store.Delete(ctx, key)
		if err != nil {
			return notesStagedMarkdown{}, err
		}
		return notesStagedMarkdown{}, errNoteInvalidContent
	}
	return notesStagedMarkdown{key: key, hash: hash, casKey: casKey, size: size}, nil
}

func (s *Server) releaseNoteStage(ctx context.Context, blob notesStagedMarkdown, committed bool) {
	if blob.key == "" {
		return
	}
	_ = s.Store.Delete(ctx, blob.key)
	if !committed {
		s.cleanupUncommittedContentBlob(ctx, blob.hash, blob.casKey)
	}
}

func (s *Server) createMyNote(c *gin.Context) { s.saveNote(c, meta.NoteSourceMine, "") }

func (s *Server) importIOSNote(c *gin.Context) { s.saveNote(c, meta.NoteSourceIOS, "") }

func (s *Server) updateMyNote(c *gin.Context) { s.saveNote(c, meta.NoteSourceMine, c.Param("id")) }

// Native Shortcuts is a caller of this Owner endpoint, not a Notes database
// reader. A stable external_id is required to update a previous iOS snapshot;
// without one, every explicit import remains a distinct note.
func (s *Server) saveNote(c *gin.Context, source, requestedID string) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, notesMaximumMarkdownBytes*6+8192)
	var req notesWriteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid Markdown note request")
		return
	}
	title, err := validateNoteWriteInput(req)
	if err != nil {
		noteWriteError(c, err)
		return
	}
	if source == meta.NoteSourceMine && req.ExternalID != "" {
		fail(c, http.StatusBadRequest, "external_id is reserved for iOS imports")
		return
	}
	if requestedID != "" && uuid.Validate(requestedID) != nil {
		fail(c, http.StatusNotFound, "note not found")
		return
	}
	if requestedID != "" && req.ExpectedRevision == 0 {
		fail(c, http.StatusBadRequest, "expected_revision is required")
		return
	}
	uid := userID(c)
	staged, err := s.stageNoteMarkdown(c.Request.Context(), uid, req.Markdown)
	if err != nil {
		noteWriteError(c, err)
		return
	}
	committed := false
	defer func() { s.releaseNoteStage(c.Request.Context(), staged, committed) }()

	var saved meta.Note
	var currentNode meta.Node
	var created bool
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		// Serialize account writes and namespace initialization, which locks
		// this same Owner root before creating managed folders.
		var owner meta.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND disabled_at IS NULL", uid).First(&owner).Error; err != nil {
			return errNoteNotFound
		}
		ns, exists, err := notesExistingNamespaceTx(c.Request.Context(), tx, uid)
		if err != nil {
			return err
		}
		if !exists {
			return errNoteNamespaceMissing
		}
		parentID := ns.MineNodeID
		if source == meta.NoteSourceIOS {
			parentID = ns.IOSNodeID
		}
		var note meta.Note
		lookup := tx.Where("owner_id = ? AND deleted_at IS NULL", uid)
		found := false
		if requestedID != "" {
			err = lookup.Where("id = ?", requestedID).First(&note).Error
			if err != nil {
				return errNoteNotFound
			}
			if note.Source != source {
				return errNoteSourceReadOnly
			}
			found = true
		} else if source == meta.NoteSourceIOS && req.ExternalID != "" {
			err = lookup.Where("source = ? AND external_id = ?", source, req.ExternalID).First(&note).Error
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			found = err == nil
		}
		now := time.Now().UTC()
		if !found {
			if requestedID != "" {
				return errNoteNotFound
			}
			if _, err := s.ensureQuotaForStorageKey(tx, uid, staged.size, staged.casKey, true); err != nil {
				return err
			}
			key, _, err := s.retainContentBlobTx(
				c.Request.Context(), tx, staged.key, staged.hash, staged.size)
			if err != nil {
				return err
			}
			note = meta.Note{
				ID: uuid.NewString(), OwnerID: uid, Source: source,
				Title: title, SearchText: req.Markdown,
				CreatedAt: now, UpdatedAt: now,
			}
			if source == meta.NoteSourceIOS && req.ExternalID != "" {
				external := req.ExternalID
				note.ExternalID = &external
			}
			node := meta.Node{
				OwnerID: uid, ParentID: &parentID,
				Name: note.ID + ".md", Type: meta.NodeTypeFile, Revision: 1,
			}
			if err := tx.Create(&node).Error; err != nil {
				return err
			}
			if err := tx.Create(&meta.File{
				NodeID: node.ID, Size: staged.size,
				StorageKey: key, SHA256: staged.hash,
			}).Error; err != nil { return err }
			note.NodeID = node.ID
			if err := tx.Create(&note).Error; err != nil {
				return err
			}
			currentNode = node
			currentNode.File = &meta.File{
				NodeID: node.ID, Size: staged.size,
				StorageKey: key, SHA256: staged.hash,
			}
			saved = note
			created = true
			return nil
		}

		// The Note ID and actual Node, Owner, source, and exact parent must
		// all agree; a forged/stale client cannot update an arbitrary file.
		var node meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Preload("File").
			Where("owner_id = ? AND id = ? AND deleted_at IS NULL", uid, note.NodeID).
			First(&node).Error; err != nil { return errNoteNotFound }
		if node.ParentID == nil || *node.ParentID != parentID ||
			node.Name != note.ID + ".md" || node.Type != meta.NodeTypeFile ||
			node.File == nil { return errNotesNamespaceCorrupt }
		if requestedID != "" && node.Revision != req.ExpectedRevision {
			return errNoteRevisionConflict
		}
		if node.File.SHA256 == staged.hash && note.Title == title {
			currentNode = node
			saved = note
			return nil
		}
		if node.File.SHA256 != staged.hash {
			if _, err := s.ensureQuotaForStorageKey(tx, uid, staged.size, staged.casKey, true); err != nil {
				return err
			}
			key, _, err := s.retainContentBlobTx(
				c.Request.Context(), tx, staged.key, staged.hash, staged.size)
			if err != nil {
				return err
			}
			if err := tx.Create(&meta.FileVersion{
				NodeID: node.ID, Revision: node.Revision, Size: node.File.Size,
				StorageKey: node.File.StorageKey, SHA256: node.File.SHA256,
				CreatedAt: now,
			}).Error; err != nil { return err }
			if err := tx.Model(&meta.File{}).Where("node_id = ?", node.ID).
				Updates(map[string]any{
					"size": staged.size, "storage_key": key,
					"sha256": staged.hash, "updated_at": now,
				}).Error; err != nil { return err }
			node.File = &meta.File{
				NodeID: node.ID, Size: staged.size, StorageKey: key, SHA256: staged.hash,
			}
		}
		result := tx.Model(&meta.Node{}).Where(
			"id = ? AND owner_id = ? AND revision = ? AND deleted_at IS NULL",
			node.ID, uid, node.Revision,
		).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errNoteRevisionConflict
		}
		if err := tx.Model(&meta.Note{}).
			Where("id = ? AND owner_id = ? AND source = ? AND deleted_at IS NULL", note.ID, uid, source).
			Updates(map[string]any{"title": title, "search_text": req.Markdown, "updated_at": now}).Error; err != nil { return err }
		note.Title = title
		note.UpdatedAt = now
		node.Revision++
		node.UpdatedAt = now
		currentNode = node
		saved = note
		return nil
	})
	if err != nil {
		noteWriteError(c, err)
		return
	}
	committed = true
	dto := noteSummary(saved, currentNode)
	// The authoritative Markdown remains stored in the File/CAS node.
	// A missing/uncertain CAS ACK never creates a second Note in this handler.
	c.Header("Cache-Control", "no-store")
	if created {
		c.JSON(http.StatusCreated, dto)
	} else {
		c.JSON(http.StatusOK, dto)
	}
}

func (s *Server) deleteMyNote(c *gin.Context) {
	uid := userID(c)
	id := c.Param("id")
	if uuid.Validate(id) != nil {
		fail(c, http.StatusNotFound, "note not found")
		return
	}
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var note meta.Note
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ? AND deleted_at IS NULL", id, uid).
			First(&note).Error; err != nil { return errNoteNotFound }
		if note.Source != meta.NoteSourceMine {
			return errNoteSourceReadOnly
		}
		ns, exists, err := notesExistingNamespaceTx(c.Request.Context(), tx, uid)
		if err != nil {
			return err
		}
		if !exists {
			return errNoteNamespaceMissing
		}
		var node meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ? AND parent_id = ? AND name = ? AND deleted_at IS NULL",
				note.NodeID, uid, ns.MineNodeID, note.ID+".md").
			First(&node).Error; err != nil { return errNoteNotFound }
		if node.Revision != expected {
			return errNoteRevisionConflict
		}
		now := time.Now().UTC()
		// Pictures are immutable while a note is active, so historical
		// FileVersions may reference them. Soft-delete the matching asset
		// subtree in the same transaction as the Markdown Node; its CAS
		// references survive until ordinary trash retention/cleanup.
		var imageRoot meta.Node
		err = tx.Where("owner_id = ? AND parent_id = ? AND name = ? AND type = ? AND deleted_at IS NULL",
			uid, ns.MineNodeID, notesAssetsDirectory, meta.NodeTypeDir).
			First(&imageRoot).Error
		if err == nil {
			var ownedImages meta.Node
			err = tx.Where("owner_id = ? AND parent_id = ? AND name = ? AND type = ? AND deleted_at IS NULL",
				uid, imageRoot.ID, id, meta.NodeTypeDir).
				First(&ownedImages).Error
			if err == nil {
				ids, subtreeErr := activeSubtreeIDsDB(tx, uid, ownedImages.ID)
				if subtreeErr != nil {
					return subtreeErr
				}
				arg := any(ids)
				predicate := "id IN ?"
				if len(ids) > 32000 {
					literal, arrayErr := fileOperationDeleteIDArrayLiteral(ids)
					if arrayErr != nil {
						return arrayErr
					}
					arg = literal
					predicate = "id = ANY(CAST(? AS bigint[]))"
				}
				if err := tx.Model(&meta.Node{}).Where(
					predicate+" AND owner_id = ? AND deleted_at IS NULL", arg, uid,
				).Updates(map[string]any{
					"deleted_at": &now, "trash_root_id": ownedImages.ID, "updated_at": now,
				}).Error; err != nil {
					return err
				}
			} else if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err := tx.Model(&meta.Note{}).
			Where("id = ? AND owner_id = ? AND deleted_at IS NULL", id, uid).
			Update("deleted_at", &now).Error; err != nil { return err }
		return tx.Model(&meta.Node{}).
			Where("id = ? AND owner_id = ? AND revision = ?", node.ID, uid, expected).
			Updates(map[string]any{
				"deleted_at": &now, "trash_root_id": node.ID,
				"revision": gorm.Expr("revision + 1"), "updated_at": now,
			}).Error
	})
	if err != nil {
		noteWriteError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

