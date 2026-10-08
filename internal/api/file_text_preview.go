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

const fileTextPreviewLimit = 1 << 20

var fileTextPreviewExtensions = map[string]struct{}{
	".asm": {}, ".astro": {}, ".bash": {}, ".bat": {}, ".c": {}, ".cc": {}, ".cfg": {},
	".cjs": {}, ".cljs": {}, ".clj": {}, ".cmd": {}, ".conf": {}, ".cpp": {}, ".cs": {},
	".css": {}, ".csv": {}, ".cxx": {}, ".dart": {}, ".erl": {}, ".ex": {}, ".exs": {},
	".fish": {}, ".fs": {}, ".fsx": {}, ".go": {}, ".gql": {}, ".gradle": {},
	".graphql": {}, ".groovy": {}, ".h": {}, ".hpp": {}, ".hrl": {}, ".hs": {},
	".htm": {}, ".html": {}, ".hxx": {}, ".ini": {}, ".java": {}, ".js": {},
	".json": {}, ".jsonl": {}, ".jsx": {}, ".kt": {}, ".kts": {}, ".less": {},
	".lock": {}, ".log": {}, ".lua": {}, ".m": {}, ".md": {}, ".markdown": {},
	".mjs": {}, ".mk": {}, ".mm": {}, ".nix": {}, ".patch": {}, ".php": {},
	".pl": {}, ".pm": {},
	".properties": {}, ".proto": {}, ".ps1": {}, ".py": {}, ".rb": {}, ".rs": {},
	".r": {}, ".s": {}, ".scala": {}, ".scss": {}, ".sh": {}, ".sol": {}, ".sql": {},
	".svelte": {}, ".svg": {}, ".swift": {}, ".tex": {}, ".text": {}, ".tf": {},
	".tfvars": {}, ".toml": {}, ".ts": {}, ".tsv": {}, ".tsx": {}, ".txt": {},
	".vb": {}, ".vbs": {}, ".vue": {}, ".xml": {}, ".yaml": {}, ".yml": {},
	".zig": {}, ".zsh": {},
}

var fileTextPreviewBasenames = map[string]struct{}{
	"cmakelists.txt": {}, "copying": {}, "dockerfile": {}, "gemfile": {},
	"jenkinsfile": {}, "license": {}, "makefile": {}, "procfile": {}, "rakefile": {},
	"readme": {}, ".babelrc": {}, ".browserslistrc": {}, ".dockerignore": {},
	".editorconfig": {}, ".env": {}, ".eslintignore": {}, ".eslintrc": {},
	".gitattributes": {}, ".gitignore": {}, ".gitmodules": {}, ".npmignore": {},
	".npmrc": {}, ".prettierignore": {}, ".prettierrc": {}, ".stylelintrc": {},
	".yarnrc": {},
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
	if strings.HasPrefix(base, ".env.") ||
		strings.HasPrefix(base, ".eslintrc.") ||
		strings.HasPrefix(base, ".prettierrc.") ||
		strings.HasPrefix(base, ".stylelintrc.") {
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
