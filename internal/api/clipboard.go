package api

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
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
	clipboardChangeCap = 256
)

var errClipboardInvalid = errors.New("invalid encrypted clipboard payload")
var errClipboardVaultNotReady = errors.New("clipboard vault has no encrypted verifier")
var errClipboardForbidden = errors.New("clipboard target forbidden")

type clipboardWriteRequest struct {
	ClientEventID  string `json:"client_event_id"`
	Kind           string `json:"kind"`
	Nonce          string `json:"nonce"`
	Ciphertext     string `json:"ciphertext"`
	TargetDeviceID string `json:"target_device_id,omitempty"`
	EphemeralKey   string `json:"ephemeral_key,omitempty"`
	WrappedKey     string `json:"wrapped_key,omitempty"`
	NodeID         uint64 `json:"node_id,omitempty"`
}

type clipboardItemResponse struct {
	ID             uint64    `json:"id"`
	ClientEventID  string    `json:"client_event_id"`
	Kind           string    `json:"kind"`
	Nonce          string    `json:"nonce"`
	Ciphertext     string    `json:"ciphertext"`
	TargetDeviceID string    `json:"target_device_id,omitempty"`
	EphemeralKey   string    `json:"ephemeral_key,omitempty"`
	WrappedKey     string    `json:"wrapped_key,omitempty"`
	NodeID         uint64    `json:"node_id,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
	ExpiresAt      time.Time `json:"expires_at"`
}

func clipboardItemDTO(item meta.ClipboardItem) clipboardItemResponse {
	var nodeID uint64
	if item.NodeID != nil {
		nodeID = *item.NodeID
	}
	return clipboardItemResponse{
		ID: item.ID, ClientEventID: item.ClientEventID, Kind: item.Kind,
		Nonce: item.Nonce, Ciphertext: item.Ciphertext,
		TargetDeviceID: item.TargetDeviceID, EphemeralKey: item.EphemeralKey,
		WrappedKey: item.WrappedKey, NodeID: nodeID,
		CreatedAt: item.CreatedAt, ExpiresAt: item.ExpiresAt,
	}
}

func validateClipboardWrite(req clipboardWriteRequest) error {
	if uuid.Validate(req.ClientEventID) != nil {
		return errClipboardInvalid
	}
	switch req.Kind {
	case "text/plain", "text/uri-list":
		if req.NodeID != 0 {
			return errClipboardInvalid
		}
	case "image/x-xdrive-node-ref", "application/x-xdrive-node-ref":
		if req.NodeID == 0 || req.TargetDeviceID == "" {
			return errClipboardInvalid
		}
	default:
		return errClipboardInvalid
	}
	if req.TargetDeviceID == "" {
		if req.EphemeralKey != "" || req.WrappedKey != "" {
			return errClipboardInvalid
		}
	} else {
		id, err := uuid.Parse(req.TargetDeviceID)
		if err != nil || id.String() != req.TargetDeviceID {
			return errClipboardInvalid
		}
		pub, e1 := base64.StdEncoding.Strict().DecodeString(req.EphemeralKey)
		wrapped, e2 := base64.StdEncoding.Strict().DecodeString(req.WrappedKey)
		if e1 != nil || e2 != nil || len(pub) != 32 || len(wrapped) != 60 {
			return errClipboardInvalid
		}
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
	if uid == 0 {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
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
		"salt": vault.Salt, "owner_id": vault.OwnerID, "kdf": "PBKDF2-SHA256", "iterations": 310000,
		"check_nonce": vault.CheckNonce, "check_ciphertext": vault.CheckCiphertext,
		"aad_scope": vault.AADScope,
	}
}

// The v1 AAD includes the first Browser origin and its authenticated Owner ID.
// Pin that original scope once so another public/LAN URL can reuse the same
// passphrase and history. It is metadata, never an authorization capability.
func clipboardValidAADScope(scope string, ownerID uint64) bool {
	if ownerID == 0 || len(scope) > 512 {
		return false
	}
	suffix := ":" + strconv.FormatUint(ownerID, 10)
	if !strings.HasSuffix(scope, suffix) {
		return false
	}
	origin := strings.TrimSuffix(scope, suffix)
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") ||
		u.Host == "" || u.Hostname() == "" || u.Opaque != "" || u.User != nil ||
		u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return false
	}
	return u.Scheme+"://"+u.Host == origin
}

// First Browser sets an encrypted canary once; later Browsers must locally
// verify the same passphrase before they can write new encrypted messages.
func (s *Server) putClipboardVaultCheck(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	uid := userID(c)
	if uid == 0 {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
	var req struct {
		Nonce      string `json:"nonce"`
		Ciphertext string `json:"ciphertext"`
		Scope      string `json:"scope"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid vault check"})
		return
	}
	if !clipboardValidAADScope(req.Scope, uid) || len(req.Ciphertext) > 256 || validateClipboardWrite(clipboardWriteRequest{
		ClientEventID: "00000000-0000-4000-8000-000000000001",
		Kind:          "text/plain", Nonce: req.Nonce, Ciphertext: req.Ciphertext,
	}) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid vault check"})
		return
	}
	// The initial canary and its AAD scope are pinned atomically. An existing
	// legacy vault (created before AADScope was stored) can claim the missing
	// scope only with its original unchanged encrypted canary.
	db := s.DB.WithContext(c.Request.Context())
	res := db.Model(&meta.ClipboardVault{}).
		Where("owner_id = ? AND check_ciphertext = ''", uid).
		Updates(map[string]interface{}{"check_nonce": req.Nonce, "check_ciphertext": req.Ciphertext, "aad_scope": req.Scope})
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "clipboard vault unavailable"})
		return
	}
	if res.RowsAffected == 0 {
		res = db.Model(&meta.ClipboardVault{}).
			Where("owner_id = ? AND aad_scope = '' AND check_nonce = ? AND check_ciphertext = ?",
				uid, req.Nonce, req.Ciphertext).
			Update("aad_scope", req.Scope)
		if res.Error != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "clipboard vault unavailable"})
			return
		}
	}
	var accepted meta.ClipboardVault
	if err := db.Where("owner_id = ?", uid).First(&accepted).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "clipboard vault not initialized"})
		return
	}
	c.JSON(http.StatusOK, clipboardVaultDTO(accepted))
}

func clipboardNodeRefID(item meta.ClipboardItem) uint64 {
	if item.NodeID != nil {
		return *item.NodeID
	}
	return 0
}
func clipboardSameItem(existing meta.ClipboardItem, request clipboardWriteRequest) bool {
	return existing.Kind == request.Kind &&
		existing.Nonce == request.Nonce &&
		existing.Ciphertext == request.Ciphertext &&
		existing.TargetDeviceID == request.TargetDeviceID &&
		existing.EphemeralKey == request.EphemeralKey &&
		existing.WrappedKey == request.WrappedKey &&
		clipboardNodeRefID(existing) == request.NodeID
}

// appendClipboardChangeTx is called only while holding the Owner vault row
// lock, keeping multi-instance message and notification order consistent.
func appendClipboardChangeTx(tx *gorm.DB, ownerID uint64, kind string, targets ...string) error {
	var target string
	if len(targets) > 0 {
		target = targets[0]
	}
	if err := tx.Create(&meta.ClipboardChange{
		OwnerID: ownerID, Kind: kind, TargetDeviceID: target, CreatedAt: time.Now().UTC(),
	}).Error; err != nil {
		return err
	}
	return tx.Exec(`
DELETE FROM xd_clipboard_changes WHERE owner_id = ?
AND id NOT IN (SELECT id FROM (
    SELECT id FROM xd_clipboard_changes WHERE owner_id = ?
    ORDER BY id DESC LIMIT ?
) AS retained)`, ownerID, ownerID, clipboardChangeCap).Error
}

// An authenticated SSE connection transports ONLY change cursors. A disconnect,
// auth expiry or cursor eviction is repaired by a full Owner-scoped GET /items;
// no ciphertext, key, token or OS clipboard data enters an event.
func (s *Server) streamClipboardEvents(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("X-Accel-Buffering", "no")
	uid := userID(c)
	opening, admitted := currentUser(c)
	if uid == 0 || !admitted {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	// Only notify while the EXACT authenticated session remains live.
	// The stream has a 20-second lifetime, but account disable, password
	// reset or session-version revocation must stop the old Owner's events
	// at the next batch/tick, not wait for a reconnect.
	after := uint64(0)
	raw := c.Query("after")
	if raw == "" {
		raw = c.GetHeader("Last-Event-ID")
	}
	if raw != "" {
		value, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid clipboard event cursor"})
			return
		}
		after = value
	}
	deviceID, ok := s.clipboardVerifiedDevice(c, uid)
	if !ok {
		c.JSON(http.StatusForbidden, gin.H{"error": "invalid Clipboard device"})
		return
	}
	c.Header("Content-Type", "text/event-stream; charset=utf-8")
	c.Status(http.StatusOK)
	fmt.Fprint(c.Writer, "retry: 2000\nevent: sync\ndata: {}\n\n")
	c.Writer.Flush()
	ticker := time.NewTicker(1500 * time.Millisecond)
	defer ticker.Stop()
	// 20s max stream lifetime forces bearer re-authentication on reconnect.
	deadline := time.NewTimer(20 * time.Second)
	defer deadline.Stop()
	for {
		var current meta.User
		if err := s.DB.WithContext(c.Request.Context()).
			Select("session_version", "disabled_at", "must_change_password").
			Where("id = ?", uid).Take(&current).Error; err != nil ||
			current.DisabledAt != nil ||
			current.MustChangePassword ||
			current.SessionVersion != opening.SessionVersion {
			return
		}
		if deviceID != "" {
			id, stillAllowed := s.clipboardVerifiedDevice(c, uid)
			if !stillAllowed || id != deviceID {
				return
			}
		}
		var ids []uint64
		query := s.DB.WithContext(c.Request.Context()).Model(&meta.ClipboardChange{}).
			Where("owner_id = ? AND id > ?", uid, after)
		err := clipboardVisibleToDevice(query, deviceID).Order("id ASC").Limit(64).Pluck("id", &ids).Error
		if err != nil {
			return
		}
		// A revocation can commit after the first batch's device check and
		// before its SELECT completes. Never emit a directed cursor from
		// that stale authorization snapshot.
		if deviceID != "" && len(ids) > 0 {
			currentDevice, allowed := s.clipboardVerifiedDevice(c, uid)
			if !allowed || currentDevice != deviceID {
				return
			}
		}
		for _, id := range ids {
			if _, err := fmt.Fprintf(c.Writer, "id: %d\nevent: change\ndata: {}\n\n", id); err != nil {
				return
			}
			after = id
		}
		if len(ids) > 0 {
			c.Writer.Flush()
		}
		if len(ids) == 64 {
			continue
		}
		select {
		case <-c.Request.Context().Done():
			return
		case <-deadline.C:
			return
		case <-ticker.C:
			if _, err := fmt.Fprint(c.Writer, ": ping\n\n"); err != nil {
				return
			}
			c.Writer.Flush()
		}
	}
}

func (s *Server) createClipboardItem(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	uid := userID(c)
	if uid == 0 {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, clipboardMaxWire)
	var req clipboardWriteRequest
	if err := c.ShouldBindJSON(&req); err != nil || validateClipboardWrite(req) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid encrypted clipboard item"})
		return
	}
	db := s.DB.WithContext(c.Request.Context())
	if s.clipboardValidateTargetAndNode(db, uid, req) != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Clipboard destination unavailable"})
		return
	}
	var existing meta.ClipboardItem
	if err := db.Where("owner_id = ? AND client_event_id = ?", uid, req.ClientEventID).
		First(&existing).Error; err == nil {
		// A retained but expired item is invisible to GET /items. Returning
		// 200 for its EventID would falsely claim successful delivery.
		if !existing.ExpiresAt.After(time.Now().UTC()) {
			c.JSON(http.StatusConflict, gin.H{"error": "clipboard event expired; check history before retrying"})
			return
		}
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
		TargetDeviceID: req.TargetDeviceID, EphemeralKey: req.EphemeralKey, WrappedKey: req.WrappedKey,
		CreatedAt: now, ExpiresAt: now.Add(clipboardRetention),
	}
	if req.NodeID != 0 {
		item.NodeID = &req.NodeID
	}
	err := db.Transaction(func(tx *gorm.DB) error {
		// Lock the Owner vault to serialize inserts + 50-item pruning. Two
		// concurrent READ COMMITTED transactions otherwise can each retain
		// different sets of 50 records and exceed the retention cap.
		var vault meta.ClipboardVault
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("owner_id = ?", uid).First(&vault).Error; err != nil {
			return err
		}
		if vault.CheckCiphertext == "" {
			return errClipboardVaultNotReady
		}
		if err := s.clipboardValidateTargetAndNode(tx, uid, req); err != nil {
			return err
		}
		if err := tx.Create(&item).Error; err != nil {
			return err
		}
		// Retain only the 50 newest live items from this Owner. This is a
		// metadata-only mailbox and must not touch Nodes, uploads or CAS.
		if err := tx.Exec(`
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
			uid, now, uid, now, clipboardPageSize).Error; err != nil {
			return err
		}
		return appendClipboardChangeTx(tx, uid, "create", req.TargetDeviceID)
	})
	if err != nil {
		if errors.Is(err, errClipboardForbidden) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Clipboard destination unavailable"})
			return
		}
		if errors.Is(err, errClipboardVaultNotReady) || errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusConflict, gin.H{"error": "clipboard vault must be initialized before sending"})
			return
		}
		// A concurrent retry may have inserted the same EventID. Return only
		// an EXACT same-content receipt; never silently accept conflicting data.
		if lookupErr := db.Where("owner_id = ? AND client_event_id = ?", uid, req.ClientEventID).
			First(&existing).Error; lookupErr == nil {
			if !existing.ExpiresAt.After(time.Now().UTC()) {
				c.JSON(http.StatusConflict, gin.H{"error": "clipboard event expired; check history before retrying"})
				return
			}
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
	if uid == 0 {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	var before uint64
	if raw := c.Query("before"); raw != "" {
		value, err := strconv.ParseUint(raw, 10, 64)
		if err != nil || value == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid clipboard cursor"})
			return
		}
		before = value
	}
	deviceID, ok := s.clipboardVerifiedDevice(c, uid)
	if !ok {
		c.JSON(http.StatusForbidden, gin.H{"error": "invalid Clipboard device"})
		return
	}
	db := s.DB.WithContext(c.Request.Context()).
		Where("owner_id = ? AND expires_at > ?", uid, time.Now().UTC())
	db = clipboardVisibleToDevice(db, deviceID)
	if before > 0 {
		db = db.Where("id < ?", before)
	}
	var items []meta.ClipboardItem
	if err := db.Order("id DESC").Limit(clipboardPageSize + 1).Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "clipboard store unavailable"})
		return
	}
	// If a separate device grant/installation was revoked while the query
	// ran, do not return ciphertext obtained under its stale device filter.
	// An Owner-only request still sees only the v1 broadcast mailbox.
	if deviceID != "" {
		currentDevice, allowed := s.clipboardVerifiedDevice(c, uid)
		if !allowed || currentDevice != deviceID {
			c.JSON(http.StatusForbidden, gin.H{"error": "Clipboard device grant changed"})
			return
		}
	}
	hasMore := len(items) > clipboardPageSize
	if hasMore {
		items = items[:clipboardPageSize]
	}
	result := make([]clipboardItemResponse, 0, len(items))
	for _, item := range items {
		result = append(result, clipboardItemDTO(item))
	}
	var next *uint64
	if hasMore && len(items) > 0 {
		last := items[len(items)-1].ID
		next = &last
	}
	c.JSON(http.StatusOK, gin.H{"items": result, "next_before": next})
}

func (s *Server) deleteClipboardItem(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	uid := userID(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if uid == 0 {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid clipboard item ID"})
		return
	}
	deviceID, ok := s.clipboardVerifiedDevice(c, uid)
	if !ok {
		c.JSON(http.StatusForbidden, gin.H{"error": "invalid Clipboard device"})
		return
	}
	var deleted bool
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var vault meta.ClipboardVault
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("owner_id = ?", uid).First(&vault).Error; err != nil {
			return err
		}
		var victim meta.ClipboardItem
		if err := tx.Where("owner_id = ? AND id = ?", uid, id).Take(&victim).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		if victim.TargetDeviceID != "" && victim.TargetDeviceID != deviceID {
			return errClipboardForbidden
		}
		result := tx.Where("owner_id = ? AND id = ?", uid, id).Delete(&meta.ClipboardItem{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}
		deleted = true
		return appendClipboardChangeTx(tx, uid, "delete", victim.TargetDeviceID)
	})
	if errors.Is(err, errClipboardForbidden) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Clipboard target denied"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "clipboard store unavailable"})
		return
	}
	if !deleted {
		c.JSON(http.StatusNotFound, gin.H{"error": "clipboard item not found"})
		return
	}
	c.Status(http.StatusNoContent)
}

func (s *Server) clearClipboardItems(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	uid := userID(c)
	if uid == 0 {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var vault meta.ClipboardVault
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("owner_id = ?", uid).First(&vault).Error; err != nil {
			return err
		}
		result := tx.Where("owner_id = ?", uid).Delete(&meta.ClipboardItem{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}
		return appendClipboardChangeTx(tx, uid, "clear")
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "clipboard store unavailable"})
		return
	}
	c.Status(http.StatusNoContent)
}
