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

func TestServerSideSearchPaginationTypeAndIsolation(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)

	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "server_search_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}, &meta.AuditEvent{},
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
		Auth:           auth.New("search-test-secret", time.Hour),
		RefreshTTL:     24 * time.Hour,
		AllowedOrigin:  "http://localhost",
		MaxUploadBytes: 10 << 20,
	}).Router()

	tokenA := createTestUser(t, db, router, "search-a", "password-a")
	rootA := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", tokenA, nil, http.StatusOK)
	projects := requestNode(t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", rootA.ID), tokenA, strings.NewReader(`{"name":"Projects"}`), http.StatusCreated)
	reports := requestNode(t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", projects.ID), tokenA, strings.NewReader(`{"name":"Reports"}`), http.StatusCreated)
	archive := requestNode(t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", rootA.ID), tokenA, strings.NewReader(`{"name":"Archive"}`), http.StatusCreated)

	alpha := createSearchFile(t, db, reports.ID, "Alpha Report.pdf", 10)
	beta := createSearchFile(t, db, reports.ID, "Beta Report.pdf", 20)
	gamma := createSearchFile(t, db, archive.ID, "Gamma Report.pdf", 30)
	_ = alpha
	_ = beta
	_ = gamma

	deletedAt := time.Now().UTC()
	deleted := createSearchFile(t, db, projects.ID, "Deleted Report.pdf", 40)
	if err := db.Model(&meta.Node{}).Where("id = ?", deleted.ID).Update("deleted_at", deletedAt).Error; err != nil {
		t.Fatal(err)
	}

	tokenB := createTestUser(t, db, router, "search-b", "password-b")
	rootB := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", tokenB, nil, http.StatusOK)
	privateDir := requestNode(t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", rootB.ID), tokenB, strings.NewReader(`{"name":"Projects"}`), http.StatusCreated)
	createSearchFile(t, db, privateDir.ID, "Private Report.pdf", 99)

	res := request(t, router, http.MethodGet, "/api/v1/search?q=report&type=file&limit=2", tokenA, nil, http.StatusOK)
	var first searchPageDTO
	if err := json.Unmarshal(res.Body.Bytes(), &first); err != nil {
		t.Fatal(err)
	}
	if len(first.Items) != 2 || first.NextCursor == "" {
		t.Fatalf("first page=%+v", first)
	}
	for _, item := range first.Items {
		if item.Node.Type != meta.NodeTypeFile {
			t.Fatalf("type filter leaked %q", item.Node.Type)
		}
		if strings.Contains(item.Path, "Deleted") || strings.Contains(item.Path, "Private") {
			t.Fatalf("search leaked deleted/cross-user item: %+v", item)
		}
		if len(item.Breadcrumbs) == 0 || item.Breadcrumbs[0].ID != rootA.ID {
			t.Fatalf("missing root breadcrumb: %+v", item)
		}
		if item.Breadcrumbs[0].Name != "" {
			t.Fatalf("server localized root breadcrumb unexpectedly: %+v", item.Breadcrumbs)
		}
	}

	secondURL := "/api/v1/search?q=report&type=file&limit=2&cursor=" + url.QueryEscape(first.NextCursor)
	res = request(t, router, http.MethodGet, secondURL, tokenA, nil, http.StatusOK)
	var second searchPageDTO
	if err := json.Unmarshal(res.Body.Bytes(), &second); err != nil {
		t.Fatal(err)
	}
	if len(second.Items) != 1 || second.NextCursor != "" {
		t.Fatalf("second page=%+v", second)
	}
	seen := map[uint64]bool{}
	for _, item := range append(append([]searchResultDTO(nil), first.Items...), second.Items...) {
		if seen[item.Node.ID] {
			t.Fatalf("pagination duplicated node %d", item.Node.ID)
		}
		seen[item.Node.ID] = true
	}
	if len(seen) != 3 {
		t.Fatalf("unique search results=%d want=3", len(seen))
	}

	request(t, router, http.MethodGet,
		"/api/v1/search?q=other&type=file&limit=2&cursor="+url.QueryEscape(first.NextCursor),
		tokenA, nil, http.StatusBadRequest)

	res = request(t, router, http.MethodGet, "/api/v1/search?q=projects&type=dir", tokenA, nil, http.StatusOK)
	var dirs searchPageDTO
	if err := json.Unmarshal(res.Body.Bytes(), &dirs); err != nil {
		t.Fatal(err)
	}
	if len(dirs.Items) != 2 {
		t.Fatalf("path search directory results=%+v", dirs)
	}
	if dirs.Items[0].Node.Type != meta.NodeTypeDir || dirs.Items[1].Node.Type != meta.NodeTypeDir {
		t.Fatalf("directory filter returned non-directory: %+v", dirs)
	}

	res = request(t, router, http.MethodGet, "/api/v1/search?q=projects&type=file&limit=200", tokenA, nil, http.StatusOK)
	var projectFiles searchPageDTO
	if err := json.Unmarshal(res.Body.Bytes(), &projectFiles); err != nil {
		t.Fatal(err)
	}
	if len(projectFiles.Items) != 2 {
		t.Fatalf("full-path search should match active descendants under Projects: %+v", projectFiles)
	}
	for _, item := range projectFiles.Items {
		if !strings.HasPrefix(item.Path, "Projects/Reports/") {
			t.Fatalf("unexpected project path %q", item.Path)
		}
		if len(item.Breadcrumbs) != 3 ||
			item.Breadcrumbs[1].ID != projects.ID ||
			item.Breadcrumbs[2].ID != reports.ID {
			t.Fatalf("unexpected file breadcrumbs for %q: %+v", item.Path, item.Breadcrumbs)
		}
	}

	request(t, router, http.MethodGet, "/api/v1/search?q=x", tokenA, nil, http.StatusBadRequest)
	request(t, router, http.MethodGet, "/api/v1/search?q=report&type=other", tokenA, nil, http.StatusBadRequest)
	request(t, router, http.MethodGet, "/api/v1/search?q=report&limit=201", tokenA, nil, http.StatusBadRequest)
	request(t, router, http.MethodGet, "/api/v1/search?q=report&cursor=bad", tokenA, nil, http.StatusBadRequest)
}

func createSearchFile(t *testing.T, db *gorm.DB, parentID uint64, name string, size int64) meta.Node {
	t.Helper()
	var parent meta.Node
	if err := db.First(&parent, parentID).Error; err != nil {
		t.Fatal(err)
	}
	node := meta.Node{
		ParentID: &parentID,
		Name:     name,
		Type:     meta.NodeTypeFile,
		OwnerID:  parent.OwnerID,
		Revision: 1,
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{
		NodeID:     node.ID,
		Size:       size,
		StorageKey: fmt.Sprintf("test/%d", node.ID),
		SHA256:     fmt.Sprintf("%064x", node.ID),
	}).Error; err != nil {
		t.Fatal(err)
	}
	return node
}
