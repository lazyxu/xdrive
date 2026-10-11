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

func TestFileFavoritesPersistenceIsolationAndLiveBreadcrumbs(t *testing.T) {
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

	schema := "file_favorites_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		&meta.FileFavorite{},
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
		DB:             db,
		Store:          store,
		Auth:           auth.New("file-favorites-test-secret", time.Hour),
		RefreshTTL:     24 * time.Hour,
		AllowedOrigin:  "http://localhost",
		MaxUploadBytes: 10 << 20,
	}).Router()

	tokenA := createTestUser(t, db, router, "favorite-a", "password-a")
	rootA := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", tokenA, nil, http.StatusOK)
	projects := requestNode(
		t,
		router,
		http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", rootA.ID),
		tokenA,
		strings.NewReader(`{"name":"Projects"}`),
		http.StatusCreated,
	)
	archive := requestNode(
		t,
		router,
		http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", rootA.ID),
		tokenA,
		strings.NewReader(`{"name":"Archive"}`),
		http.StatusCreated,
	)
	var rootModel meta.Node
	if err := db.First(&rootModel, rootA.ID).Error; err != nil {
		t.Fatal(err)
	}
	fileNode := meta.Node{
		ParentID:  &projects.ID,
		Name:      "design.pdf",
		Type:      meta.NodeTypeFile,
		OwnerID:   rootModel.OwnerID,
		Revision:  1,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	if err := db.Create(&fileNode).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{
		NodeID:     fileNode.ID,
		Size:       42,
		StorageKey: "favorite-design",
	}).Error; err != nil {
		t.Fatal(err)
	}

	res := request(
		t,
		router,
		http.MethodPut,
		fmt.Sprintf("/api/v1/file-favorites/%d", fileNode.ID),
		tokenA,
		nil,
		http.StatusCreated,
	)
	var favorite fileFavoriteItemDTO
	if err := json.Unmarshal(res.Body.Bytes(), &favorite); err != nil {
		t.Fatal(err)
	}
	if favorite.Node.ID != fileNode.ID ||
		favorite.Path != "Projects/design.pdf" ||
		len(favorite.Crumbs) != 3 {
		t.Fatalf("unexpected favorite item: %+v", favorite)
	}

	request(
		t,
		router,
		http.MethodPut,
		fmt.Sprintf("/api/v1/file-favorites/%d", fileNode.ID),
		tokenA,
		nil,
		http.StatusOK,
	)
	request(
		t,
		router,
		http.MethodPut,
		fmt.Sprintf("/api/v1/file-favorites/%d", projects.ID),
		tokenA,
		nil,
		http.StatusBadRequest,
	)

	tokenB := createTestUser(t, db, router, "favorite-b", "password-b")
	request(
		t,
		router,
		http.MethodPut,
		fmt.Sprintf("/api/v1/file-favorites/%d", fileNode.ID),
		tokenB,
		nil,
		http.StatusNotFound,
	)
	res = request(
		t,
		router,
		http.MethodGet,
		"/api/v1/file-favorites",
		tokenB,
		nil,
		http.StatusOK,
	)
	var isolated []fileFavoriteItemDTO
	if err := json.Unmarshal(res.Body.Bytes(), &isolated); err != nil {
		t.Fatal(err)
	}
	if len(isolated) != 0 {
		t.Fatalf("file favorites leaked across users: %+v", isolated)
	}

	// F-iOS27-09G: the real Gin/PostgreSQL contract deliberately treats a
	// foreign/missing favorite DELETE as idempotent 204, not a fabricated
	// 403. Authorization comes from the owner_id predicate: B cannot mutate
	// A's favorite or the underlying Node even when B knows the exact ID.
	request(
		t, router, http.MethodDelete,
		fmt.Sprintf("/api/v1/file-favorites/%d", fileNode.ID),
		tokenB, nil, http.StatusNoContent,
	)
	var ownedFavoriteCount int64
	if err := db.Model(&meta.FileFavorite{}).
		Where("owner_id = ? AND node_id = ?", rootModel.OwnerID, fileNode.ID).
		Count(&ownedFavoriteCount).Error; err != nil {
		t.Fatal(err)
	}
	if ownedFavoriteCount != 1 {
		t.Fatalf("foreign DELETE modified A's persisted favorite: count=%d", ownedFavoriteCount)
	}
	res = request(t, router, http.MethodGet, "/api/v1/file-favorites", tokenA, nil, http.StatusOK)
	var afterForeignDelete []fileFavoriteItemDTO
	if err := json.Unmarshal(res.Body.Bytes(), &afterForeignDelete); err != nil {
		t.Fatal(err)
	}
	if len(afterForeignDelete) != 1 || afterForeignDelete[0].Node.ID != fileNode.ID ||
		afterForeignDelete[0].Node.Revision != fileNode.Revision {
		t.Fatalf("foreign DELETE altered A's favorite Node identity: %+v", afterForeignDelete)
	}

	if err := db.Model(&meta.Node{}).
		Where("id = ?", fileNode.ID).
		Updates(map[string]any{
			"parent_id":  archive.ID,
			"name":       "final.pdf",
			"revision":   gorm.Expr("revision + 1"),
			"updated_at": time.Now(),
		}).Error; err != nil {
		t.Fatal(err)
	}
	res = request(
		t,
		router,
		http.MethodGet,
		"/api/v1/file-favorites",
		tokenA,
		nil,
		http.StatusOK,
	)
	var moved []fileFavoriteItemDTO
	if err := json.Unmarshal(res.Body.Bytes(), &moved); err != nil {
		t.Fatal(err)
	}
	if len(moved) != 1 || moved[0].Path != "Archive/final.pdf" || len(moved[0].Crumbs) != 3 {
		t.Fatalf("favorite did not resolve live path: %+v", moved)
	}

	deletedAt := time.Now()
	if err := db.Model(&meta.Node{}).
		Where("id = ?", fileNode.ID).
		Updates(map[string]any{
			"deleted_at":    &deletedAt,
			"trash_root_id": fileNode.ID,
		}).Error; err != nil {
		t.Fatal(err)
	}
	res = request(
		t,
		router,
		http.MethodGet,
		"/api/v1/file-favorites",
		tokenA,
		nil,
		http.StatusOK,
	)
	var hidden []fileFavoriteItemDTO
	if err := json.Unmarshal(res.Body.Bytes(), &hidden); err != nil {
		t.Fatal(err)
	}
	if len(hidden) != 0 {
		t.Fatalf("trashed favorite should be hidden: %+v", hidden)
	}

	if err := db.Model(&meta.Node{}).
		Where("id = ?", fileNode.ID).
		Updates(map[string]any{
			"deleted_at":    nil,
			"trash_root_id": nil,
		}).Error; err != nil {
		t.Fatal(err)
	}
	res = request(
		t,
		router,
		http.MethodGet,
		"/api/v1/file-favorites",
		tokenA,
		nil,
		http.StatusOK,
	)
	var restored []fileFavoriteItemDTO
	if err := json.Unmarshal(res.Body.Bytes(), &restored); err != nil {
		t.Fatal(err)
	}
	if len(restored) != 1 || restored[0].Node.ID != fileNode.ID {
		t.Fatalf("restored favorite did not reappear: %+v", restored)
	}

	request(
		t,
		router,
		http.MethodDelete,
		fmt.Sprintf("/api/v1/file-favorites/%d", fileNode.ID),
		tokenA,
		nil,
		http.StatusNoContent,
	)
	// Both layouts' one Web XDriveApi handles 204 with no JSON body.
	// Repeating the same owner's DELETE remains safely idempotent.
	request(t, router, http.MethodDelete,
		fmt.Sprintf("/api/v1/file-favorites/%d", fileNode.ID),
		tokenA, nil, http.StatusNoContent)
	var retainedFile meta.Node
	if err := db.First(&retainedFile, fileNode.ID).Error; err != nil {
		t.Fatalf("unfavorite removed the underlying Node: %v", err)
	}
	if retainedFile.ID != fileNode.ID {
		t.Fatalf("unfavorite changed the original Node ID: %d", retainedFile.ID)
	}
	res = request(
		t,
		router,
		http.MethodGet,
		"/api/v1/file-favorites",
		tokenA,
		nil,
		http.StatusOK,
	)
	var empty []fileFavoriteItemDTO
	if err := json.Unmarshal(res.Body.Bytes(), &empty); err != nil {
		t.Fatal(err)
	}
	if len(empty) != 0 {
		t.Fatalf("unfavorite did not remove item: %+v", empty)
	}
}
