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

func TestFileQuickAccessPersistenceIsolationAndLiveBreadcrumbs(t *testing.T) {
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

	schema := "file_quick_access_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		&meta.FileQuickAccess{},
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
		Auth:           auth.New("quick-access-test-secret", time.Hour),
		RefreshTTL:     24 * time.Hour,
		AllowedOrigin:  "http://localhost",
		MaxUploadBytes: 10 << 20,
	}).Router()

	tokenA := createTestUser(t, db, router, "quick-a", "password-a")
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
		Name:      "readme.txt",
		Type:      meta.NodeTypeFile,
		OwnerID:   rootModel.OwnerID,
		Revision:  1,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	if err := db.Create(&file).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{NodeID: file.ID, Size: 1, StorageKey: "quick-access-file"}).Error; err != nil {
		t.Fatal(err)
	}

	res := request(
		t, router, http.MethodPut,
		fmt.Sprintf("/api/v1/file-quick-access/%d", projects.ID),
		tokenA, nil, http.StatusCreated,
	)
	var pinned fileQuickAccessItemDTO
	if err := json.Unmarshal(res.Body.Bytes(), &pinned); err != nil {
		t.Fatal(err)
	}
	if pinned.Node.ID != projects.ID || pinned.Path != "Projects" || len(pinned.Crumbs) != 2 {
		t.Fatalf("unexpected pinned item: %+v", pinned)
	}

	// Pinning is idempotent.
	request(
		t, router, http.MethodPut,
		fmt.Sprintf("/api/v1/file-quick-access/%d", projects.ID),
		tokenA, nil, http.StatusOK,
	)

	request(
		t, router, http.MethodPut,
		fmt.Sprintf("/api/v1/file-quick-access/%d", rootA.ID),
		tokenA, nil, http.StatusBadRequest,
	)
	request(
		t, router, http.MethodPut,
		fmt.Sprintf("/api/v1/file-quick-access/%d", file.ID),
		tokenA, nil, http.StatusBadRequest,
	)

	tokenB := createTestUser(t, db, router, "quick-b", "password-b")
	request(
		t, router, http.MethodPut,
		fmt.Sprintf("/api/v1/file-quick-access/%d", projects.ID),
		tokenB, nil, http.StatusNotFound,
	)
	res = request(t, router, http.MethodGet, "/api/v1/file-quick-access", tokenB, nil, http.StatusOK)
	var isolated []fileQuickAccessItemDTO
	if err := json.Unmarshal(res.Body.Bytes(), &isolated); err != nil {
		t.Fatal(err)
	}
	if len(isolated) != 0 {
		t.Fatalf("quick access leaked across users: %+v", isolated)
	}

	// Node identity survives move/rename because list resolves live breadcrumbs.
	if err := db.Model(&meta.Node{}).
		Where("id = ?", projects.ID).
		Updates(map[string]any{
			"parent_id":  archive.ID,
			"name":       "Pinned Projects",
			"revision":   gorm.Expr("revision + 1"),
			"updated_at": time.Now(),
		}).Error; err != nil {
		t.Fatal(err)
	}
	res = request(t, router, http.MethodGet, "/api/v1/file-quick-access", tokenA, nil, http.StatusOK)
	var moved []fileQuickAccessItemDTO
	if err := json.Unmarshal(res.Body.Bytes(), &moved); err != nil {
		t.Fatal(err)
	}
	if len(moved) != 1 || moved[0].Path != "Archive/Pinned Projects" || len(moved[0].Crumbs) != 3 {
		t.Fatalf("quick access did not resolve live path: %+v", moved)
	}
	if moved[0].Crumbs[1].ID != archive.ID || moved[0].Crumbs[2].ID != projects.ID {
		t.Fatalf("quick access breadcrumbs are stale: %+v", moved[0].Crumbs)
	}

	// Trashed folders disappear without destroying the pin and reappear after restore.
	deletedAt := time.Now()
	if err := db.Model(&meta.Node{}).
		Where("id = ?", projects.ID).
		Updates(map[string]any{"deleted_at": &deletedAt, "trash_root_id": projects.ID}).Error; err != nil {
		t.Fatal(err)
	}
	res = request(t, router, http.MethodGet, "/api/v1/file-quick-access", tokenA, nil, http.StatusOK)
	var hidden []fileQuickAccessItemDTO
	if err := json.Unmarshal(res.Body.Bytes(), &hidden); err != nil {
		t.Fatal(err)
	}
	if len(hidden) != 0 {
		t.Fatalf("trashed quick access item should be hidden: %+v", hidden)
	}
	if err := db.Model(&meta.Node{}).
		Where("id = ?", projects.ID).
		Updates(map[string]any{"deleted_at": nil, "trash_root_id": nil}).Error; err != nil {
		t.Fatal(err)
	}
	res = request(t, router, http.MethodGet, "/api/v1/file-quick-access", tokenA, nil, http.StatusOK)
	var restored []fileQuickAccessItemDTO
	if err := json.Unmarshal(res.Body.Bytes(), &restored); err != nil {
		t.Fatal(err)
	}
	if len(restored) != 1 || restored[0].Node.ID != projects.ID {
		t.Fatalf("restored quick access item did not reappear: %+v", restored)
	}

	request(
		t, router, http.MethodDelete,
		fmt.Sprintf("/api/v1/file-quick-access/%d", projects.ID),
		tokenA, nil, http.StatusNoContent,
	)
	res = request(t, router, http.MethodGet, "/api/v1/file-quick-access", tokenA, nil, http.StatusOK)
	var empty []fileQuickAccessItemDTO
	if err := json.Unmarshal(res.Body.Bytes(), &empty); err != nil {
		t.Fatal(err)
	}
	if len(empty) != 0 {
		t.Fatalf("unpin did not remove item: %+v", empty)
	}
}
