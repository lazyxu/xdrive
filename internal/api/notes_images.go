package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Note images live in actual Owner Files:
// /@xDrive/@备忘录/{我的备忘录,iOS备份}/_assets/<note-uuid>/<asset-uuid>.<ext>
// They are immutable so every Markdown FileVersion keeps its old images.
const notesMaxImageBytes = 20 << 20
const notesAssetsDirectory = "_assets"

var errNoteImageNotSupported = errors.New("unsupported note image")

func notesImageFormat(data []byte) (ext, contentType string, err error) {
	mime := http.DetectContentType(data)
	switch {
	case mime == "image/png" && bytes.HasPrefix(data, []byte{137, 80, 78, 71, 13, 10, 26, 10}):
		return "png", "image/png", nil
	case mime == "image/jpeg" && bytes.HasPrefix(data, []byte{0xff, 0xd8, 0xff}):
		return "jpg", "image/jpeg", nil
	case mime == "image/gif" && len(data) >= 6 &&
		(bytes.Equal(data[:6], []byte("GIF87a")) || bytes.Equal(data[:6], []byte("GIF89a"))):
		return "gif", "image/gif", nil
	case len(data) >= 12 && bytes.Equal(data[:4], []byte("RIFF")) &&
		bytes.Equal(data[8:12], []byte("WEBP")):
		return "webp", "image/webp", nil
	case len(data) >= 12 && bytes.Equal(data[4:8], []byte("ftyp")):
		brand := string(data[8:12])
		if brand == "heic" || brand == "heix" || brand == "hevc" || brand == "hevx" {
			return "heic", "image/heic", nil
		}
	}
	return "", "", errNoteImageNotSupported
}

func notesImageType(filename string) (string, bool) {
	chunks := strings.Split(filename, ".")
	if len(chunks) != 2 || uuid.Validate(chunks[0]) != nil {
		return "", false
	}
	switch chunks[1] {
	case "png":
		return "image/png", true
	case "jpg":
		return "image/jpeg", true
	case "gif":
		return "image/gif", true
	case "webp":
		return "image/webp", true
	case "heic":
		return "image/heic", true
	default: return "", false
	}
}

func (s *Server) uploadMyNoteImage(c *gin.Context) {
	s.uploadNoteImage(c, meta.NoteSourceMine)
}

func (s *Server) importIOSNoteImage(c *gin.Context) {
	s.uploadNoteImage(c, meta.NoteSourceIOS)
}

func (s *Server) uploadNoteImage(c *gin.Context, source string) {
	uid, id := userID(c), c.Param("id")
	if uuid.Validate(id) != nil {
		fail(c, http.StatusNotFound, "note not found")
		return
	}
	c.Request.Body = http.MaxBytesReader(
		c.Writer, c.Request.Body, notesMaxImageBytes+(2<<20))
	part, err := c.FormFile("image")
	if err != nil || part.Size <= 0 {
		fail(c, http.StatusBadRequest, "image is required")
		return
	}
	if part.Size > notesMaxImageBytes {
		fail(c, http.StatusRequestEntityTooLarge, "note image exceeds 20 MiB")
		return
	}
	opened, err := part.Open()
	if err != nil {
		fail(c, http.StatusBadRequest, "cannot read note image")
		return
	}
	defer opened.Close()
	data, err := io.ReadAll(io.LimitReader(opened, notesMaxImageBytes+1))
	if err != nil || len(data) > notesMaxImageBytes {
		fail(c, http.StatusRequestEntityTooLarge, "note image exceeds 20 MiB")
		return
	}
	ext, mime, err := notesImageFormat(data)
	if err != nil {
		fail(c, http.StatusUnsupportedMediaType, "only PNG/JPEG/GIF/WebP/HEIC are supported")
		return
	}
	if err := s.ensureStorageWriteCapacityWithReservations(
		c.Request.Context(), int64(len(data)), ""); err != nil {
		if !writeStorageCapacityError(c, err) {
			fail(c, http.StatusInternalServerError, "image capacity check failed")
		}
		return
	}
	hash := sha256.Sum256(data)
	digest := hex.EncodeToString(hash[:])
	casKey, _ := storage.ContentAddressedKey(digest)
	stagedKey := storageKey(uid, "@xDrive/@备忘录/_assets", uuid.NewString())
	written, err := s.Store.Put(c.Request.Context(), stagedKey, bytes.NewReader(data))
	if err != nil || written != int64(len(data)) {
		_ = s.Store.Delete(c.Request.Context(), stagedKey)
		fail(c, http.StatusInternalServerError, "stage image failed")
		return
	}
	committed := false
	defer func() {
		_ = s.Store.Delete(c.Request.Context(), stagedKey)
		if !committed {
			s.cleanupUncommittedContentBlob(c.Request.Context(), digest, casKey)
		}
	}()
	assetName := uuid.NewString() + "." + ext
	var asset meta.Node
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
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
		var note meta.Note
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ? AND source = ? AND deleted_at IS NULL",
				id, uid, source).First(&note).Error; err != nil {
			return errNoteNotFound
		}
		parentID := ns.MineNodeID
		if source == meta.NoteSourceIOS {
			parentID = ns.IOSNodeID
		}
		var noteNode meta.Node
		if err := tx.Where("id = ? AND owner_id = ? AND parent_id = ? AND name = ? AND deleted_at IS NULL",
			note.NodeID, uid, parentID, id+".md").First(&noteNode).Error; err != nil {
			return errNotesNamespaceCorrupt
		}
		assets, err := ensureOwnedChildDirectoryTx(
			c.Request.Context(), tx, uid, parentID, notesAssetsDirectory)
		if err != nil {
			return err
		}
		directory, err := ensureOwnedChildDirectoryTx(
			c.Request.Context(), tx, uid, assets.ID, id)
		if err != nil {
			return err
		}
		size := int64(len(data))
		if _, err := s.ensureQuotaForStorageKey(tx, uid, size, casKey, true); err != nil {
			return err
		}
		key, _, err := s.retainContentBlobTx(
			c.Request.Context(), tx, stagedKey, digest, size)
		if err != nil {
			return err
		}
		asset = meta.Node{OwnerID: uid, ParentID: &directory.ID,
			Name: assetName, Type: meta.NodeTypeFile, Revision: 1}
		if err := tx.Create(&asset).Error; err != nil {
			return err
		}
		return tx.Create(&meta.File{
			NodeID: asset.ID, Size: size, SHA256: digest, StorageKey: key,
		}).Error
	})
	if err != nil {
		noteWriteError(c, err)
		return
	}
	committed = true
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusCreated, gin.H{
		"node_id": asset.ID,
		"filename": assetName,
		"relative_path": notesAssetsDirectory + "/" + id + "/" + assetName,
		"content_type": mime,
		"sha256": digest,
		"bytes": len(data),
	})
}

func (s *Server) readNoteImage(c *gin.Context) {
	uid, id, filename := userID(c), c.Param("id"), c.Param("asset")
	mime, ok := notesImageType(filename)
	if !ok {
		fail(c, http.StatusNotFound, "image not found")
		return
	}
	note, node, err := s.loadOwnedNote(uid, id)
	if err != nil {
		fail(c, http.StatusNotFound, "note not found")
		return
	}
	parentID := *node.ParentID
	if note.Source != meta.NoteSourceMine && note.Source != meta.NoteSourceIOS {
		fail(c, http.StatusNotFound, "note not found")
		return
	}
	var assets, directory, asset meta.Node
	err = s.DB.WithContext(c.Request.Context()).Where(
		"owner_id = ? AND parent_id = ? AND name = ? AND type = ? AND deleted_at IS NULL",
		uid, parentID, notesAssetsDirectory, meta.NodeTypeDir,
	).First(&assets).Error
	if err != nil {
		fail(c, http.StatusNotFound, "image not found")
		return
	}
	if err := s.DB.Where(
		"owner_id = ? AND parent_id = ? AND name = ? AND type = ? AND deleted_at IS NULL",
		uid, assets.ID, id, meta.NodeTypeDir,
	).First(&directory).Error; err != nil {
		fail(c, http.StatusNotFound, "image not found")
		return
	}
	if err := s.DB.Preload("File").Where(
		"owner_id = ? AND parent_id = ? AND name = ? AND type = ? AND deleted_at IS NULL",
		uid, directory.ID, filename, meta.NodeTypeFile,
	).First(&asset).Error; err != nil || asset.File == nil ||
		asset.File.Size <= 0 || asset.File.Size > notesMaxImageBytes {
		fail(c, http.StatusNotFound, "image not found")
		return
	}
	f, err := s.Store.Open(c.Request.Context(), asset.File.StorageKey)
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "stored image unavailable")
		return
	}
	defer f.Close()
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cross-Origin-Resource-Policy", "same-origin")
	c.Header("Content-Type", mime)
	c.Header("Content-Disposition", fmt.Sprintf("inline; filename=%q", filename))
	c.Header("ETag", fmt.Sprintf("%q", asset.File.SHA256))
	http.ServeContent(c.Writer, c.Request, filename, time.Time{}, f)
}
