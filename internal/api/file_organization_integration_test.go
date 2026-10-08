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

func TestFileOrganizationTagsSavedSearchesAndSidebarOrder(t *testing.T) {
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

	schema := "file_organization_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		&meta.FileTag{},
		&meta.FileNodeTag{},
		&meta.FileSavedSearch{},
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
		Auth:           auth.New("file-organization-test-secret", time.Hour),
		RefreshTTL:     24 * time.Hour,
		AllowedOrigin:  "http://localhost",
		MaxUploadBytes: 10 << 20,
	}).Router()

	tokenA := createTestUser(t, db, router, "organization-a", "password-a")
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
	report := createSearchFile(t, db, projects.ID, "Report.pdf", 64)

	res := request(
		t, router, http.MethodPost, "/api/v1/file-tags", tokenA,
		strings.NewReader(`{"name":"Work","color":"#3366CC"}`),
		http.StatusCreated,
	)
	var tag fileTagDTO
	if err := json.Unmarshal(res.Body.Bytes(), &tag); err != nil {
		t.Fatal(err)
	}
	if tag.Name != "Work" || tag.Color != "#3366CC" || tag.ID == 0 {
		t.Fatalf("unexpected tag: %+v", tag)
	}

	request(
		t, router, http.MethodPut,
		fmt.Sprintf("/api/v1/file-tags/%d/nodes", tag.ID),
		tokenA,
		strings.NewReader(fmt.Sprintf(`{"node_ids":[%d,%d]}`, projects.ID, report.ID)),
		http.StatusOK,
	)

	res = request(
		t, router, http.MethodPost, "/api/v1/nodes/tags/query", tokenA,
		strings.NewReader(fmt.Sprintf(`{"node_ids":[%d,%d]}`, projects.ID, report.ID)),
		http.StatusOK,
	)
	var nodeTags []fileNodeTagsDTO
	if err := json.Unmarshal(res.Body.Bytes(), &nodeTags); err != nil {
		t.Fatal(err)
	}
	if len(nodeTags) != 2 || len(nodeTags[0].Tags) != 1 || len(nodeTags[1].Tags) != 1 {
		t.Fatalf("tag assignment missing: %+v", nodeTags)
	}

	res = request(
		t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/search?tag_id=%d&offset=0&limit=20&sort=name&order=asc", tag.ID),
		tokenA, nil, http.StatusOK,
	)
	var tagged searchRangeDTO
	if err := json.Unmarshal(res.Body.Bytes(), &tagged); err != nil {
		t.Fatal(err)
	}
	if tagged.TotalCount != 2 || len(tagged.Items) != 2 {
		t.Fatalf("tag search did not stay server-side: %+v", tagged)
	}
	taggedIDs := map[uint64]bool{}
	for _, item := range tagged.Items {
		taggedIDs[item.Node.ID] = true
	}
	if !taggedIDs[projects.ID] || !taggedIDs[report.ID] {
		t.Fatalf("tag search returned wrong nodes: %+v", tagged.Items)
	}

	res = request(
		t, router, http.MethodPost, "/api/v1/file-saved-searches", tokenA,
		strings.NewReader(fmt.Sprintf(
			`{"name":"Work items","query":"","filters":{"tagID":%d}}`,
			tag.ID,
		)),
		http.StatusCreated,
	)
	var saved fileSavedSearchDTO
	if err := json.Unmarshal(res.Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if saved.ID == 0 || saved.Name != "Work items" || saved.Filters.TagID != tag.ID {
		t.Fatalf("unexpected saved search: %+v", saved)
	}

	res = request(
		t, router, http.MethodPatch,
		fmt.Sprintf("/api/v1/file-saved-searches/%d", saved.ID),
		tokenA,
		strings.NewReader(fmt.Sprintf(
			`{"name":"Work PDF","query":"","filters":{"kind":"pdf","tagID":%d}}`,
			tag.ID,
		)),
		http.StatusOK,
	)
	if err := json.Unmarshal(res.Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if saved.Name != "Work PDF" || saved.Filters.Kind != "pdf" || saved.Filters.TagID != tag.ID {
		t.Fatalf("saved search update failed: %+v", saved)
	}

	request(
		t, router, http.MethodPut,
		fmt.Sprintf("/api/v1/file-quick-access/%d", projects.ID),
		tokenA, nil, http.StatusCreated,
	)
	request(
		t, router, http.MethodPut,
		fmt.Sprintf("/api/v1/file-quick-access/%d", archive.ID),
		tokenA, nil, http.StatusCreated,
	)
	request(
		t, router, http.MethodPut, "/api/v1/file-quick-access/order", tokenA,
		strings.NewReader(fmt.Sprintf(`{"node_ids":[%d,%d]}`, archive.ID, projects.ID)),
		http.StatusNoContent,
	)

	res = request(t, router, http.MethodGet, "/api/v1/file-quick-access", tokenA, nil, http.StatusOK)
	var quick []fileQuickAccessItemDTO
	if err := json.Unmarshal(res.Body.Bytes(), &quick); err != nil {
		t.Fatal(err)
	}
	if len(quick) != 2 || quick[0].Node.ID != archive.ID || quick[0].Position != 0 ||
		quick[1].Node.ID != projects.ID || quick[1].Position != 1 {
		t.Fatalf("quick access reorder was not persisted: %+v", quick)
	}

	tokenB := createTestUser(t, db, router, "organization-b", "password-b")
	res = request(t, router, http.MethodGet, "/api/v1/file-tags", tokenB, nil, http.StatusOK)
	var isolatedTags []fileTagDTO
	if err := json.Unmarshal(res.Body.Bytes(), &isolatedTags); err != nil {
		t.Fatal(err)
	}
	if len(isolatedTags) != 0 {
		t.Fatalf("tags leaked across users: %+v", isolatedTags)
	}
	request(
		t, router, http.MethodPut,
		fmt.Sprintf("/api/v1/file-tags/%d/nodes", tag.ID),
		tokenB,
		strings.NewReader(fmt.Sprintf(`{"node_ids":[%d]}`, report.ID)),
		http.StatusNotFound,
	)
	res = request(t, router, http.MethodGet, "/api/v1/file-saved-searches", tokenB, nil, http.StatusOK)
	var isolatedSearches []fileSavedSearchDTO
	if err := json.Unmarshal(res.Body.Bytes(), &isolatedSearches); err != nil {
		t.Fatal(err)
	}
	if len(isolatedSearches) != 0 {
		t.Fatalf("saved searches leaked across users: %+v", isolatedSearches)
	}

	request(
		t, router, http.MethodDelete,
		fmt.Sprintf("/api/v1/file-tags/%d", tag.ID),
		tokenA, nil, http.StatusNoContent,
	)
	res = request(
		t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/search?tag_id=%d&offset=0&limit=20&sort=name&order=asc", tag.ID),
		tokenA, nil, http.StatusOK,
	)
	var deletedTagSearch searchRangeDTO
	if err := json.Unmarshal(res.Body.Bytes(), &deletedTagSearch); err != nil {
		t.Fatal(err)
	}
	if deletedTagSearch.TotalCount != 0 || len(deletedTagSearch.Items) != 0 {
		t.Fatalf("deleted tag still matched files: %+v", deletedTagSearch)
	}

	request(
		t, router, http.MethodDelete,
		fmt.Sprintf("/api/v1/file-saved-searches/%d", saved.ID),
		tokenA, nil, http.StatusNoContent,
	)
}
