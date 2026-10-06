package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestChildrenCursorPaginationSortingAndIsolation(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(
		&meta.AuditEvent{}, &meta.Share{}, &meta.UploadPart{}, &meta.UploadSession{},
		&meta.ContentBlob{}, &meta.FileVersion{}, &meta.File{}, &meta.Node{},
		&meta.RefreshToken{}, &meta.User{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{},
		&meta.FileVersion{}, &meta.ContentBlob{}, &meta.Share{},
		&meta.UploadSession{}, &meta.UploadPart{}, &meta.AuditEvent{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error; err != nil {
		t.Fatal(err)
	}

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	router := (&Server{
		DB: db, Store: store, Auth: auth.New("children-pagination-secret", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost", MaxUploadBytes: 10 << 20,
	}).Router()

	tokenA := createTestUser(t, db, router, "page-alice", "password-a")
	tokenB := createTestUser(t, db, router, "page-bob", "password-b")
	rootA := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", tokenA, nil, http.StatusOK)
	rootB := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", tokenB, nil, http.StatusOK)

	var alice meta.User
	if err := db.Where("username = ?", "page-alice").First(&alice).Error; err != nil {
		t.Fatal(err)
	}
	baseTime := time.Date(2026, 10, 1, 2, 0, 0, 0, time.UTC)
	createDir := func(name string, offset int) {
		node := meta.Node{
			ParentID: &rootA.ID, Name: name, Type: meta.NodeTypeDir, OwnerID: alice.ID,
			CreatedAt: baseTime.Add(time.Duration(offset) * time.Minute),
			UpdatedAt: baseTime.Add(time.Duration(offset) * time.Minute),
		}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
	}
	createFile := func(name string, size int64, offset int) {
		node := meta.Node{
			ParentID: &rootA.ID, Name: name, Type: meta.NodeTypeFile, OwnerID: alice.ID,
			CreatedAt: baseTime.Add(time.Duration(offset) * time.Minute),
			UpdatedAt: baseTime.Add(time.Duration(offset) * time.Minute),
		}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.File{
			NodeID: node.ID, Size: size, StorageKey: fmt.Sprintf("test/%d", node.ID),
			SHA256:    fmt.Sprintf("%064d", node.ID),
			CreatedAt: node.CreatedAt, UpdatedAt: node.UpdatedAt,
		}).Error; err != nil {
			t.Fatal(err)
		}
	}

	createDir("AlphaDir", 1)
	createDir("ZuluDir", 2)
	emptyDir := meta.Node{
		ParentID: &rootA.ID, Name: "EmptyDir", Type: meta.NodeTypeDir, OwnerID: alice.ID,
		CreatedAt: baseTime.Add(8 * time.Minute), UpdatedAt: baseTime.Add(8 * time.Minute),
	}
	if err := db.Create(&emptyDir).Error; err != nil {
		t.Fatal(err)
	}
	createFile("a.txt", 10, 3)
	createFile("b.txt", 50, 4)
	createFile("c.pdf", 30, 5)
	createFile("d.log", 20, 6)
	createFile("e.zip", 40, 7)

	legacy := request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/nodes/%d/children", rootA.ID), tokenA, nil, http.StatusOK)
	var legacyItems []nodeDTO
	if err := json.Unmarshal(legacy.Body.Bytes(), &legacyItems); err != nil {
		t.Fatalf("legacy children must remain an array: %v body=%s", err, legacy.Body.String())
	}
	if len(legacyItems) != 8 {
		t.Fatalf("legacy children len=%d want=8", len(legacyItems))
	}

	readPage := func(path string, wantStatus int) childrenPageDTO {
		res := request(t, router, http.MethodGet, path, tokenA, nil, wantStatus)
		if wantStatus != http.StatusOK {
			return childrenPageDTO{}
		}
		var page childrenPageDTO
		if err := json.Unmarshal(res.Body.Bytes(), &page); err != nil {
			t.Fatalf("decode page: %v body=%s", err, res.Body.String())
		}
		return page
	}

	exactPage := readPage(fmt.Sprintf(
		"/api/v1/nodes/%d/children?limit=1&sort=name&order=asc&name=%s",
		rootA.ID, url.QueryEscape("AlphaDir"),
	), http.StatusOK)
	if len(exactPage.Items) != 1 || exactPage.Items[0].Name != "AlphaDir" || exactPage.HasMore || exactPage.NextCursor != "" {
		t.Fatalf("exact-name page=%+v", exactPage)
	}
	caseMismatch := readPage(fmt.Sprintf(
		"/api/v1/nodes/%d/children?limit=1&name=%s",
		rootA.ID, url.QueryEscape("alphadir"),
	), http.StatusOK)
	if len(caseMismatch.Items) != 0 {
		t.Fatalf("exact-name filter must remain case-sensitive: %+v", caseMismatch.Items)
	}
	foldedPage := readPage(fmt.Sprintf(
		"/api/v1/nodes/%d/children?limit=1&name_ci=%s",
		rootA.ID, url.QueryEscape("alphadir"),
	), http.StatusOK)
	if len(foldedPage.Items) != 1 || foldedPage.Items[0].Name != "AlphaDir" || foldedPage.HasMore || foldedPage.NextCursor != "" {
		t.Fatalf("case-insensitive-name page=%+v", foldedPage)
	}

	page1 := readPage(fmt.Sprintf("/api/v1/nodes/%d/children?limit=3&sort=name&order=asc", rootA.ID), http.StatusOK)
	if got := []string{page1.Items[0].Name, page1.Items[1].Name, page1.Items[2].Name}; fmt.Sprint(got) != fmt.Sprint([]string{"AlphaDir", "EmptyDir", "ZuluDir"}) {
		t.Fatalf("page1 order=%v", got)
	}
	if !page1.HasMore || page1.NextCursor == "" || page1.Sort != "name" || page1.Order != "asc" {
		t.Fatalf("unexpected page1 metadata: %+v", page1)
	}

	page2 := readPage(fmt.Sprintf(
		"/api/v1/nodes/%d/children?limit=3&sort=name&order=asc&cursor=%s",
		rootA.ID, url.QueryEscape(page1.NextCursor),
	), http.StatusOK)
	page3 := readPage(fmt.Sprintf(
		"/api/v1/nodes/%d/children?limit=3&sort=name&order=asc&cursor=%s",
		rootA.ID, url.QueryEscape(page2.NextCursor),
	), http.StatusOK)

	names := make([]string, 0, 8)
	seen := map[uint64]bool{}
	for _, page := range []childrenPageDTO{page1, page2, page3} {
		for _, item := range page.Items {
			if seen[item.ID] {
				t.Fatalf("duplicate node across pages: %d", item.ID)
			}
			seen[item.ID] = true
			names = append(names, item.Name)
		}
	}
	wantNames := []string{"AlphaDir", "EmptyDir", "ZuluDir", "a.txt", "b.txt", "c.pdf", "d.log", "e.zip"}
	if fmt.Sprint(names) != fmt.Sprint(wantNames) {
		t.Fatalf("paged names=%v want=%v", names, wantNames)
	}
	if page3.HasMore || page3.NextCursor != "" {
		t.Fatalf("last page should be terminal: %+v", page3)
	}

	sizePage := readPage(fmt.Sprintf("/api/v1/nodes/%d/children?limit=8&sort=size&order=desc", rootA.ID), http.StatusOK)
	sizeNames := make([]string, 0, len(sizePage.Items))
	for _, item := range sizePage.Items {
		sizeNames = append(sizeNames, item.Name)
	}
	wantSize := []string{"ZuluDir", "EmptyDir", "AlphaDir", "b.txt", "e.zip", "c.pdf", "d.log", "a.txt"}
	if fmt.Sprint(sizeNames) != fmt.Sprint(wantSize) {
		t.Fatalf("size desc names=%v want=%v", sizeNames, wantSize)
	}

	emptyPage := readPage(fmt.Sprintf(
		"/api/v1/nodes/%d/children?limit=3&sort=name&order=asc", emptyDir.ID,
	), http.StatusOK)
	if len(emptyPage.Items) != 0 || emptyPage.HasMore || emptyPage.NextCursor != "" {
		t.Fatalf("empty directory page should be empty and terminal: %+v", emptyPage)
	}

	readRange := func(path string, wantStatus int) childrenRangeDTO {
		res := request(t, router, http.MethodGet, path, tokenA, nil, wantStatus)
		if wantStatus != http.StatusOK {
			return childrenRangeDTO{}
		}
		var page childrenRangeDTO
		if err := json.Unmarshal(res.Body.Bytes(), &page); err != nil {
			t.Fatalf("decode range: %v body=%s", err, res.Body.String())
		}
		return page
	}

	range1 := readRange(fmt.Sprintf(
		"/api/v1/nodes/%d/children?offset=0&limit=3&sort=name&order=asc",
		rootA.ID,
	), http.StatusOK)
	if range1.TotalCount != 8 || range1.Offset != 0 || range1.Limit != 3 ||
		range1.Sort != "name" || range1.Order != "asc" {
		t.Fatalf("unexpected range1 metadata: %+v", range1)
	}
	if got := []string{range1.Items[0].Name, range1.Items[1].Name, range1.Items[2].Name}; fmt.Sprint(got) != fmt.Sprint([]string{"AlphaDir", "EmptyDir", "ZuluDir"}) {
		t.Fatalf("range1 order=%v", got)
	}

	range2 := readRange(fmt.Sprintf(
		"/api/v1/nodes/%d/children?offset=3&limit=3&sort=name&order=asc",
		rootA.ID,
	), http.StatusOK)
	if range2.TotalCount != 8 || range2.Offset != 3 || range2.Limit != 3 {
		t.Fatalf("unexpected range2 metadata: %+v", range2)
	}
	if got := []string{range2.Items[0].Name, range2.Items[1].Name, range2.Items[2].Name}; fmt.Sprint(got) != fmt.Sprint([]string{"a.txt", "b.txt", "c.pdf"}) {
		t.Fatalf("range2 order=%v", got)
	}

	lastRange := readRange(fmt.Sprintf(
		"/api/v1/nodes/%d/children?offset=7&limit=3&sort=name&order=asc",
		rootA.ID,
	), http.StatusOK)
	if lastRange.TotalCount != 8 || lastRange.Offset != 7 || lastRange.Limit != 3 ||
		len(lastRange.Items) != 1 || lastRange.Items[0].Name != "e.zip" {
		t.Fatalf("unexpected final range: %+v", lastRange)
	}

	pastEnd := readRange(fmt.Sprintf(
		"/api/v1/nodes/%d/children?offset=20&limit=3&sort=name&order=asc",
		rootA.ID,
	), http.StatusOK)
	if pastEnd.TotalCount != 8 || pastEnd.Offset != 20 || pastEnd.Limit != 3 || len(pastEnd.Items) != 0 {
		t.Fatalf("out-of-range window must preserve total and requested width: %+v", pastEnd)
	}

	emptyRange := readRange(fmt.Sprintf(
		"/api/v1/nodes/%d/children?offset=0&limit=3&sort=name&order=asc",
		emptyDir.ID,
	), http.StatusOK)
	if emptyRange.TotalCount != 0 || emptyRange.Offset != 0 || emptyRange.Limit != 3 || len(emptyRange.Items) != 0 {
		t.Fatalf("empty range=%+v", emptyRange)
	}

	readPage(fmt.Sprintf(
		"/api/v1/nodes/%d/children?limit=3&sort=size&order=asc&cursor=%s",
		rootA.ID, url.QueryEscape(page1.NextCursor),
	), http.StatusBadRequest)
	readPage(fmt.Sprintf(
		"/api/v1/nodes/%d/children?limit=1&name=%s&cursor=%s",
		rootA.ID, url.QueryEscape("AlphaDir"), url.QueryEscape(page1.NextCursor),
	), http.StatusBadRequest)
	readPage(fmt.Sprintf(
		"/api/v1/nodes/%d/children?limit=1&name_ci=%s&cursor=%s",
		rootA.ID, url.QueryEscape("alphadir"), url.QueryEscape(page1.NextCursor),
	), http.StatusBadRequest)
	readPage(fmt.Sprintf(
		"/api/v1/nodes/%d/children?limit=1&name=%s&name_ci=%s",
		rootA.ID, url.QueryEscape("AlphaDir"), url.QueryEscape("alphadir"),
	), http.StatusBadRequest)
	readPage(fmt.Sprintf("/api/v1/nodes/%d/children?limit=0", rootA.ID), http.StatusBadRequest)
	readRange(fmt.Sprintf("/api/v1/nodes/%d/children?offset=-1&limit=3", rootA.ID), http.StatusBadRequest)
	readRange(fmt.Sprintf(
		"/api/v1/nodes/%d/children?offset=0&limit=3&cursor=%s",
		rootA.ID, url.QueryEscape(page1.NextCursor),
	), http.StatusBadRequest)
	readRange(fmt.Sprintf(
		"/api/v1/nodes/%d/children?offset=0&limit=1&name=%s",
		rootA.ID, url.QueryEscape("AlphaDir"),
	), http.StatusBadRequest)
	readRange(fmt.Sprintf(
		"/api/v1/nodes/%d/children?offset=0&limit=1&name_ci=%s",
		rootA.ID, url.QueryEscape("alphadir"),
	), http.StatusBadRequest)
	request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/nodes/%d/children?limit=2", rootB.ID), tokenA, nil, http.StatusNotFound)
	request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/nodes/%d/children?offset=0&limit=2", rootB.ID), tokenA, nil, http.StatusNotFound)
}
