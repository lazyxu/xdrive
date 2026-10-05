package api

import (
	"bytes"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
)

const fileTextPreviewLimit = 64 << 10

var fileTextPreviewExtensions = map[string]struct{}{
	".bash": {}, ".bat": {}, ".c": {}, ".cc": {}, ".cfg": {}, ".cmd": {}, ".conf": {},
	".cpp": {}, ".cs": {}, ".css": {}, ".csv": {}, ".fish": {}, ".go": {}, ".gql": {},
	".gradle": {}, ".graphql": {}, ".h": {}, ".hpp": {}, ".ini": {}, ".java": {}, ".js": {},
	".json": {}, ".jsonl": {}, ".jsx": {}, ".kt": {}, ".kts": {}, ".less": {}, ".log": {},
	".md": {}, ".markdown": {}, ".properties": {}, ".proto": {}, ".ps1": {}, ".py": {},
	".rb": {}, ".rs": {}, ".scss": {}, ".sh": {}, ".sql": {}, ".text": {}, ".toml": {},
	".ts": {}, ".tsv": {}, ".tsx": {}, ".txt": {}, ".xml": {}, ".yaml": {}, ".yml": {},
	".zsh": {},
}

var fileTextPreviewBasenames = map[string]struct{}{
	"copying": {}, "dockerfile": {}, "license": {}, "makefile": {}, "readme": {},
	".editorconfig": {}, ".gitattributes": {}, ".gitignore": {},
}

type fileTextPreviewDTO struct {
	Text      string `json:"text"`
	Truncated bool   `json:"truncated"`
	Size      int64  `json:"size"`
}

func fileTextPreviewSupportedName(name string) bool {
	base := strings.ToLower(strings.TrimSpace(filepath.Base(name)))
	if _, ok := fileTextPreviewBasenames[base]; ok {
		return true
	}
	_, ok := fileTextPreviewExtensions[strings.ToLower(filepath.Ext(base))]
	return ok
}

func fileTextPreviewUTF8(data []byte) (string, bool) {
	if bytes.IndexByte(data, 0) >= 0 {
		return "", false
	}
	data = bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf})
	if utf8.Valid(data) {
		return string(data), true
	}
	for trim := 1; trim <= 3 && len(data) >= trim; trim++ {
		candidate := data[:len(data)-trim]
		tail := data[len(data)-trim:]
		if utf8.Valid(candidate) && !utf8.FullRune(tail) {
			return string(candidate), true
		}
	}
	return "", false
}

func (s *Server) fileTextPreview(c *gin.Context) {
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
	if !fileTextPreviewSupportedName(n.Name) {
		fail(c, http.StatusUnsupportedMediaType, "text preview is not supported for this file")
		return
	}
	f, err := s.Store.Open(c.Request.Context(), n.File.StorageKey)
	if err != nil {
		fail(c, http.StatusNotFound, "stored content not found")
		return
	}
	defer f.Close()

	raw, err := io.ReadAll(io.LimitReader(f, fileTextPreviewLimit+4))
	if err != nil {
		fail(c, http.StatusInternalServerError, "read text preview failed")
		return
	}
	truncated := n.File.Size > fileTextPreviewLimit || len(raw) > fileTextPreviewLimit
	if len(raw) > fileTextPreviewLimit {
		raw = raw[:fileTextPreviewLimit]
	}
	textValue, ok := fileTextPreviewUTF8(raw)
	if !ok {
		fail(c, http.StatusUnsupportedMediaType, "text preview is unavailable for binary content")
		return
	}
	c.Header("X-Content-Type-Options", "nosniff")
	c.JSON(http.StatusOK, fileTextPreviewDTO{Text: textValue, Truncated: truncated, Size: n.File.Size})
}
