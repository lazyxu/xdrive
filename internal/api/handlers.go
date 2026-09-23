package api

import (
	"errors"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

type authRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type authResponse struct {
	Token    string `json:"token"`
	Username string `json:"username"`
}

type nodeDTO struct {
	ID        uint64    `json:"id"`
	ParentID  *uint64   `json:"parent_id,omitempty"`
	Name      string    `json:"name"`
	Type      string    `json:"type"`
	Size      int64     `json:"size"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func toNodeDTO(n meta.Node) nodeDTO {
	d := nodeDTO{ID: n.ID, ParentID: n.ParentID, Name: n.Name, Type: n.Type, CreatedAt: n.CreatedAt, UpdatedAt: n.UpdatedAt}
	if n.File != nil {
		d.Size = n.File.Size
	}
	return d
}

func (s *Server) register(c *gin.Context) {
	var req authRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	if len(req.Username) < 3 || len(req.Username) > 64 {
		fail(c, http.StatusBadRequest, "username must be 3-64 characters")
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}

	var user meta.User
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		user = meta.User{Username: req.Username, PasswordHash: hash}
		if err := tx.Create(&user).Error; err != nil {
			return err
		}
		root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID}
		return tx.Create(&root).Error
	})
	if err != nil {
		if isDuplicate(err) {
			fail(c, http.StatusConflict, "username already exists")
		} else {
			fail(c, http.StatusInternalServerError, "registration failed")
		}
		return
	}
	token, err := s.Auth.Issue(user.ID)
	if err != nil {
		fail(c, http.StatusInternalServerError, "token creation failed")
		return
	}
	c.JSON(http.StatusCreated, authResponse{Token: token, Username: user.Username})
}

func (s *Server) login(c *gin.Context) {
	var req authRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	var user meta.User
	if err := s.DB.Where("username = ?", strings.TrimSpace(req.Username)).First(&user).Error; err != nil || auth.CheckPassword(user.PasswordHash, req.Password) != nil {
		fail(c, http.StatusUnauthorized, "invalid username or password")
		return
	}
	token, err := s.Auth.Issue(user.ID)
	if err != nil {
		fail(c, http.StatusInternalServerError, "token creation failed")
		return
	}
	c.JSON(http.StatusOK, authResponse{Token: token, Username: user.Username})
}

func (s *Server) me(c *gin.Context) {
	var user meta.User
	if err := s.DB.First(&user, userID(c)).Error; err != nil {
		fail(c, http.StatusUnauthorized, "user not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": user.ID, "username": user.Username})
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
	if err := s.DB.Preload("File").Where("owner_id = ? AND parent_id = ?", userID(c), parentID).Order("type ASC, name ASC").Find(&nodes).Error; err != nil {
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
	size, err := s.Store.Put(c.Request.Context(), key, r)
	if err != nil {
		fail(c, http.StatusInternalServerError, "storage write failed")
		return
	}
	var n meta.Node
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		n = meta.Node{ParentID: &parent.ID, Name: fh.Filename, Type: meta.NodeTypeFile, OwnerID: userID(c)}
		if err := tx.Create(&n).Error; err != nil {
			return err
		}
		return tx.Create(&meta.File{NodeID: n.ID, Size: size, StorageKey: key}).Error
	})
	if err != nil {
		_ = s.Store.Delete(c.Request.Context(), key)
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
	http.ServeContent(c.Writer, c.Request, n.Name, n.File.UpdatedAt, f)
}

func (s *Server) overwriteFile(c *gin.Context) {
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
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, s.MaxUploadBytes)
	size, err := s.Store.Put(c.Request.Context(), n.File.StorageKey, c.Request.Body)
	if err != nil {
		fail(c, http.StatusInternalServerError, "storage write failed")
		return
	}
	if err := s.DB.Model(&meta.File{}).Where("node_id = ?", id).Updates(map[string]any{"size": size, "updated_at": time.Now()}).Error; err != nil {
		fail(c, http.StatusInternalServerError, "metadata update failed")
		return
	}
	if err := s.DB.Model(&meta.Node{}).Where("id = ?", id).Update("updated_at", time.Now()).Error; err != nil {
		fail(c, http.StatusInternalServerError, "metadata update failed")
		return
	}
	n.File.Size = size
	c.JSON(http.StatusOK, toNodeDTO(n))
}

func (s *Server) updateNode(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid node id")
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
		c.JSON(http.StatusOK, toNodeDTO(n))
		return
	}
	if s.nameExists(userID(c), newParent, newName, id) {
		fail(c, http.StatusConflict, "name already exists")
		return
	}
	updates["updated_at"] = time.Now()
	if err := s.DB.Model(&meta.Node{}).Where("id = ? AND owner_id = ?", id, userID(c)).Updates(updates).Error; err != nil {
		if isDuplicate(err) {
			fail(c, http.StatusConflict, "name already exists")
		} else {
			fail(c, http.StatusInternalServerError, "update failed")
		}
		return
	}
	n, _ = s.ownedNode(userID(c), id, true)
	c.JSON(http.StatusOK, toNodeDTO(n))
}

func (s *Server) deleteNode(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid node id")
		return
	}
	n, err := s.ownedNode(userID(c), id, false)
	if err != nil {
		fail(c, http.StatusNotFound, "node not found")
		return
	}
	if n.ParentID == nil {
		fail(c, http.StatusBadRequest, "root cannot be deleted")
		return
	}
	ids, err := s.subtreeIDs(userID(c), id)
	if err != nil {
		fail(c, http.StatusInternalServerError, "delete failed")
		return
	}
	var files []meta.File
	if err := s.DB.Where("node_id IN ?", ids).Find(&files).Error; err != nil {
		fail(c, http.StatusInternalServerError, "delete failed")
		return
	}
	if err := s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("node_id IN ?", ids).Delete(&meta.File{}).Error; err != nil {
			return err
		}
		return tx.Where("id IN ? AND owner_id = ?", ids, userID(c)).Delete(&meta.Node{}).Error
	}); err != nil {
		fail(c, http.StatusInternalServerError, "delete failed")
		return
	}
	for _, f := range files {
		_ = s.Store.Delete(c.Request.Context(), f.StorageKey)
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
	q := s.DB.Where("id = ? AND owner_id = ?", id, uid)
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
	q := s.DB.Model(&meta.Node{}).Where("owner_id = ? AND parent_id = ? AND lower(name) = lower(?)", uid, parent, name)
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
	type row struct{ ID uint64 }
	var rows []row
	err := s.DB.Raw(`WITH RECURSIVE tree AS (
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
