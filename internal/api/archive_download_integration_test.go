package api

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
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

func TestDownloadArchiveFolderMixedSelectionAndIsolation(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)

	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "archive_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error
	}()

	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{},
		&meta.ContentBlob{}, &meta.Share{}, &meta.UploadSession{}, &meta.UploadPart{}, &meta.AuditEvent{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error; err != nil {
		t.Fatal(err)
	}

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	authManager := auth.New("archive-download-test-secret", time.Hour)
	router := (&Server{
		DB: db, Store: store, Auth: authManager,
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost", MaxUploadBytes: 10 << 20,
	}).Router()
	peerRouter := (&Server{
		DB: db, Store: store, Auth: authManager,
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost", MaxUploadBytes: 10 << 20,
	}).Router()

	tokenA := createTestUser(t, db, router, "archive-owner", "archive-password")
	tokenB := createTestUser(t, db, router, "archive-other", "archive-other-password")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", tokenA, nil, http.StatusOK)
	docs := requestNode(t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID), tokenA, strings.NewReader(`{"name":"docs"}`), http.StatusCreated)
	requestNode(t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", docs.ID), tokenA, strings.NewReader(`{"name":"empty"}`), http.StatusCreated)
	nested := requestNode(t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", docs.ID), tokenA, strings.NewReader(`{"name":"nested"}`), http.StatusCreated)
	hello := uploadTestFile(t, router, tokenA, docs.ID, "hello.txt", "hello world")
	uploadTestFile(t, router, tokenA, nested.ID, "inner.txt", "inside")

	preparedResponse := request(
		t, router, http.MethodPost, "/api/v1/download/archive/prepare", tokenA,
		strings.NewReader(fmt.Sprintf(`{"ids":[%d,%d]}`, docs.ID, hello.ID)),
		http.StatusOK,
	)
	var prepared archiveDownloadPrepareResponse
	if err := json.Unmarshal(preparedResponse.Body.Bytes(), &prepared); err != nil {
		t.Fatal(err)
	}
	if prepared.TransferID == "" || prepared.Filename != "docs.zip" || len(prepared.Files) != 2 {
		t.Fatalf("unexpected archive prepare response: %+v", prepared)
	}
	if prepared.TotalBytes != int64(len("hello world")+len("inside")) {
		t.Fatalf("archive prepare total bytes=%d", prepared.TotalBytes)
	}

	res := request(
		t, router, http.MethodPost, "/api/v1/download/archive", tokenA,
		strings.NewReader(fmt.Sprintf(`{"ids":[%d,%d],"transfer_id":%q}`, docs.ID, hello.ID, prepared.TransferID)),
		http.StatusOK,
	)
	if got := res.Header().Get("Content-Type"); got != "application/zip" {
		t.Fatalf("content-type=%q", got)
	}
	if got := res.Header().Get("Content-Disposition"); !strings.Contains(got, "docs.zip") {
		t.Fatalf("content-disposition=%q", got)
	}
	entries := readArchiveTestEntries(t, res.Body.Bytes())
	for name, content := range map[string]string{
		"docs/":                 "",
		"docs/empty/":           "",
		"docs/hello.txt":        "hello world",
		"docs/nested/":          "",
		"docs/nested/inner.txt": "inside",
	} {
		got, ok := entries[name]
		if !ok {
			t.Fatalf("archive missing %q: entries=%v", name, entries)
		}
		if got != content {
			t.Fatalf("archive entry %q=%q want=%q", name, got, content)
		}
	}
	if _, duplicate := entries["hello.txt"]; duplicate {
		t.Fatalf("nested selected file was duplicated at archive root: %v", entries)
	}

	progressResponse := request(
		t, router, http.MethodGet,
		"/api/v1/download/archive/progress/"+prepared.TransferID,
		tokenA, nil, http.StatusOK,
	)
	var progress archiveDownloadProgressResponse
	if err := json.Unmarshal(progressResponse.Body.Bytes(), &progress); err != nil {
		t.Fatal(err)
	}
	if progress.State != "completed" || progress.ItemsTotal != 2 || progress.ItemsCompleted != 2 ||
		progress.ItemsFailed != 0 || progress.ItemsRunning != 0 || progress.ItemsQueued != 0 {
		t.Fatalf("unexpected completed archive progress: %+v", progress)
	}
	if progress.BytesDone != progress.BytesTotal || progress.BytesTotal != prepared.TotalBytes {
		t.Fatalf("archive progress bytes=%d/%d prepare=%d", progress.BytesDone, progress.BytesTotal, prepared.TotalBytes)
	}
	for _, file := range progress.Files {
		if file.State != "completed" || file.Done != file.Size {
			t.Fatalf("archive child progress not completed: %+v", file)
		}
	}
	request(
		t, router, http.MethodGet,
		"/api/v1/download/archive/progress/"+prepared.TransferID,
		tokenB, nil, http.StatusNotFound,
	)

	// Archive progress is only a side channel. A prepared transfer may be
	// downloaded by another Server instance that shares DB/storage but not
	// the process-local progress map. That must not make the payload fail.
	crossPreparedResponse := request(
		t, router, http.MethodPost, "/api/v1/download/archive/prepare", tokenA,
		strings.NewReader(fmt.Sprintf(`{"ids":[%d]}`, hello.ID)),
		http.StatusOK,
	)
	var crossPrepared archiveDownloadPrepareResponse
	if err := json.Unmarshal(crossPreparedResponse.Body.Bytes(), &crossPrepared); err != nil {
		t.Fatal(err)
	}
	crossServerResponse := request(
		t, peerRouter, http.MethodPost, "/api/v1/download/archive", tokenA,
		strings.NewReader(fmt.Sprintf(`{"ids":[%d],"transfer_id":%q}`, hello.ID, crossPrepared.TransferID)),
		http.StatusOK,
	)
	crossEntries := readArchiveTestEntries(t, crossServerResponse.Body.Bytes())
	if crossEntries["hello.txt"] != "hello world" {
		t.Fatalf("cross-server archive payload mismatch: %v", crossEntries)
	}

	// A local progress record that exists but belongs to a different manifest
	// is still a contract error; only genuinely unavailable local state degrades.
	request(
		t, router, http.MethodPost, "/api/v1/download/archive", tokenA,
		strings.NewReader(fmt.Sprintf(`{"ids":[%d],"transfer_id":%q}`, docs.ID, crossPrepared.TransferID)),
		http.StatusConflict,
	)

	// Reusing another owner's transfer id must never mutate that owner's
	// process-local progress state. The requested nodes remain authoritative.
	otherRoot := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", tokenB, nil, http.StatusOK)
	otherOwned := uploadTestFile(t, router, tokenB, otherRoot.ID, "other-owner.txt", "other owner")
	crossOwnerResponse := request(
		t, router, http.MethodPost, "/api/v1/download/archive", tokenB,
		strings.NewReader(fmt.Sprintf(`{"ids":[%d],"transfer_id":%q}`, otherOwned.ID, crossPrepared.TransferID)),
		http.StatusOK,
	)
	crossOwnerEntries := readArchiveTestEntries(t, crossOwnerResponse.Body.Bytes())
	if crossOwnerEntries["other-owner.txt"] != "other owner" {
		t.Fatalf("cross-owner fallback archive payload mismatch: %v", crossOwnerEntries)
	}
	untouchedProgressResponse := request(
		t, router, http.MethodGet,
		"/api/v1/download/archive/progress/"+crossPrepared.TransferID,
		tokenA, nil, http.StatusOK,
	)
	var untouchedProgress archiveDownloadProgressResponse
	if err := json.Unmarshal(untouchedProgressResponse.Body.Bytes(), &untouchedProgress); err != nil {
		t.Fatal(err)
	}
	if untouchedProgress.State != "queued" || untouchedProgress.BytesDone != 0 ||
		untouchedProgress.ItemsCompleted != 0 || untouchedProgress.ItemsRunning != 0 ||
		untouchedProgress.ItemsQueued != 1 {
		t.Fatalf("another owner mutated archive progress: %+v", untouchedProgress)
	}

	other := requestNode(t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID), tokenA, strings.NewReader(`{"name":"other"}`), http.StatusCreated)
	otherHello := uploadTestFile(t, router, tokenA, other.ID, "hello.txt", "other hello")
	multi := request(
		t, router, http.MethodPost, "/api/v1/download/archive", tokenA,
		strings.NewReader(fmt.Sprintf(`{"ids":[%d,%d]}`, hello.ID, otherHello.ID)),
		http.StatusOK,
	)
	multiEntries := readArchiveTestEntries(t, multi.Body.Bytes())
	if multiEntries["hello.txt"] != "hello world" {
		t.Fatalf("first duplicate-name root missing: %v", multiEntries)
	}
	if multiEntries["hello - 副本.txt"] != "other hello" {
		t.Fatalf("second duplicate-name root was not renamed: %v", multiEntries)
	}

	request(
		t, router, http.MethodPost, "/api/v1/download/archive", tokenB,
		strings.NewReader(fmt.Sprintf(`{"ids":[%d]}`, hello.ID)),
		http.StatusNotFound,
	)
	request(
		t, router, http.MethodPost, "/api/v1/download/archive", tokenA,
		strings.NewReader(`{"ids":[]}`),
		http.StatusBadRequest,
	)
}

func readArchiveTestEntries(t *testing.T, raw []byte) map[string]string {
	t.Helper()
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	out := make(map[string]string, len(reader.File))
	for _, file := range reader.File {
		if file.FileInfo().IsDir() {
			out[file.Name] = ""
			continue
		}
		r, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, readErr := io.ReadAll(r)
		closeErr := r.Close()
		if readErr != nil {
			t.Fatal(readErr)
		}
		if closeErr != nil {
			t.Fatal(closeErr)
		}
		out[file.Name] = string(data)
	}
	return out
}
