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

func TestChildrenCursorPaginationAndSorting(t *testing.T) {
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

	tokenA := createTestUser(t, db, router, "page-user-a", "password-a")
	tokenB := createTestUser(t, db, router, "page-user-b", "password-b")
	rootA := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", tokenA, nil, http.StatusOK)
	rootB := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", tokenB, nil, http.StatusOK)

	var ownerA meta.User
	if err := db.Where("username = ?", "page-user-a").First(&ownerA).Error; err != nil {
		t.Fatal(err)
	}

	parentID := rootA.ID
	baseTime := time.Now().UTC().Add(-time.Hour)
	nodes := make([]meta.Node, 0, 230)
	for i := 0; i < 5; i++ {
		nodes = append(nodes, meta.Node{
			ParentID: &parentID, Name: fmt.Sprintf("Folder-%02d", i), Type: meta.NodeTypeDir,
			OwnerID: ownerA.ID, Revision: 1, CreatedAt: baseTime, UpdatedAt: baseTime.Add(time.Duration(i) * time.Second),
		})
	}
	for i := 0; i < 225; i++ {
		nodes = append(nodes, meta.Node{
			ParentID: &parentID, Name: fmt.Sprintf("file-%03d.%s", i, []string{"txt", "pdf", "jpg"}[i%3]),
			Type: meta.NodeTypeFile, OwnerID: ownerA.ID, Revision: 1,
			CreatedAt: baseTime, UpdatedAt: baseTime.Add(time.Duration(100+i) * time.Second),
		})
	}
	if err := db.Create(&nodes).Error; err != nil {
		t.Fatal(err)
	}
	files := make([]meta.File, 0, 225)
	for i := 5; i < len(nodes); i++ {
		files = append(files, meta.File{
			NodeID: nodes[i].ID,
			Size: int64((i - 4) * 17),
			StorageKey: fmt.Sprintf("test/page/%d", nodes[i].ID),
			CreatedAt: nodes[i].CreatedAt,
			UpdatedAt: nodes[i].UpdatedAt,
		})
	}
	if err := db.Create(&files).Error; err != nil {
		t.Fatal(err)
	}

	legacy := request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/nodes/%d/children", rootA.ID), tokenA, nil, http.StatusOK)
	var legacyItems []nodeDTO
	if err := json.Unmarshal(legacy.Body.Bytes(), &legacyItems); err != nil {
		t.Fatal(err)
	}
	if len(legacyItems) != 230 {
		t.Fatalf("legacy children count=%d want=230", len(legacyItems))
	}

	cursor := ""
	seen := map[uint64]bool{}
	var firstCursor string
	seenFile := false
	for {
		path := fmt.Sprintf("/api/v1/nodes/%d/children?limit=37&sort=name&order=asc", rootA.ID)
		if cursor != "" {
			path += "&cursor=" + url.QueryEscape(cursor)
		}
		res := request(t, router, http.MethodGet, path, tokenA, nil, http.StatusOK)
		var page childrenPageDTO
		if err := json.Unmarshal(res.Body.Bytes(), &page); err != nil {
			t.Fatal(err)
		}
		if page.Sort != "name" || page.Order != "asc" {
			t.Fatalf("unexpected sort echo: %+v", page)
		}
		if len(page.Items) == 0 || len(page.Items) > 37 {
			t.Fatalf("page item count=%d", len(page.Items))
		}
		for _, item := range page.Items {
			if seen[item.ID] {
				t.Fatalf("duplicate item across pages: %d", item.ID)
			}
			seen[item.ID] = true
			if item.Type == meta.NodeTypeFile {
				seenFile = true
			} else if seenFile {
				t.Fatalf("directory %q appeared after files", item.Name)
			}
		}
		if firstCursor == "" {
			firstCursor = page.NextCursor
		}
		if !page.HasMore {
			if page.NextCursor != "" {
				t.Fatalf("final page should not expose a cursor")
			}
			break
		}
		if page.NextCursor == "" {
			t.Fatal("paged response is missing next_cursor")
		}
		cursor = page.NextCursor
	}
	if len(seen) != 230 {
		t.Fatalf("paginated children count=%d want=230", len(seen))
	}

	sizeRes := request(
		t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/nodes/%d/children?limit=12&sort=size&order=desc", rootA.ID),
		tokenA, nil, http.StatusOK,
	)
	var sizePage childrenPageDTO
	if err := json.Unmarshal(sizeRes.Body.Bytes(), &sizePage); err != nil {
		t.Fatal(err)
	}
	lastSize := int64(1<<62 - 1)
	for _, item := range sizePage.Items {
		if item.Type == meta.NodeTypeDir {
			continue
		}
		if item.Size > lastSize {
			t.Fatalf("size order is not descending: %d after %d", item.Size, lastSize)
		}
		lastSize = item.Size
	}

	request(
		t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/nodes/%d/children?limit=37&sort=name&order=asc&cursor=%s", rootB.ID, url.QueryEscape(firstCursor)),
		tokenB, nil, http.StatusBadRequest,
	)
	request(
		t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/nodes/%d/children?limit=37&sort=name&order=asc&cursor=%s", rootB.ID, url.QueryEscape(firstCursor)),
		tokenA, nil, http.StatusNotFound,
	)
	request(
		t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/nodes/%d/children?limit=37&sort=bogus&order=asc", rootA.ID),
		tokenA, nil, http.StatusBadRequest,
	)
}
