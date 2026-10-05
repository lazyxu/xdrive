package api

import (
	"encoding/json"
	"fmt"
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

func TestFileRecentTracksRealAccessWithLiveBreadcrumbsAndIsolation(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)

	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	baseSQL, err := baseDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	baseSQL.SetMaxOpenConns(2)
	t.Cleanup(func() { _ = baseSQL.Close() })

	schema := "file_recent_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error
	})

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
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(4)
	sqlDB.SetMaxIdleConns(2)
	t.Cleanup(func() { _ = sqlDB.Close() })

	if err := db.AutoMigrate(
		&meta.User{},
		&meta.RefreshToken{},
		&meta.Node{},
		&meta.File{},
		&meta.AuditEvent{},
		&meta.FileRecentAccess{},
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
		DB: db, Store: store,
		Auth:           auth.New("recent-test-secret", time.Hour),
		RefreshTTL:     24 * time.Hour,
		AllowedOrigin:  "http://localhost",
		MaxUploadBytes: 10 << 20,
	}).Router()

	tokenA := createTestUser(t, db, router, "recent-a", "password-a")
	rootA := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", tokenA, nil, http.StatusOK)
	projects := requestNode(
		t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", rootA.ID),
		tokenA, strings.NewReader(`{"name":"Projects"}`), http.StatusCreated,
	)
	archive := requestNode(
		t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", rootA.ID),
		tokenA, strings.NewReader(`{"name":"Archive"}`), http.StatusCreated,
	)

	var rootModel meta.Node
	if err := db.First(&rootModel, rootA.ID).Error; err != nil {
		t.Fatal(err)
	}
	file := meta.Node{
		ParentID:  &projects.ID,
		Name:      "notes.txt",
		Type:      meta.NodeTypeFile,
		OwnerID:   rootModel.OwnerID,
		Revision:  1,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	if err := db.Create(&file).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{NodeID: file.ID, Size: 7, StorageKey: "recent-notes"}).Error; err != nil {
		t.Fatal(err)
	}

	res := request(t, router, http.MethodGet, "/api/v1/file-recent", tokenA, nil, http.StatusOK)
	var empty []fileRecentItemDTO
	if err := json.Unmarshal(res.Body.Bytes(), &empty); err != nil {
		t.Fatal(err)
	}
	if len(empty) != 0 {
		t.Fatalf("initial recent=%+v", empty)
	}

	request(
		t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/file-recent/%d", projects.ID),
		tokenA, strings.NewReader(`{}`), http.StatusOK,
	)
	time.Sleep(time.Millisecond)
	request(
		t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/file-recent/%d", file.ID),
		tokenA, strings.NewReader(`{}`), http.StatusOK,
	)

	res = request(t, router, http.MethodGet, "/api/v1/file-recent?limit=16", tokenA, nil, http.StatusOK)
	var items []fileRecentItemDTO
	if err := json.Unmarshal(res.Body.Bytes(), &items); err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 || items[0].Node.ID != file.ID || items[1].Node.ID != projects.ID {
		t.Fatalf("recent ordering=%+v", items)
	}
	if items[0].Path != "Projects/notes.txt" || len(items[0].Crumbs) != 3 {
		t.Fatalf("file recent path=%+v", items[0])
	}

	// Touching an existing node moves it to the front without duplication.
	time.Sleep(time.Millisecond)
	request(
		t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/file-recent/%d", projects.ID),
		tokenA, strings.NewReader(`{}`), http.StatusOK,
	)
	res = request(t, router, http.MethodGet, "/api/v1/file-recent", tokenA, nil, http.StatusOK)
	if err := json.Unmarshal(res.Body.Bytes(), &items); err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 || items[0].Node.ID != projects.ID {
		t.Fatalf("repeat touch did not reorder uniquely: %+v", items)
	}

	// Identity survives move/rename; breadcrumbs are resolved live.
	if err := db.Model(&meta.Node{}).
		Where("id = ?", projects.ID).
		Updates(map[string]any{
			"parent_id":  archive.ID,
			"name":       "Moved Projects",
			"revision":   gorm.Expr("revision + 1"),
			"updated_at": time.Now(),
		}).Error; err != nil {
		t.Fatal(err)
	}
	res = request(t, router, http.MethodGet, "/api/v1/file-recent", tokenA, nil, http.StatusOK)
	if err := json.Unmarshal(res.Body.Bytes(), &items); err != nil {
		t.Fatal(err)
	}
	var moved *fileRecentItemDTO
	for index := range items {
		if items[index].Node.ID == projects.ID {
			moved = &items[index]
			break
		}
	}
	if moved == nil || moved.Path != "Archive/Moved Projects" || len(moved.Crumbs) != 3 {
		t.Fatalf("recent breadcrumbs are stale: %+v", moved)
	}

	// Another user never sees or can touch this user's nodes.
	tokenB := createTestUser(t, db, router, "recent-b", "password-b")
	request(
		t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/file-recent/%d", projects.ID),
		tokenB, strings.NewReader(`{}`), http.StatusNotFound,
	)
	res = request(t, router, http.MethodGet, "/api/v1/file-recent", tokenB, nil, http.StatusOK)
	var isolated []fileRecentItemDTO
	if err := json.Unmarshal(res.Body.Bytes(), &isolated); err != nil {
		t.Fatal(err)
	}
	if len(isolated) != 0 {
		t.Fatalf("recent leaked across users: %+v", isolated)
	}

	// Root is intentionally not part of Recent.
	request(
		t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/file-recent/%d", rootA.ID),
		tokenA, strings.NewReader(`{}`), http.StatusNoContent,
	)
	res = request(t, router, http.MethodGet, "/api/v1/file-recent?limit=51", tokenA, nil, http.StatusBadRequest)

	// Trashed nodes are hidden but retain their last real access if later restored.
	deletedAt := time.Now()
	if err := db.Model(&meta.Node{}).
		Where("id = ?", file.ID).
		Update("deleted_at", &deletedAt).Error; err != nil {
		t.Fatal(err)
	}
	res = request(t, router, http.MethodGet, "/api/v1/file-recent", tokenA, nil, http.StatusOK)
	if err := json.Unmarshal(res.Body.Bytes(), &items); err != nil {
		t.Fatal(err)
	}
	for _, item := range items {
		if item.Node.ID == file.ID {
			t.Fatalf("trashed file remained in recent: %+v", items)
		}
	}
	if err := db.Model(&meta.Node{}).Where("id = ?", file.ID).Update("deleted_at", nil).Error; err != nil {
		t.Fatal(err)
	}
	res = request(t, router, http.MethodGet, "/api/v1/file-recent", tokenA, nil, http.StatusOK)
	if err := json.Unmarshal(res.Body.Bytes(), &items); err != nil {
		t.Fatal(err)
	}
	foundRestored := false
	for _, item := range items {
		if item.Node.ID == file.ID {
			foundRestored = true
		}
	}
	if !foundRestored {
		t.Fatalf("restored recent file did not reappear: %+v", items)
	}

	request(t, router, http.MethodDelete, "/api/v1/file-recent", tokenA, nil, http.StatusNoContent)
	res = request(t, router, http.MethodGet, "/api/v1/file-recent", tokenA, nil, http.StatusOK)
	if err := json.Unmarshal(res.Body.Bytes(), &items); err != nil {
		t.Fatal(err)
	}
	if len(items) != 0 {
		t.Fatalf("clear recent failed: %+v", items)
	}
}
