package api

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	clipboardRetention = 24 * time.Hour
	clipboardPageSize  = 50
	clipboardMaxText   = 64 << 10
	clipboardMaxWire   = 128 << 10
)

var errClipboardInvalid = errors.New("invalid encrypted clipboard payload")

type clipboardWriteRequest struct {
	ClientEventID string `json:"client_event_id"`
	Kind          string `json:"kind"`
	Nonce         string `json:"nonce"`
	Ciphertext    string `json:"ciphertext"`
}

type clipboardItemResponse struct {
	ID            uint64    `json:"id"`
	ClientEventID string    `json:"client_event_id"`
	Kind          string    `json:"kind"`
	Nonce         string    `json:"nonce"`
	Ciphertext    string    `json:"ciphertext"`
	CreatedAt     time.Time `json:"created_at"`
	ExpiresAt     time.Time `json:"expires_at"`
}

func clipboardItemDTO(item meta.ClipboardItem) clipboardItemResponse {
	return clipboardItemResponse{
		ID: item.ID, ClientEventID: item.ClientEventID, Kind: item.Kind,
		Nonce: item.Nonce, Ciphertext: item.Ciphertext,
		CreatedAt: item.CreatedAt, ExpiresAt: item.ExpiresAt,
	}
}

func validateClipboardWrite(req clipboardWriteRequest) error {
	if uuid.Validate(req.ClientEventID) != nil {
		return errClipboardInvalid
	}
	if req.Kind != "text/plain" && req.Kind != "text/uri-list" {
		return errClipboardInvalid
	}
	nonce, err := base64.StdEncoding.Strict().DecodeString(req.Nonce)
	if err != nil || len(nonce) != 12 {
		return errClipboardInvalid
	}
	if len(req.Ciphertext) == 0 || len(req.Ciphertext) > base64.StdEncoding.EncodedLen(clipboardMaxText+16) {
		return errClipboardInvalid
	}
	data, err := base64.StdEncoding.Strict().DecodeString(req.Ciphertext)
	if err != nil || len(data) < 17 || len(data) > clipboardMaxText+16 {
		return errClipboardInvalid
	}
	return nil
}

func (s *Server) clipboardVault(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	uid := userID(c)
	if uid == 0 { c.AbortWithStatus(http.StatusUnauthorized); return }
	var vault meta.ClipboardVault
	err := s.DB.WithContext(c.Request.Context()).Where("owner_id = ?", uid).First(&vault).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		salt := make([]byte, 16)
		if _, err := io.ReadFull(rand.Reader, salt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "clipboard vault unavailable"})
			return
		}
		proposed := meta.ClipboardVault{OwnerID: uid, Salt: base64.StdEncoding.EncodeToString(salt)}
		if err := s.DB.WithContext(c.Request.Context()).
			Clauses(clause.OnConflict{DoNothing: true}).Create(&proposed).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "clipboard vault unavailable"})
			return
		}
		err = s.DB.WithContext(c.Request.Context()).Where("owner_id = ?", uid).First(&vault).Error
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "clipboard vault unavailable"})
		return
	}
	c.JSON(http.StatusOK, clipboardVaultDTO(vault))
}


func clipboardVaultDTO(vault meta.ClipboardVault) gin.H {
	return gin.H{
		"salt": vault.Salt, "kdf": "PBKDF2-SHA256", "iterations": 310000,
		"check_nonce": vault.CheckNonce, "check_ciphertext": vault.CheckCiphertext,
	}
}

// First Browser sets an encrypted canary once; later Browsers must locally
// verify the same passphrase before they can write new encrypted messages.
func (s *Server) putClipboardVaultCheck(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	uid := userID(c)
	if uid == 0 { c.AbortWithStatus(http.StatusUnauthorized); return }
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
	var req struct {
		Nonce string `json:"nonce"`
		Ciphertext string `json:"ciphertext"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid vault check"}); return
	}
	if len(req.Ciphertext) > 256 || validateClipboardWrite(clipboardWriteRequest{
		ClientEventID: "00000000-0000-4000-8000-000000000001",
		Kind: "text/plain", Nonce: req.Nonce, Ciphertext: req.Ciphertext,
	}) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid vault check"}); return
	}
	res := s.DB.WithContext(c.Request.Context()).Model(&meta.ClipboardVault{}).
		Where("owner_id = ? AND check_ciphertext = ''", uid).
		Updates(map[string]interface{}{"check_nonce": req.Nonce, "check_ciphertext": req.Ciphertext})
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "clipboard vault unavailable"}); return
	}
	var accepted meta.ClipboardVault
	if err := s.DB.WithContext(c.Request.Context()).
		Where("owner_id = ?", uid).First(&accepted).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "clipboard vault not initialized"}); return
	}
	c.JSON(http.StatusOK, clipboardVaultDTO(accepted))
}

func clipboardSameItem(existing meta.ClipboardItem, request clipboardWriteRequest) bool {
	return existing.Kind == request.Kind &&
		existing.Nonce == request.Nonce &&
		existing.Ciphertext == request.Ciphertext
}

func (s *Server) createClipboardItem(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	uid := userID(c)
	if uid == 0 { c.AbortWithStatus(http.StatusUnauthorized); return }
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, clipboardMaxWire)
	var req clipboardWriteRequest
	if err := c.ShouldBindJSON(&req); err != nil || validateClipboardWrite(req) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid encrypted clipboard item"})
		return
	}
	db := s.DB.WithContext(c.Request.Context())
	var existing meta.ClipboardItem
	if err := db.Where("owner_id = ? AND client_event_id = ?", uid, req.ClientEventID).
		First(&existing).Error; err == nil {
		if !clipboardSameItem(existing, req) {
			c.JSON(http.StatusConflict, gin.H{"error": "clipboard event ID conflict"})
			return
		}
		c.JSON(http.StatusOK, clipboardItemDTO(existing))
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "clipboard store unavailable"})
		return
	}
	now := time.Now().UTC()
	item := meta.ClipboardItem{
		OwnerID: uid, ClientEventID: req.ClientEventID, Kind: req.Kind,
		Nonce: req.Nonce, Ciphertext: req.Ciphertext,
		CreatedAt: now, ExpiresAt: now.Add(clipboardRetention),
	}
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&item).Error; err != nil { return err }
		// Retain only the 50 newest live items from this Owner. This is a
		// metadata-only mailbox and must not touch Nodes, uploads or CAS.
		return tx.Exec(`
DELETE FROM xd_clipboard_items
WHERE owner_id = ?
  AND (expires_at <= ?
       OR id NOT IN (
         SELECT id FROM (
           SELECT id FROM xd_clipboard_items
           WHERE owner_id = ? AND expires_at > ?
           ORDER BY id DESC LIMIT ?
         ) AS recent
       ))`,
			uid, now, uid, now, clipboardPageSize).Error
	})
	if err != nil {
		// A concurrent retry may have inserted the same EventID. Return only
		// an EXACT same-content receipt; never silently accept conflicting data.
		if lookupErr := db.Where("owner_id = ? AND client_event_id = ?", uid, req.ClientEventID).
			First(&existing).Error; lookupErr == nil {
			if clipboardSameItem(existing, req) {
				c.JSON(http.StatusOK, clipboardItemDTO(existing))
			} else {
				c.JSON(http.StatusConflict, gin.H{"error": "clipboard event ID conflict"})
			}
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "clipboard store unavailable"})
		return
	}
	c.JSON(http.StatusCreated, clipboardItemDTO(item))
}

func (s *Server) listClipboardItems(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	uid := userID(c)
	if uid == 0 { c.AbortWithStatus(http.StatusUnauthorized); return }
	var before uint64
	if raw := c.Query("before"); raw != "" {
		value, err := strconv.ParseUint(raw, 10, 64)
		if err != nil || value == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid clipboard cursor"})
			return
		}
		before = value
	}
	db := s.DB.WithContext(c.Request.Context()).
		Where("owner_id = ? AND expires_at > ?", uid, time.Now().UTC())
	if before > 0 { db = db.Where("id < ?", before) }
	var items []meta.ClipboardItem
	if err := db.Order("id DESC").Limit(clipboardPageSize+1).Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "clipboard store unavailable"})
		return
	}
	hasMore := len(items) > clipboardPageSize
	if hasMore { items = items[:clipboardPageSize] }
	result := make([]clipboardItemResponse, 0, len(items))
	for _, item := range items { result = append(result, clipboardItemDTO(item)) }
	var next *uint64
	if hasMore && len(items) > 0 { last := items[len(items)-1].ID; next = &last }
	c.JSON(http.StatusOK, gin.H{"items": result, "next_before": next})
}

func (s *Server) deleteClipboardItem(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	uid := userID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if uid == 0 { c.AbortWithStatus(http.StatusUnauthorized); return }
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid clipboard item ID"})
		return
	}
	res := s.DB.WithContext(c.Request.Context()).
		Where("owner_id = ? AND id = ?", uid, id).Delete(&meta.ClipboardItem{})
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "clipboard store unavailable"})
		return
	}
	if res.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "clipboard item not found"})
		return
	}
	c.Status(http.StatusNoContent)
}

func (s *Server) clearClipboardItems(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	uid := userID(c)
	if uid == 0 { c.AbortWithStatus(http.StatusUnauthorized); return }
	if err := s.DB.WithContext(c.Request.Context()).Where("owner_id = ?", uid).
		Delete(&meta.ClipboardItem{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "clipboard store unavailable"})
		return
	}
	c.Status(http.StatusNoContent)
}
