package api

import (
	"bytes"
	"image"
	"image/png"
	"mime/multipart"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestMarkdownNotesMineVersionedAndIOSReadOnly(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)
	base, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "notes_crud_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := base.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = base.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error })
	dsnURL, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := dsnURL.Query()
	query.Set("search_path", schema)
	dsnURL.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(dsnURL.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{},
		&meta.FileVersion{}, &meta.ContentBlob{}, &meta.Share{},
		&meta.UploadSession{}, &meta.UploadPart{}, &meta.LocalPushQuotaHold{},
		&meta.AuditEvent{}, &meta.FileOperation{}, &meta.NotesNamespace{}, &meta.Note{},
	); err != nil { t.Fatal(err) }
	for _, sql := range []string{
		"CREATE UNIQUE INDEX idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL",
		"CREATE UNIQUE INDEX idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL",
	} {
		if err := db.Exec(sql).Error; err != nil {
			t.Fatal(err)
		}
	}
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	router := (&Server{
		DB: db, Store: store,
		Auth: auth.New("notes-crud-test-secret", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost",
		MaxUploadBytes: 10 << 20,
	}).Router()
	a := createTestUser(t, db, router, "notes-crud-a", "notes-a-password")
	b := createTestUser(t, db, router, "notes-crud-b", "notes-b-password")

	// Both Owners receive distinct real File nodes; neither can read the other.
	request(t, router, http.MethodPost, "/api/v1/notes/namespace", a,
		strings.NewReader("{}"), http.StatusOK)
	request(t, router, http.MethodPost, "/api/v1/notes/namespace", b,
		strings.NewReader("{}"), http.StatusOK)
	res := request(t, router, http.MethodPost, "/api/v1/notes", a,
		strings.NewReader(`{"title":"First 笔记","markdown":"# Hello\n\nVersion one"}`), http.StatusCreated)
	var mine notesDTO
	if err := json.Unmarshal(res.Body.Bytes(), &mine); err != nil {
		t.Fatal(err)
	}
	if mine.ID == "" || mine.Source != meta.NoteSourceMine || mine.Revision != 1 ||
		mine.NodeID == 0 || mine.SHA256 == "" {
		t.Fatalf("incomplete note receipt: %+v", mine)
	}
	// Full-text search must include Markdown body, not only file names or titles.
	res = request(t, router, http.MethodPost, "/api/v1/notes", a,
		strings.NewReader(`{"title":"Body Search Test","markdown":"正文独有检索词6702"}`),
		http.StatusCreated)
	var searchable notesDTO
	if err := json.Unmarshal(res.Body.Bytes(), &searchable); err != nil {
		t.Fatal(err)
	}
	res = request(t, router, http.MethodGet,
		"/api/v1/notes?source=mine&q=%E6%A3%80%E7%B4%A2%E8%AF%8D6702", a, nil, http.StatusOK)
	var found struct { Items []notesDTO `json:"items"` }
	if err := json.Unmarshal(res.Body.Bytes(), &found); err != nil {
		t.Fatal(err)
	}
	if len(found.Items) != 1 || found.Items[0].ID != searchable.ID {
		t.Fatalf("body search did not return the exact Owner note: %+v", found)
	}
	res = request(t, router, http.MethodGet,
		"/api/v1/notes?source=mine&q=%E6%A3%80%E7%B4%A2%E8%AF%8D6702",
		b, nil, http.StatusOK)
	var others struct { Items []notesDTO `json:"items"` }
	if err := json.Unmarshal(res.Body.Bytes(), &others); err != nil {
		t.Fatal(err)
	}
	if len(others.Items) != 0 {
		t.Fatalf("Owner B could find Owner A Markdown content: %+v", others)
	}
	res = request(t, router, http.MethodGet,
		"/api/v1/notes?source=ios_notes&q=%E6%A3%80%E7%B4%A2%E8%AF%8D6702",
		a, nil, http.StatusOK)
	var otherSource struct { Items []notesDTO `json:"items"` }
	if err := json.Unmarshal(res.Body.Bytes(), &otherSource); err != nil {
		t.Fatal(err)
	}
	if len(otherSource.Items) != 0 {
		t.Fatalf("iOS backup search exposed My Notes: %+v", otherSource)
	}

	// Picture bytes are immutable Owner CAS files within the managed Notes
	// /_assets/<note ID> directory, not an unprotected generic upload.
	imageBytes := new(bytes.Buffer)
	if err := png.Encode(imageBytes, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	imageRes := submitNoteImage(t, router, a, "/api/v1/notes/mine/"+mine.ID+"/images", imageBytes.Bytes(), http.StatusCreated)
	var picture struct {
		NodeID uint64 `json:"node_id"`
		Filename string `json:"filename"`
		Path string `json:"relative_path"`
		Bytes int64 `json:"bytes"`
	}
	if err := json.Unmarshal(imageRes.Body.Bytes(), &picture); err != nil {
		t.Fatal(err)
	}
	if picture.NodeID == 0 || picture.Bytes != int64(imageBytes.Len()) ||
		!strings.HasPrefix(picture.Path, "_assets/"+mine.ID+"/") ||
		!strings.HasSuffix(picture.Filename, ".png") {
		t.Fatalf("invalid immutable Notes picture receipt: %+v", picture)
	}
	path := "/api/v1/notes/"+mine.ID+"/images/"+picture.Filename
	imageRead := request(t, router, http.MethodGet, path, a, nil, http.StatusOK)
	if !bytes.Equal(imageRead.Body.Bytes(), imageBytes.Bytes()) {
		t.Fatal("Notes image read returned different bytes")
	}
	request(t, router, http.MethodGet, path, b, nil, http.StatusNotFound)
	request(t, router, http.MethodGet, "/api/v1/notes/"+mine.ID, b, nil, http.StatusNotFound)
	res = request(t, router, http.MethodGet, "/api/v1/notes/"+mine.ID, a, nil, http.StatusOK)
	var detail notesDTO
	if err := json.Unmarshal(res.Body.Bytes(), &detail); err != nil {
		t.Fatal(err)
	}
	if detail.Markdown == nil || *detail.Markdown != "# Hello\n\nVersion one" {
		t.Fatalf("Markdown CAS bytes lost: %+v", detail)
	}
	var managedMarkdownNode meta.Node
	if err := db.Where("id = ?", mine.NodeID).First(&managedMarkdownNode).Error; err != nil {
		t.Fatal(err)
	}
	if managedMarkdownNode.ParentID == nil {
		t.Fatal("managed Markdown node lost parent")
	}
	request(t, router, http.MethodPost, "/api/v1/uploads", a,
		strings.NewReader(fmt.Sprintf(`{"parent_id":%d,"name":"bypass.md","size":1,"chunk_size":4194304}`,
			*managedMarkdownNode.ParentID)), http.StatusConflict)

	res = request(t, router, http.MethodPut, "/api/v1/notes/"+mine.ID, a,
		strings.NewReader(`{"title":"First 笔记","markdown":"# Hello\n\nVersion two","expected_revision":1}`),
		http.StatusOK)
	var updated notesDTO
	if err := json.Unmarshal(res.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if updated.ID != mine.ID || updated.Revision != 2 || updated.SHA256 == mine.SHA256 {
		t.Fatalf("editing did not advance Note/CAS receipt: old=%+v new=%+v", mine, updated)
	}
	request(t, router, http.MethodPut, "/api/v1/notes/"+mine.ID, a,
		strings.NewReader(`{"title":"stale","markdown":"bad","expected_revision":1}`),
		http.StatusConflict)
	res = request(t, router, http.MethodGet, "/api/v1/notes/"+mine.ID+"/versions", a,
		nil, http.StatusOK)
	var history struct {
		Items []struct {
			Revision uint64 `json:"revision"`
			SHA256 string `json:"sha256"`
		} `json:"items"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &history); err != nil {
		t.Fatal(err)
	}
	if len(history.Items) != 1 || history.Items[0].Revision != 1 ||
		history.Items[0].SHA256 != mine.SHA256 {
		t.Fatalf("prior content was not preserved: %+v", history)
	}

	// iOS import uses a stable source key for exact in-place Version updates.
	iosBody := `{"title":"Apple","markdown":"# Apple original","external_id":"ios.apple.notes.id.42"}`
	res = request(t, router, http.MethodPost, "/api/v1/notes/ios/import", a,
		strings.NewReader(iosBody), http.StatusCreated)
	var imported notesDTO
	if err := json.Unmarshal(res.Body.Bytes(), &imported); err != nil {
		t.Fatal(err)
	}
	if imported.Source != meta.NoteSourceIOS || imported.Revision != 1 {
		t.Fatalf("iOS import not bound to source: %+v", imported)
	}
	res = request(t, router, http.MethodPost, "/api/v1/notes/ios/import", a,
		strings.NewReader(iosBody), http.StatusOK)
	var repeated notesDTO
	if err := json.Unmarshal(res.Body.Bytes(), &repeated); err != nil {
		t.Fatal(err)
	}
	if repeated.ID != imported.ID || repeated.Revision != 1 {
		t.Fatalf("repeated import duplicated snapshot: %+v", repeated)
	}
	res = request(t, router, http.MethodPost, "/api/v1/notes/ios/import", a,
		strings.NewReader(`{"title":"Apple","markdown":"# Apple updated","external_id":"ios.apple.notes.id.42"}`),
		http.StatusOK)
	var newIOS notesDTO
	if err := json.Unmarshal(res.Body.Bytes(), &newIOS); err != nil {
		t.Fatal(err)
	}
	if newIOS.ID != imported.ID || newIOS.Revision != 2 {
		t.Fatalf("iOS new content did not update stable identity: %+v", newIOS)
	}
	// Apple Shortcuts does not always expose a stable native Note identity.
	// Two same-title/same-body imports without an external_id MUST remain two
	// independently downloadable read-only snapshots, never title-deduped.
	manualBody := `{"title":"相同标题","markdown":"# 同一文本","external_id":""}`
	firstManual := request(t, router, http.MethodPost, "/api/v1/notes/ios/import", a,
		strings.NewReader(manualBody), http.StatusCreated)
	secondManual := request(t, router, http.MethodPost, "/api/v1/notes/ios/import", a,
		strings.NewReader(manualBody), http.StatusCreated)
	var firstSnapshot, secondSnapshot notesDTO
	if err := json.Unmarshal(firstManual.Body.Bytes(), &firstSnapshot); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(secondManual.Body.Bytes(), &secondSnapshot); err != nil {
		t.Fatal(err)
	}
	if firstSnapshot.ID == secondSnapshot.ID ||
		firstSnapshot.NodeID == secondSnapshot.NodeID ||
		firstSnapshot.Source != meta.NoteSourceIOS ||
		secondSnapshot.Source != meta.NoteSourceIOS {
		t.Fatalf("independent Apple Notes snapshots were silently merged: %+v %+v",
			firstSnapshot, secondSnapshot)
	}
	request(t, router, http.MethodGet, "/api/v1/notes/"+firstSnapshot.ID, b,
		nil, http.StatusNotFound)
	request(t, router, http.MethodPut, "/api/v1/notes/"+newIOS.ID, a,
		strings.NewReader(`{"title":"edit backup","markdown":"overwrite","expected_revision":2}`),
		http.StatusForbidden)
	noteDeleteRequest(t, router, a, newIOS.ID, newIOS.Revision, http.StatusForbidden)
	noteDeleteRequest(t, router, a, mine.ID, updated.Revision, http.StatusNoContent)
	request(t, router, http.MethodGet, "/api/v1/notes/"+mine.ID, a,
		nil, http.StatusNotFound)
	request(t, router, http.MethodGet, path, a, nil, http.StatusNotFound)
	request(t, router, http.MethodGet, "/api/v1/notes/"+newIOS.ID, a,
		nil, http.StatusOK)
}

func submitNoteImage(
	t *testing.T, router http.Handler, token, path string, data []byte, expected int,
) *httptest.ResponseRecorder {
	t.Helper()
	buf := &bytes.Buffer{}
	writer := multipart.NewWriter(buf)
	part, err := writer.CreateFormFile("image", "sample.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, path, buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	reply := httptest.NewRecorder()
	router.ServeHTTP(reply, req)
	if reply.Code != expected {
		t.Fatalf("picture POST %s: HTTP %d want %d: %s",
			path, reply.Code, expected, reply.Body.String())
	}
	return reply
}

// Reuse the ordinary If-Match rule without inventing an alternate revision API.
func noteDeleteRequest(t *testing.T, r http.Handler, token, id string,
	revision uint64, want int) {
	t.Helper()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/notes/"+id, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("If-Match", strconv.FormatUint(revision, 10))
	res := httptest.NewRecorder()
	r.ServeHTTP(res, req)
	if res.Code != want {
		t.Fatalf("delete note: HTTP %d, want %d: %s", res.Code, want, res.Body.String())
	}
}
