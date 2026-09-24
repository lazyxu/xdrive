package api

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	errInvalidRefreshToken = errors.New("invalid refresh token")
	errAccountDisabled     = errors.New("account disabled")
	errRevisionConflict    = errors.New("revision conflict")
	errRootMutation        = errors.New("root mutation")
)

type authRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

type authResponse struct {
	Token              string `json:"token"`
	AccessToken        string `json:"access_token"`
	RefreshToken       string `json:"refresh_token"`
	TokenType          string `json:"token_type"`
	ExpiresIn          int64  `json:"expires_in"`
	RefreshExpiresIn   int64  `json:"refresh_expires_in"`
	Username           string `json:"username"`
	Role               string `json:"role"`
	MustChangePassword bool   `json:"must_change_password"`
}

type nodeDTO struct {
	ID        uint64     `json:"id"`
	ParentID  *uint64    `json:"parent_id,omitempty"`
	Name      string     `json:"name"`
	Type      string     `json:"type"`
	Size      int64      `json:"size"`
	Revision  uint64     `json:"revision"`
	SHA256    string     `json:"sha256,omitempty"`
	DeletedAt *time.Time `json:"deleted_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

func toNodeDTO(n meta.Node) nodeDTO {
	d := nodeDTO{ID: n.ID, ParentID: n.ParentID, Name: n.Name, Type: n.Type, Revision: n.Revision, DeletedAt: n.DeletedAt, CreatedAt: n.CreatedAt, UpdatedAt: n.UpdatedAt}
	if n.File != nil {
		d.Size = n.File.Size
		d.SHA256 = n.File.SHA256
	}
	return d
}

func (s *Server) login(c *gin.Context) {
	var req authRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	username := strings.TrimSpace(req.Username)
	var user meta.User
	if err := s.DB.Where("username = ?", username).First(&user).Error; err != nil ||
		auth.CheckPassword(user.PasswordHash, req.Password) != nil {
		s.recordAuditBestEffort(c, auditpkg.Event{
			Action: auditpkg.ActionLoginFailure, TargetType: "user", TargetLabel: username,
			Result: auditpkg.ResultFailure, RequestID: strings.TrimSpace(c.GetHeader("X-Request-ID")),
			IPAddress: clientIPAddress(c), Metadata: map[string]any{"reason": "invalid_credentials"},
		})
		fail(c, http.StatusUnauthorized, "invalid username or password")
		return
	}
	if user.DisabledAt != nil {
		uid := user.ID
		s.recordAuditBestEffort(c, auditpkg.Event{
			ActorUserID: &uid, ActorUsername: user.Username, ActorRole: user.Role,
			Action: auditpkg.ActionLoginFailure, TargetType: "user",
			TargetID: strconv.FormatUint(user.ID, 10), TargetLabel: user.Username,
			Result: auditpkg.ResultFailure, RequestID: strings.TrimSpace(c.GetHeader("X-Request-ID")),
			IPAddress: clientIPAddress(c), Metadata: map[string]any{"reason": "account_disabled"},
		})
		fail(c, http.StatusForbidden, "account_disabled")
		return
	}

	var session authResponse
	now := time.Now()
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&meta.User{}).Where("id = ?", user.ID).Update("last_login_at", &now).Error; err != nil {
			return err
		}
		user.LastLoginAt = &now
		issued, err := s.issueSession(tx, user)
		if err != nil {
			return err
		}
		session = issued
		uid := user.ID
		return recordAuditTx(tx, auditpkg.Event{
			ActorUserID: &uid, ActorUsername: user.Username, ActorRole: user.Role,
			Action: auditpkg.ActionLoginSuccess, TargetType: "user",
			TargetID: strconv.FormatUint(user.ID, 10), TargetLabel: user.Username,
			Result: auditpkg.ResultSuccess, RequestID: strings.TrimSpace(c.GetHeader("X-Request-ID")),
			IPAddress: clientIPAddress(c),
		})
	})
	if err != nil {
		fail(c, http.StatusInternalServerError, "login failed")
		return
	}
	c.JSON(http.StatusOK, session)
}

func (s *Server) refresh(c *gin.Context) {
	var req refreshRequest
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.RefreshToken) == "" {
		fail(c, http.StatusBadRequest, "refresh_token is required")
		return
	}
	hash := auth.HashRefreshToken(req.RefreshToken)
	var out authResponse
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		var current meta.RefreshToken
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("token_hash = ?", hash).First(&current).Error; err != nil {
			return errInvalidRefreshToken
		}
		now := time.Now()
		if current.RevokedAt != nil || !now.Before(current.ExpiresAt) {
			if current.RevokedAt == nil {
				_ = tx.Model(&current).Update("revoked_at", now).Error
			}
			return errInvalidRefreshToken
		}
		var user meta.User
		if err := tx.First(&user, current.UserID).Error; err != nil {
			return errInvalidRefreshToken
		}
		if user.DisabledAt != nil {
			_ = tx.Model(&current).Update("revoked_at", now).Error
			return errAccountDisabled
		}
		next, err := s.issueSession(tx, user)
		if err != nil {
			return err
		}
		var replacement meta.RefreshToken
		if err := tx.Where("token_hash = ?", auth.HashRefreshToken(next.RefreshToken)).First(&replacement).Error; err != nil {
			return err
		}
		if err := tx.Model(&current).Updates(map[string]any{
			"revoked_at":     now,
			"replaced_by_id": replacement.ID,
		}).Error; err != nil {
			return err
		}
		out = next
		return nil
	})
	if err != nil {
		switch {
		case errors.Is(err, errInvalidRefreshToken):
			fail(c, http.StatusUnauthorized, "invalid or expired refresh token")
		case errors.Is(err, errAccountDisabled):
			fail(c, http.StatusForbidden, "account_disabled")
		default:
			fail(c, http.StatusInternalServerError, "refresh failed")
		}
		return
	}
	c.JSON(http.StatusOK, out)
}

func (s *Server) logout(c *gin.Context) {
	var req refreshRequest
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.RefreshToken) == "" {
		c.Status(http.StatusNoContent)
		return
	}
	now := time.Now()
	_ = s.DB.Model(&meta.RefreshToken{}).
		Where("token_hash = ? AND revoked_at IS NULL", auth.HashRefreshToken(req.RefreshToken)).
		Update("revoked_at", now).Error
	c.Status(http.StatusNoContent)
}

func (s *Server) issueSession(db *gorm.DB, user meta.User) (authResponse, error) {
	accessToken, err := s.Auth.Issue(user.ID, user.SessionVersion)
	if err != nil {
		return authResponse{}, err
	}
	refreshToken, refreshHash, err := auth.NewRefreshToken()
	if err != nil {
		return authResponse{}, err
	}
	now := time.Now()
	record := meta.RefreshToken{
		UserID:    user.ID,
		TokenHash: refreshHash,
		ExpiresAt: now.Add(s.RefreshTTL),
	}
	if err := db.Create(&record).Error; err != nil {
		return authResponse{}, err
	}
	return authResponse{
		Token:              accessToken,
		AccessToken:        accessToken,
		RefreshToken:       refreshToken,
		TokenType:          "Bearer",
		ExpiresIn:          int64(s.Auth.TTL().Seconds()),
		RefreshExpiresIn:   int64(s.RefreshTTL.Seconds()),
		Username:           user.Username,
		Role:               user.Role,
		MustChangePassword: user.MustChangePassword,
	}, nil
}

func (s *Server) me(c *gin.Context) {
	user, ok := currentUser(c)
	if !ok {
		fail(c, http.StatusUnauthorized, "user not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id":                   user.ID,
		"username":             user.Username,
		"role":                 user.Role,
		"must_change_password": user.MustChangePassword,
	})
}

func (s *Server) root(c *gin.Context) {
	var n meta.Node
	if err := s.DB.Where("owner_id = ? AND parent_id IS NULL", userID(c)).First(&n).Error; err != nil {
		fail(c, http.StatusNotFound, "root not found")
		return
	}
	c.JSON(http.StatusOK, toNodeDTO(n))
}

func (s *Server) children(c *gin.Context) {
	parentID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid node id")
		return
	}
	if _, err := s.ownedDirectory(userID(c), parentID); err != nil {
		fail(c, statusForLookup(err), "directory not found")
		return
	}
	var nodes []meta.Node
	if err := s.DB.Preload("File").Where("owner_id = ? AND parent_id = ? AND deleted_at IS NULL", userID(c), parentID).Order("type ASC, name ASC").Find(&nodes).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list failed")
		return
	}
	out := make([]nodeDTO, 0, len(nodes))
	for _, n := range nodes {
		out = append(out, toNodeDTO(n))
	}
	c.JSON(http.StatusOK, out)
}

func (s *Server) createDirectory(c *gin.Context) {
	parentID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid parent id")
		return
	}
	if _, err := s.ownedDirectory(userID(c), parentID); err != nil {
		fail(c, statusForLookup(err), "parent directory not found")
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	if err := meta.ValidateName(req.Name); err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	n := meta.Node{ParentID: &parentID, Name: req.Name, Type: meta.NodeTypeDir, OwnerID: userID(c)}
	if err := s.DB.Create(&n).Error; err != nil {
		if isDuplicate(err) {
			fail(c, http.StatusConflict, "name already exists")
		} else {
			fail(c, http.StatusInternalServerError, "create directory failed")
		}
		return
	}
	c.JSON(http.StatusCreated, toNodeDTO(n))
}

func (s *Server) uploadFile(c *gin.Context) {
	parentID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid parent id")
		return
	}
	parent, err := s.ownedDirectory(userID(c), parentID)
	if err != nil {
		fail(c, statusForLookup(err), "parent directory not found")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, s.MaxUploadBytes+(8<<20))
	fh, err := c.FormFile("file")
	if err != nil {
		fail(c, http.StatusBadRequest, "file field is required")
		return
	}
	if fh.Size > s.MaxUploadBytes {
		fail(c, http.StatusRequestEntityTooLarge, "file too large")
		return
	}
	if err := meta.ValidateName(fh.Filename); err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	if s.nameExists(userID(c), parentID, fh.Filename, 0) {
		fail(c, http.StatusConflict, "name already exists")
		return
	}
	if _, err := s.ensureQuota(s.DB, userID(c), fh.Size, false); err != nil {
		if !writeQuotaError(c, err) {
			fail(c, http.StatusInternalServerError, "quota check failed")
		}
		return
	}
	s.uploadMultipart(c, parent, fh)
}

func (s *Server) uploadMultipart(c *gin.Context, parent meta.Node, fh *multipart.FileHeader) {
	r, err := fh.Open()
	if err != nil {
		fail(c, http.StatusBadRequest, "cannot read upload")
		return
	}
	defer r.Close()
	logical, err := s.logicalPath(parent)
	if err != nil {
		fail(c, http.StatusInternalServerError, "cannot resolve path")
		return
	}
	key := storageKey(userID(c), logical, uuid.NewString())
	h := sha256.New()
	size, err := s.Store.Put(c.Request.Context(), key, io.TeeReader(r, h))
	if err != nil {
		fail(c, http.StatusInternalServerError, "storage write failed")
		return
	}
	contentHash := hex.EncodeToString(h.Sum(nil))
	var n meta.Node
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		if _, err := s.ensureQuota(tx, userID(c), size, true); err != nil {
			return err
		}
		n = meta.Node{ParentID: &parent.ID, Name: fh.Filename, Type: meta.NodeTypeFile, OwnerID: userID(c)}
		if err := tx.Create(&n).Error; err != nil {
			return err
		}
		return tx.Create(&meta.File{NodeID: n.ID, Size: size, StorageKey: key, SHA256: contentHash}).Error
	})
	if err != nil {
		_ = s.Store.Delete(c.Request.Context(), key)
		if writeQuotaError(c, err) {
			return
		}
		if isDuplicate(err) {
			fail(c, http.StatusConflict, "name already exists")
		} else {
			fail(c, http.StatusInternalServerError, "metadata write failed")
		}
		return
	}
	_ = s.DB.Preload("File").First(&n, n.ID).Error
	c.JSON(http.StatusCreated, toNodeDTO(n))
}

func (s *Server) downloadFile(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid file id")
		return
	}
	n, err := s.ownedNode(userID(c), id, true)
	if err != nil || n.Type != meta.NodeTypeFile || n.File == nil {
		fail(c, http.StatusNotFound, "file not found")
		return
	}
	f, err := s.Store.Open(c.Request.Context(), n.File.StorageKey)
	if err != nil {
		fail(c, http.StatusNotFound, "stored content not found")
		return
	}
	defer f.Close()
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Disposition", "attachment; filename*=UTF-8''"+url.PathEscape(n.Name))
	c.Header("ETag", fmt.Sprintf("\"%d\"", n.Revision))
	if n.File.SHA256 != "" {
		c.Header("X-Content-SHA256", n.File.SHA256)
	}
	http.ServeContent(c.Writer, c.Request, n.Name, n.File.UpdatedAt, f)
}

func (s *Server) overwriteFile(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid file id")
		return
	}
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	n, err := s.ownedNode(userID(c), id, true)
	if err != nil || n.Type != meta.NodeTypeFile || n.File == nil {
		fail(c, http.StatusNotFound, "file not found")
		return
	}
	if n.Revision != expected {
		revisionConflict(c, expected, n.Revision)
		return
	}
	if c.Request.ContentLength >= 0 {
		if _, err := s.ensureQuota(s.DB, userID(c), c.Request.ContentLength, false); err != nil {
			if !writeQuotaError(c, err) {
				fail(c, http.StatusInternalServerError, "quota check failed")
			}
			return
		}
	}

	logical, err := s.logicalPath(n)
	if err != nil {
		fail(c, http.StatusInternalServerError, "cannot resolve path")
		return
	}
	newKey := storageKey(userID(c), logical, uuid.NewString())
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, s.MaxUploadBytes)
	h := sha256.New()
	size, err := s.Store.Put(c.Request.Context(), newKey, io.TeeReader(c.Request.Body, h))
	if err != nil {
		fail(c, http.StatusInternalServerError, "storage write failed")
		return
	}

	contentHash := hex.EncodeToString(h.Sum(nil))
	var currentRevision uint64
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		if _, err := s.ensureQuota(tx, userID(c), size, true); err != nil {
			return err
		}
		var current meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ? AND deleted_at IS NULL", id, userID(c)).First(&current).Error; err != nil {
			return err
		}
		currentRevision = current.Revision
		if current.Revision != expected {
			return errRevisionConflict
		}
		var file meta.File
		if err := tx.Where("node_id = ?", id).First(&file).Error; err != nil {
			return err
		}
		now := time.Now()
		if err := tx.Create(&meta.FileVersion{
			NodeID: id, Revision: current.Revision, Size: file.Size, StorageKey: file.StorageKey, SHA256: file.SHA256, CreatedAt: now,
		}).Error; err != nil {
			return err
		}
		if err := tx.Model(&meta.File{}).Where("node_id = ?", id).Updates(map[string]any{
			"size": size, "storage_key": newKey, "sha256": contentHash, "updated_at": now,
		}).Error; err != nil {
			return err
		}
		return tx.Model(&meta.Node{}).
			Where("id = ? AND owner_id = ? AND revision = ? AND deleted_at IS NULL", id, userID(c), expected).
			Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": now}).Error
	})
	if err != nil {
		_ = s.Store.Delete(c.Request.Context(), newKey)
		if writeQuotaError(c, err) {
			return
		}
		if errors.Is(err, errRevisionConflict) {
			revisionConflict(c, expected, currentRevision)
			return
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "file not found")
			return
		}
		fail(c, http.StatusInternalServerError, "metadata update failed")
		return
	}
	n, err = s.ownedNode(userID(c), id, true)
	if err != nil {
		fail(c, http.StatusInternalServerError, "metadata reload failed")
		return
	}
	c.Header("ETag", fmt.Sprintf("\"%d\"", n.Revision))
	c.JSON(http.StatusOK, toNodeDTO(n))
}

func (s *Server) updateNode(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid node id")
		return
	}
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	n, err := s.ownedNode(userID(c), id, true)
	if err != nil {
		fail(c, http.StatusNotFound, "node not found")
		return
	}
	if n.ParentID == nil {
		fail(c, http.StatusBadRequest, "root cannot be renamed or moved")
		return
	}
	if n.Revision != expected {
		revisionConflict(c, expected, n.Revision)
		return
	}
	var req struct {
		Name     *string `json:"name"`
		ParentID *uint64 `json:"parent_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	updates := map[string]any{}
	newName := n.Name
	newParent := *n.ParentID
	if req.Name != nil {
		if err := meta.ValidateName(*req.Name); err != nil {
			fail(c, http.StatusBadRequest, err.Error())
			return
		}
		newName = *req.Name
		updates["name"] = newName
	}
	if req.ParentID != nil {
		if *req.ParentID == id {
			fail(c, http.StatusBadRequest, "cannot move a node into itself")
			return
		}
		if _, err := s.ownedDirectory(userID(c), *req.ParentID); err != nil {
			fail(c, http.StatusBadRequest, "target directory not found")
			return
		}
		if n.Type == meta.NodeTypeDir && s.isDescendant(userID(c), *req.ParentID, id) {
			fail(c, http.StatusBadRequest, "cannot move a directory into its descendant")
			return
		}
		newParent = *req.ParentID
		updates["parent_id"] = newParent
	}
	if len(updates) == 0 {
		c.Header("ETag", fmt.Sprintf("\"%d\"", n.Revision))
		c.JSON(http.StatusOK, toNodeDTO(n))
		return
	}
	if s.nameExists(userID(c), newParent, newName, id) {
		fail(c, http.StatusConflict, "name already exists")
		return
	}
	updates["updated_at"] = time.Now()
	updates["revision"] = gorm.Expr("revision + 1")
	result := s.DB.Model(&meta.Node{}).
		Where("id = ? AND owner_id = ? AND revision = ?", id, userID(c), expected).
		Updates(updates)
	if result.Error != nil {
		if isDuplicate(result.Error) {
			fail(c, http.StatusConflict, "name already exists")
		} else {
			fail(c, http.StatusInternalServerError, "update failed")
		}
		return
	}
	if result.RowsAffected == 0 {
		if current, lookupErr := s.ownedNode(userID(c), id, false); lookupErr == nil {
			revisionConflict(c, expected, current.Revision)
		} else {
			fail(c, http.StatusNotFound, "node not found")
		}
		return
	}
	n, _ = s.ownedNode(userID(c), id, true)
	c.Header("ETag", fmt.Sprintf("\"%d\"", n.Revision))
	c.JSON(http.StatusOK, toNodeDTO(n))
}

func (s *Server) deleteNode(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid node id")
		return
	}
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}

	var currentRevision uint64
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		var n meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ? AND deleted_at IS NULL", id, userID(c)).First(&n).Error; err != nil {
			return err
		}
		if n.ParentID == nil {
			return errRootMutation
		}
		currentRevision = n.Revision
		if n.Revision != expected {
			return errRevisionConflict
		}
		ids, err := activeSubtreeIDsDB(tx, userID(c), id)
		if err != nil {
			return err
		}
		now := time.Now()
		if err := tx.Model(&meta.Share{}).
			Where("node_id IN ? AND owner_id = ? AND revoked_at IS NULL", ids, userID(c)).
			Update("revoked_at", &now).Error; err != nil {
			return err
		}
		if err := tx.Model(&meta.Node{}).
			Where("id IN ? AND owner_id = ? AND deleted_at IS NULL", ids, userID(c)).
			Updates(map[string]any{"deleted_at": &now, "trash_root_id": id}).Error; err != nil {
			return err
		}
		return tx.Model(&meta.Node{}).
			Where("id = ? AND owner_id = ? AND revision = ?", id, userID(c), expected).
			Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": now}).Error
	})
	if err != nil {
		switch {
		case errors.Is(err, errRevisionConflict):
			revisionConflict(c, expected, currentRevision)
		case errors.Is(err, errRootMutation):
			fail(c, http.StatusBadRequest, "root cannot be deleted")
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "node not found")
		default:
			fail(c, http.StatusInternalServerError, "delete failed")
		}
		return
	}
	c.Status(http.StatusNoContent)
}

func (s *Server) ownedDirectory(uid, id uint64) (meta.Node, error) {
	n, err := s.ownedNode(uid, id, false)
	if err != nil {
		return meta.Node{}, err
	}
	if n.Type != meta.NodeTypeDir {
		return meta.Node{}, gorm.ErrRecordNotFound
	}
	return n, nil
}

func (s *Server) ownedNode(uid, id uint64, preload bool) (meta.Node, error) {
	var n meta.Node
	q := s.DB.Where("id = ? AND owner_id = ? AND deleted_at IS NULL", id, uid)
	if preload {
		q = q.Preload("File")
	}
	return n, q.First(&n).Error
}

func (s *Server) logicalPath(n meta.Node) (string, error) {
	parts := []string{}
	for n.ParentID != nil {
		if n.Name != "" {
			parts = append(parts, n.Name)
		}
		var parent meta.Node
		if err := s.DB.First(&parent, *n.ParentID).Error; err != nil {
			return "", err
		}
		n = parent
	}
	for i, j := 0, len(parts)-1; i < j; i, j = i+1, j-1 {
		parts[i], parts[j] = parts[j], parts[i]
	}
	return filepath.ToSlash(filepath.Join(parts...)), nil
}

func storageKey(uid uint64, logicalPath, objectID string) string {
	if logicalPath == "" || logicalPath == "." {
		return fmt.Sprintf("%d/%s", uid, objectID)
	}
	return fmt.Sprintf("%d/%s/%s", uid, strings.Trim(logicalPath, "/"), objectID)
}

func (s *Server) nameExists(uid, parent uint64, name string, except uint64) bool {
	var count int64
	q := s.DB.Model(&meta.Node{}).Where("owner_id = ? AND parent_id = ? AND deleted_at IS NULL AND lower(name) = lower(?)", uid, parent, name)
	if except != 0 {
		q = q.Where("id <> ?", except)
	}
	_ = q.Count(&count).Error
	return count > 0
}

func (s *Server) isDescendant(uid, candidateParent, ancestor uint64) bool {
	current := candidateParent
	for i := 0; i < 10000; i++ {
		if current == ancestor {
			return true
		}
		var n meta.Node
		if err := s.DB.Select("id", "parent_id").Where("id = ? AND owner_id = ?", current, uid).First(&n).Error; err != nil || n.ParentID == nil {
			return false
		}
		current = *n.ParentID
	}
	return true
}

func (s *Server) subtreeIDs(uid, root uint64) ([]uint64, error) {
	return subtreeIDsDB(s.DB, uid, root)
}

func subtreeIDsDB(db *gorm.DB, uid, root uint64) ([]uint64, error) {
	type row struct{ ID uint64 }
	var rows []row
	err := db.Raw(`WITH RECURSIVE tree AS (
SELECT id FROM xd_nodes WHERE id = ? AND owner_id = ?
UNION ALL SELECT n.id FROM xd_nodes n JOIN tree t ON n.parent_id = t.id WHERE n.owner_id = ?
) SELECT id FROM tree`, root, uid, uid).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	ids := make([]uint64, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}
	if len(ids) == 0 {
		return nil, gorm.ErrRecordNotFound
	}
	return ids, nil
}

func expectedRevision(c *gin.Context) (uint64, bool) {
	raw := strings.TrimSpace(c.GetHeader("If-Match"))
	if raw == "" {
		c.AbortWithStatusJSON(http.StatusPreconditionRequired, gin.H{
			"error":   "revision_required",
			"message": "If-Match revision is required",
		})
		return 0, false
	}
	raw = strings.TrimSpace(strings.TrimPrefix(raw, "W/"))
	raw = strings.Trim(raw, "\"")
	revision, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || revision == 0 {
		fail(c, http.StatusBadRequest, "invalid If-Match revision")
		return 0, false
	}
	return revision, true
}

func revisionConflict(c *gin.Context, expected, current uint64) {
	c.AbortWithStatusJSON(http.StatusConflict, gin.H{
		"error":             "revision_conflict",
		"expected_revision": expected,
		"current_revision":  current,
	})
}

func parseID(s string) (uint64, bool) {
	n, err := strconv.ParseUint(s, 10, 64)
	return n, err == nil && n > 0
}
func statusForLookup(err error) int {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return http.StatusNotFound
	}
	return http.StatusInternalServerError
}
func fail(c *gin.Context, status int, msg string) { c.AbortWithStatusJSON(status, gin.H{"error": msg}) }
func isDuplicate(err error) bool {
	if err == nil {
		return false
	}
	x := strings.ToLower(err.Error())
	return strings.Contains(x, "duplicate") || strings.Contains(x, "unique constraint")
}
