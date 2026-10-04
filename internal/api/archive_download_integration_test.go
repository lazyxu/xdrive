package api

import (
	"archive/zip"
	"bytes"
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
	router := (&Server{
		DB: db, Store: store, Auth: auth.New("archive-download-test-secret", time.Hour),
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

	res := request(
		t, router, http.MethodPost, "/api/v1/download/archive", tokenA,
		strings.NewReader(fmt.Sprintf(`{"ids":[%d,%d]}`, docs.ID, hello.ID)),
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
