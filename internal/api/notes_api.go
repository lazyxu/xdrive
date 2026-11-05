package api

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
)

const notesMaximumMarkdownBytes = 1 << 20
const notesListPageSize = 50

var (
	errNoteNotFound         = errors.New("note not found")
	errNoteSourceReadOnly   = errors.New("iOS backed up notes are read-only")
	errNoteNamespaceMissing = errors.New("notes namespace is not initialized")
	errNoteRevisionConflict = errors.New("note revision conflict")
	errNoteInvalidContent   = errors.New("invalid note title or Markdown")
)

type notesWriteRequest struct {
	Title            string `json:"title"`
	Markdown         string `json:"markdown"`
	ExternalID       string `json:"external_id"`
	ExpectedRevision uint64 `json:"expected_revision"`
}

type notesDTO struct {
	ID        string  `json:"id"`
	Source    string  `json:"source"`
	Title     string  `json:"title"`
	NodeID    uint64  `json:"node_id"`
	Revision  uint64  `json:"revision"`
	SHA256    string  `json:"sha256"`
	Bytes     int64   `json:"bytes"`
	CreatedAt string  `json:"created_at"`
	UpdatedAt string  `json:"updated_at"`
	Markdown  *string `json:"markdown,omitempty"`
}

func noteSummary(note meta.Note, node meta.Node) notesDTO {
	d := notesDTO{
		ID: note.ID, Source: note.Source, Title: note.Title, NodeID: node.ID,
		Revision: node.Revision, CreatedAt: note.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt: note.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
	if node.File != nil {
		d.Bytes = node.File.Size
		d.SHA256 = node.File.SHA256
	}
	return d
}

func validateNoteWriteInput(req notesWriteRequest) (string, error) {
	title := strings.TrimSpace(req.Title)
	if title == "" || !utf8.ValidString(title) || len([]byte(title)) > 255 ||
		strings.ContainsRune(title, 0) {
		return "", errNoteInvalidContent
	}
	for _, r := range title {
		if r < 32 || r == 127 {
			return "", errNoteInvalidContent
		}
	}
	if !utf8.ValidString(req.Markdown) || len([]byte(req.Markdown)) > notesMaximumMarkdownBytes ||
		strings.ContainsRune(req.Markdown, 0) {
		return "", errNoteInvalidContent
	}
	if req.ExternalID != "" {
		if !utf8.ValidString(req.ExternalID) || len([]byte(req.ExternalID)) > 255 {
			return "", errNoteInvalidContent
		}
		for _, r := range req.ExternalID {
			if r < 32 || r == 127 {
				return "", errNoteInvalidContent
			}
		}
	}
	return title, nil
}

func (s *Server) loadOwnedNote(uid uint64, id string) (meta.Note, meta.Node, error) {
	if uid == 0 || uuid.Validate(id) != nil {
		return meta.Note{}, meta.Node{}, errNoteNotFound
	}
	var note meta.Note
	if err := s.DB.Where("owner_id = ? AND id = ? AND deleted_at IS NULL", uid, id).
		Take(&note).Error; err != nil {
		return meta.Note{}, meta.Node{}, errNoteNotFound
	}
	node, err := s.ownedNode(uid, note.NodeID, true)
	if err != nil || node.Type != meta.NodeTypeFile || node.File == nil ||
		node.File.Size < 0 || node.File.Size > notesMaximumMarkdownBytes {
		return meta.Note{}, meta.Node{}, errNoteNotFound
	}
	var ns meta.NotesNamespace
	if err := s.DB.Where("owner_id = ?", uid).First(&ns).Error; err != nil {
		return meta.Note{}, meta.Node{}, errNoteNotFound
	}
	expectedParent := ns.MineNodeID
	if note.Source == meta.NoteSourceIOS {
		expectedParent = ns.IOSNodeID
	} else if note.Source != meta.NoteSourceMine {
		return meta.Note{}, meta.Node{}, errNoteNotFound
	}
	if node.ParentID == nil || *node.ParentID != expectedParent ||
		node.Name != note.ID+".md" {
		return meta.Note{}, meta.Node{}, errNoteNotFound
	}
	return note, node, nil
}

func (s *Server) listNotes(c *gin.Context) {
	uid := userID(c)
	source := c.DefaultQuery("source", meta.NoteSourceMine)
	if source != meta.NoteSourceMine && source != meta.NoteSourceIOS {
		fail(c, http.StatusBadRequest, "invalid note source")
		return
	}
	query := strings.TrimSpace(c.Query("q"))
	if len([]byte(query)) > 200 {
		fail(c, http.StatusBadRequest, "note query too long")
		return
	}
	offset, err := parseNotesOffset(c.Query("offset"))
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid page offset")
		return
	}
	stmt := s.DB.Where("owner_id = ? AND source = ? AND deleted_at IS NULL", uid, source)
	if query != "" {
		needle := "%" + escapeNoteLike(query) + "%"
		stmt = stmt.Where("(title ILIKE ? OR search_text ILIKE ?)", needle, needle)
	}
	var notes []meta.Note
	if err := stmt.Order("updated_at DESC, id DESC").Offset(offset).Limit(notesListPageSize + 1).
		Find(&notes).Error; err != nil {
		fail(c, http.StatusInternalServerError, "read notes failed")
		return
	}
	hasMore := len(notes) > notesListPageSize
	if hasMore {
		notes = notes[:notesListPageSize]
	}
	items := make([]notesDTO, 0, len(notes))
	if len(notes) > 0 {
		// Validate the Owner-bound namespace once and load all backing Nodes
		// in one bounded query. Calling loadOwnedNote for every row performed
		// three additional SQL reads per item and made every 50-row page scale
		// with N+1 round trips.
		ns, exists, err := notesExistingNamespaceTx(c.Request.Context(), s.DB, uid)
		if err != nil || !exists {
			fail(c, http.StatusConflict, "notes index is inconsistent")
			return
		}
		parentID := ns.MineNodeID
		if source == meta.NoteSourceIOS {
			parentID = ns.IOSNodeID
		}
		nodeIDs := make([]uint64, 0, len(notes))
		for _, note := range notes {
			if note.NodeID == 0 {
				fail(c, http.StatusConflict, "notes index is inconsistent")
				return
			}
			nodeIDs = append(nodeIDs, note.NodeID)
		}
		var nodes []meta.Node
		if err := s.DB.WithContext(c.Request.Context()).
			Preload("File").
			Where("owner_id = ? AND id IN ? AND deleted_at IS NULL", uid, nodeIDs).
			Find(&nodes).Error; err != nil {
			fail(c, http.StatusConflict, "notes index is inconsistent")
			return
		}
		nodesByID := make(map[uint64]meta.Node, len(nodes))
		for _, node := range nodes {
			nodesByID[node.ID] = node
		}
		for _, note := range notes {
			node, ok := nodesByID[note.NodeID]
			if !ok || node.Type != meta.NodeTypeFile || node.File == nil ||
				node.File.Size < 0 || node.File.Size > notesMaximumMarkdownBytes ||
				node.ParentID == nil || *node.ParentID != parentID ||
				node.Name != note.ID+".md" {
				fail(c, http.StatusConflict, "notes index is inconsistent")
				return
			}
			items = append(items, noteSummary(note, node))
		}
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"items": items, "next_offset": func() int {
		if hasMore {
			return offset + notesListPageSize
		}
		return 0
	}()})
}

func parseNotesOffset(value string) (int, error) {
	if value == "" {
		return 0, nil
	}
	if len(value) > 9 {
		return 0, errNoteInvalidContent
	}
	n := 0
	for _, r := range value {
		if r < '0' || r > '9' {
			return 0, errNoteInvalidContent
		}
		n = n*10 + int(r-'0')
	}
	if n > 10000000 || n%notesListPageSize != 0 {
		return 0, errNoteInvalidContent
	}
	return n, nil
}

func escapeNoteLike(text string) string {
	text = strings.ReplaceAll(text, "\\", "\\\\")
	text = strings.ReplaceAll(text, "%", "\\%")
	return strings.ReplaceAll(text, "_", "\\_")
}

func (s *Server) readNote(c *gin.Context) {
	note, node, err := s.loadOwnedNote(userID(c), c.Param("id"))
	if err != nil {
		fail(c, http.StatusNotFound, "note not found")
		return
	}
	f, err := s.Store.Open(c.Request.Context(), node.File.StorageKey)
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "note content unavailable")
		return
	}
	defer f.Close()
	content, err := io.ReadAll(io.LimitReader(f, notesMaximumMarkdownBytes+1))
	if err != nil || len(content) > notesMaximumMarkdownBytes ||
		int64(len(content)) != node.File.Size || !utf8.Valid(content) {
		fail(c, http.StatusConflict, "note content is inconsistent")
		return
	}
	hash := sha256.Sum256(content)
	if node.File.SHA256 != hex.EncodeToString(hash[:]) {
		fail(c, http.StatusConflict, "note checksum mismatch")
		return
	}
	value := string(content)
	d := noteSummary(note, node)
	d.Markdown = &value
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, d)
}

func (s *Server) noteVersions(c *gin.Context) {
	_, node, err := s.loadOwnedNote(userID(c), c.Param("id"))
	if err != nil {
		fail(c, http.StatusNotFound, "note not found")
		return
	}
	var versions []meta.FileVersion
	if err := s.DB.Where("node_id = ?", node.ID).Order("revision DESC, id DESC").
		Limit(100).Find(&versions).Error; err != nil {
		fail(c, http.StatusInternalServerError, "read note versions failed")
		return
	}
	type version struct {
		ID       uint64 `json:"id"`
		Revision uint64 `json:"revision"`
		SHA256   string `json:"sha256"`
		Bytes    int64  `json:"bytes"`
	}
	out := make([]version, 0, len(versions))
	for _, v := range versions {
		out = append(out, version{ID: v.ID, Revision: v.Revision, SHA256: v.SHA256, Bytes: v.Size})
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"items": out, "node_id": node.ID})
}

func noteWriteError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, errNoteInvalidContent):
		fail(c, http.StatusBadRequest, "invalid note title or Markdown; maximum 1 MiB")
	case errors.Is(err, errNoteNotFound):
		fail(c, http.StatusNotFound, "note not found")
	case errors.Is(err, errNoteNamespaceMissing):
		fail(c, http.StatusConflict, "initialize notes namespace first")
	case errors.Is(err, errNoteSourceReadOnly):
		fail(c, http.StatusForbidden, "iOS backup cannot be edited or deleted")
	case errors.Is(err, errNoteRevisionConflict), errors.Is(err, errNotesManagedPath), isDuplicate(err):
		fail(c, http.StatusConflict, "note revision or identity conflict")
	default:
		if writeQuotaError(c, err) {
			return
		}
		if writeStorageCapacityError(c, err) {
			return
		}
		fail(c, http.StatusInternalServerError, "note write failed")
	}
}
