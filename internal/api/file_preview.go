package api

import (
	"fmt"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
)

const filePreviewTicketTTL = 2 * time.Hour

type filePreviewDescriptor struct {
	Kind     string
	MIMEType string
}

type filePreviewTicketDTO struct {
	URL       string    `json:"url"`
	ExpiresAt time.Time `json:"expires_at"`
	Kind      string    `json:"kind"`
	MIMEType  string    `json:"mime_type"`
}

var filePreviewDescriptors = map[string]filePreviewDescriptor{
	".pdf":  {Kind: "pdf", MIMEType: "application/pdf"},
	".avif": {Kind: "image", MIMEType: "image/avif"},
	".bmp":  {Kind: "image", MIMEType: "image/bmp"},
	".gif":  {Kind: "image", MIMEType: "image/gif"},
	".heic": {Kind: "image", MIMEType: "image/heic"},
	".heif": {Kind: "image", MIMEType: "image/heif"},
	".jpeg": {Kind: "image", MIMEType: "image/jpeg"},
	".jpg":  {Kind: "image", MIMEType: "image/jpeg"},
	".png":  {Kind: "image", MIMEType: "image/png"},
	".tif":  {Kind: "image", MIMEType: "image/tiff"},
	".tiff": {Kind: "image", MIMEType: "image/tiff"},
	".webp": {Kind: "image", MIMEType: "image/webp"},
	".avi":  {Kind: "video", MIMEType: "video/x-msvideo"},
	".m4v":  {Kind: "video", MIMEType: "video/x-m4v"},
	".mkv":  {Kind: "video", MIMEType: "video/x-matroska"},
	".mov":  {Kind: "video", MIMEType: "video/quicktime"},
	".mp4":  {Kind: "video", MIMEType: "video/mp4"},
	".mpeg": {Kind: "video", MIMEType: "video/mpeg"},
	".mpg":  {Kind: "video", MIMEType: "video/mpeg"},
	".webm": {Kind: "video", MIMEType: "video/webm"},
	".aac":  {Kind: "audio", MIMEType: "audio/aac"},
	".flac": {Kind: "audio", MIMEType: "audio/flac"},
	".m4a":  {Kind: "audio", MIMEType: "audio/mp4"},
	".mp3":  {Kind: "audio", MIMEType: "audio/mpeg"},
	".ogg":  {Kind: "audio", MIMEType: "audio/ogg"},
	".wav":  {Kind: "audio", MIMEType: "audio/wav"},
	".wma":  {Kind: "audio", MIMEType: "audio/x-ms-wma"},
}

func filePreviewDescriptorForName(name string) (filePreviewDescriptor, bool) {
	extension := strings.ToLower(filepath.Ext(strings.TrimSpace(name)))
	descriptor, ok := filePreviewDescriptors[extension]
	return descriptor, ok
}

func (s *Server) filePreviewTicket(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid file id")
		return
	}
	node, err := s.ownedNode(userID(c), id, true)
	if err != nil || node.Type != meta.NodeTypeFile || node.File == nil {
		fail(c, http.StatusNotFound, "file not found")
		return
	}
	descriptor, ok := filePreviewDescriptorForName(node.Name)
	if !ok {
		fail(c, http.StatusUnsupportedMediaType, "file preview is not supported for this file")
		return
	}
	user, ok := currentUser(c)
	if !ok {
		fail(c, http.StatusUnauthorized, "user not found")
		return
	}
	ticket, expiresAt, err := s.Auth.IssuePreviewStream(
		user.ID,
		user.SessionVersion,
		node.ID,
		node.Revision,
		descriptor.Kind,
		filePreviewTicketTTL,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "create file preview ticket failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, filePreviewTicketDTO{
		URL: fmt.Sprintf(
			"/api/v1/file-preview/%d?ticket=%s",
			node.ID,
			url.QueryEscape(ticket),
		),
		ExpiresAt: expiresAt.UTC(),
		Kind:      descriptor.Kind,
		MIMEType:  descriptor.MIMEType,
	})
}

func (s *Server) filePreview(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid file id")
		return
	}
	node, err := s.ownedNode(userID(c), id, true)
	if err != nil || node.Type != meta.NodeTypeFile || node.File == nil {
		fail(c, http.StatusNotFound, "file not found")
		return
	}
	descriptor, ok := filePreviewDescriptorForName(node.Name)
	if !ok {
		fail(c, http.StatusUnsupportedMediaType, "file preview is not supported for this file")
		return
	}
	s.serveFilePreview(c, node, descriptor)
}

func (s *Server) filePreviewTicketStream(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid file id")
		return
	}
	claims, err := s.Auth.ParsePreviewStream(strings.TrimSpace(c.Query("ticket")))
	if err != nil || claims.NodeID != id {
		fail(c, http.StatusUnauthorized, "invalid file preview ticket")
		return
	}

	var user meta.User
	if err := s.DB.WithContext(c.Request.Context()).First(&user, claims.UserID).Error; err != nil {
		fail(c, http.StatusUnauthorized, "invalid file preview ticket")
		return
	}
	if user.DisabledAt != nil ||
		user.MustChangePassword ||
		claims.SessionVersion != user.SessionVersion {
		fail(c, http.StatusUnauthorized, "file preview ticket is no longer valid")
		return
	}

	node, err := s.ownedNode(claims.UserID, id, true)
	if err != nil || node.Type != meta.NodeTypeFile || node.File == nil {
		fail(c, http.StatusNotFound, "file not found")
		return
	}
	if node.Revision != claims.NodeRevision {
		fail(c, http.StatusGone, "file preview ticket is stale")
		return
	}
	descriptor, ok := filePreviewDescriptorForName(node.Name)
	if !ok || descriptor.Kind != claims.PreviewKind {
		fail(c, http.StatusUnsupportedMediaType, "file preview is no longer supported")
		return
	}
	s.serveFilePreview(c, node, descriptor)
}

func (s *Server) serveFilePreview(
	c *gin.Context,
	node meta.Node,
	descriptor filePreviewDescriptor,
) {
	file, err := s.Store.Open(c.Request.Context(), node.File.StorageKey)
	if err != nil {
		fail(c, http.StatusNotFound, "stored content not found")
		return
	}
	defer file.Close()

	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("Content-Disposition", "inline; filename*=UTF-8''"+url.PathEscape(node.Name))
	c.Header("Content-Type", descriptor.MIMEType)
	c.Header("Cache-Control", "private, no-store")
	if sha := strings.ToLower(strings.TrimSpace(node.File.SHA256)); sha != "" {
		c.Header("ETag", fmt.Sprintf("\"file-preview-%s\"", sha))
	} else {
		c.Header("ETag", fmt.Sprintf("\"file-preview-%d-%d\"", node.ID, node.Revision))
	}
	http.ServeContent(c.Writer, c.Request, node.Name, node.File.UpdatedAt, file)
}
