package api

import (
	"fmt"
	"mime"
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
)

const authenticatedDownloadTicketTTL = 10 * time.Minute

type authenticatedDownloadTicketDTO struct {
	URL        string    `json:"url"`
	ExpiresAt  time.Time `json:"expires_at"`
	TransferID string    `json:"transfer_id,omitempty"`
	BytesTotal int64     `json:"bytes_total,omitempty"`
}

func (s *Server) fileDownloadTicket(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid file id")
		return
	}
	metadata, err := loadCurrentFileDownloadMetadata(c.Request.Context(), s.DB, userID(c), id)
	if err != nil {
		fail(c, http.StatusNotFound, "file not found")
		return
	}
	user, ok := currentUser(c)
	if !ok {
		fail(c, http.StatusUnauthorized, "user not found")
		return
	}
	transferID := uuid.NewString()
	ticket, expiresAt, err := s.Auth.IssueTrackedDownloadStream(
		user.ID,
		user.SessionVersion,
		"file",
		strconv.FormatUint(id, 10),
		metadata.Revision,
		transferID,
		authenticatedDownloadTicketTTL,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "create file download ticket failed")
		return
	}
	if !s.createDownloadTransfer(
		c.Request.Context(), transferID, user.ID, "file", strconv.FormatUint(id, 10),
		metadata.Name, metadata.Size, expiresAt,
	) {
		transferID = ""
		ticket, expiresAt, err = s.Auth.IssueDownloadStream(
			user.ID,
			user.SessionVersion,
			"file",
			strconv.FormatUint(id, 10),
			metadata.Revision,
			authenticatedDownloadTicketTTL,
		)
		if err != nil {
			fail(c, http.StatusInternalServerError, "create file download ticket failed")
			return
		}
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, authenticatedDownloadTicketDTO{
		URL:        fmt.Sprintf("/api/v1/file-download/%d?ticket=%s", id, url.QueryEscape(ticket)),
		ExpiresAt:  expiresAt.UTC(),
		TransferID: transferID,
		BytesTotal: metadata.Size,
	})
}

func (s *Server) fileVersionDownloadTicket(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid file id")
		return
	}
	versionID, ok := parseID(c.Param("versionID"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid version id")
		return
	}
	metadata, err := loadFileVersionDownloadMetadata(
		c.Request.Context(),
		s.DB,
		userID(c),
		id,
		versionID,
	)
	if err != nil {
		fail(c, http.StatusNotFound, "file not found")
		return
	}
	if !metadata.VersionFound {
		fail(c, http.StatusNotFound, "version not found")
		return
	}
	user, ok := currentUser(c)
	if !ok {
		fail(c, http.StatusUnauthorized, "user not found")
		return
	}
	resourceID := fmt.Sprintf("%d:%d", id, versionID)
	transferID := uuid.NewString()
	ticket, expiresAt, err := s.Auth.IssueTrackedDownloadStream(
		user.ID,
		user.SessionVersion,
		"version",
		resourceID,
		0,
		transferID,
		authenticatedDownloadTicketTTL,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "create version download ticket failed")
		return
	}
	if !s.createDownloadTransfer(
		c.Request.Context(), transferID, user.ID, "version", resourceID,
		metadata.Name, metadata.Size, expiresAt,
	) {
		transferID = ""
		ticket, expiresAt, err = s.Auth.IssueDownloadStream(
			user.ID,
			user.SessionVersion,
			"version",
			resourceID,
			0,
			authenticatedDownloadTicketTTL,
		)
		if err != nil {
			fail(c, http.StatusInternalServerError, "create version download ticket failed")
			return
		}
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, authenticatedDownloadTicketDTO{
		URL: fmt.Sprintf(
			"/api/v1/file-version-download/%d/%d?ticket=%s",
			id,
			versionID,
			url.QueryEscape(ticket),
		),
		ExpiresAt:  expiresAt.UTC(),
		TransferID: transferID,
		BytesTotal: metadata.Size,
	})
}

func (s *Server) validateAuthenticatedDownloadTicket(
	c *gin.Context,
	resourceKind, resourceID string,
) (auth.DownloadStreamClaims, bool) {
	claims, err := s.Auth.ParseDownloadStream(strings.TrimSpace(c.Query("ticket")))
	if err != nil ||
		claims.ResourceKind != resourceKind ||
		claims.ResourceID != resourceID {
		fail(c, http.StatusUnauthorized, "invalid download ticket")
		return auth.DownloadStreamClaims{}, false
	}
	var user meta.User
	if err := s.DB.WithContext(c.Request.Context()).First(&user, claims.UserID).Error; err != nil {
		fail(c, http.StatusUnauthorized, "invalid download ticket")
		return auth.DownloadStreamClaims{}, false
	}
	if user.DisabledAt != nil ||
		user.MustChangePassword ||
		claims.SessionVersion != user.SessionVersion {
		fail(c, http.StatusUnauthorized, "download ticket is no longer valid")
		return auth.DownloadStreamClaims{}, false
	}
	return claims, true
}

func (s *Server) fileDownloadTicketStream(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid file id")
		return
	}
	claims, ok := s.validateAuthenticatedDownloadTicket(c, "file", strconv.FormatUint(id, 10))
	if !ok {
		return
	}
	metadata, err := loadCurrentFileDownloadMetadata(
		c.Request.Context(),
		s.DB,
		claims.UserID,
		id,
	)
	if err != nil {
		fail(c, http.StatusNotFound, "file not found")
		return
	}
	if claims.ResourceRevision == 0 || metadata.Revision != claims.ResourceRevision {
		fail(c, http.StatusGone, "file download ticket is stale")
		return
	}
	s.serveAuthenticatedTicketDownload(
		c,
		metadata.Name,
		metadata.StorageKey,
		metadata.SHA256,
		metadata.UpdatedAt,
		fmt.Sprintf("\"%d\"", metadata.Revision),
		claims.ID,
		metadata.Size,
	)
}

func (s *Server) fileVersionDownloadTicketStream(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid file id")
		return
	}
	versionID, ok := parseID(c.Param("versionID"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid version id")
		return
	}
	resourceID := fmt.Sprintf("%d:%d", id, versionID)
	claims, ok := s.validateAuthenticatedDownloadTicket(c, "version", resourceID)
	if !ok {
		return
	}
	metadata, err := loadFileVersionDownloadMetadata(
		c.Request.Context(),
		s.DB,
		claims.UserID,
		id,
		versionID,
	)
	if err != nil {
		fail(c, http.StatusNotFound, "file not found")
		return
	}
	if !metadata.VersionFound {
		fail(c, http.StatusGone, "version download ticket is stale")
		return
	}
	s.serveAuthenticatedTicketDownload(
		c,
		metadata.Name,
		metadata.StorageKey,
		metadata.SHA256,
		metadata.CreatedAt,
		"",
		claims.ID,
		metadata.Size,
	)
}

func (s *Server) serveAuthenticatedTicketDownload(
	c *gin.Context,
	name, storageKey, sha string,
	updatedAt time.Time,
	etag string,
	transferID string,
	bytesTotal int64,
) {
	file, err := s.Store.Open(c.Request.Context(), storageKey)
	if err != nil {
		fail(c, http.StatusNotFound, "stored content not found")
		return
	}
	defer file.Close()

	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("Content-Disposition", "attachment; filename*=UTF-8''"+url.PathEscape(name))
	contentType := mime.TypeByExtension(filepath.Ext(name))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	c.Header("Content-Type", contentType)
	c.Header("Cache-Control", "private, no-store")
	if etag != "" {
		c.Header("ETag", etag)
	}
	if sha = strings.TrimSpace(sha); sha != "" {
		c.Header("X-Content-SHA256", sha)
	}
	if transferID == "" || c.Request.Method == http.MethodHead {
		http.ServeContent(c.Writer, c.Request, name, updatedAt, file)
		return
	}
	s.serveTrackedDownloadContent(c, transferID, name, updatedAt, file, bytesTotal)
}

func (s *Server) archiveDownloadTicket(c *gin.Context) {
	runID := strings.TrimSpace(c.Param("id"))
	if runID == "" {
		fail(c, http.StatusBadRequest, "invalid archive prepare id")
		return
	}
	var run meta.ArchivePrepareRun
	if err := s.DB.WithContext(c.Request.Context()).
		Where("id = ? AND owner_id = ?", runID, userID(c)).
		First(&run).Error; err != nil {
		fail(c, http.StatusNotFound, "archive prepare not found")
		return
	}
	now := time.Now().UTC()
	if run.Status != meta.ArchivePrepareStatusCompleted {
		fail(c, http.StatusConflict, "archive prepare is not completed")
		return
	}
	remaining := run.ExpiresAt.Sub(now)
	if remaining <= 0 {
		fail(c, http.StatusGone, "archive prepare expired")
		return
	}
	user, ok := currentUser(c)
	if !ok {
		fail(c, http.StatusUnauthorized, "user not found")
		return
	}
	ttl := min(authenticatedDownloadTicketTTL, remaining)
	token, expiresAt, err := s.Auth.IssueDownloadStream(
		user.ID,
		user.SessionVersion,
		"archive",
		run.ID,
		0,
		ttl,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "create archive download ticket failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, authenticatedDownloadTicketDTO{
		URL:       fmt.Sprintf("/api/v1/archive-download/%s?ticket=%s", url.PathEscape(run.ID), url.QueryEscape(token)),
		ExpiresAt: expiresAt.UTC(),
	})
}

func (s *Server) archiveDownloadTicketStream(c *gin.Context) {
	runID := strings.TrimSpace(c.Param("id"))
	if runID == "" {
		fail(c, http.StatusBadRequest, "invalid archive prepare id")
		return
	}
	claims, ok := s.validateAuthenticatedDownloadTicket(c, "archive", runID)
	if !ok {
		return
	}
	var run meta.ArchivePrepareRun
	if err := s.DB.WithContext(c.Request.Context()).
		Where("id = ? AND owner_id = ?", runID, claims.UserID).
		First(&run).Error; err != nil {
		fail(c, http.StatusNotFound, "archive prepare not found")
		return
	}
	if run.Status != meta.ArchivePrepareStatusCompleted {
		fail(c, http.StatusConflict, "archive prepare is not completed")
		return
	}
	if time.Now().UTC().After(run.ExpiresAt) {
		fail(c, http.StatusGone, "archive prepare expired")
		return
	}
	ids, err := archivePrepareIDs(run)
	if err != nil {
		fail(c, http.StatusConflict, "archive prepare is invalid")
		return
	}
	s.serveArchiveDownload(c, claims.UserID, ids, run.ID)
}
