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
		&meta.Source{}, &meta.SourceItem{},
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
	hiddenParent := requestNode(t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", rootA.ID), tokenA, strings.NewReader(`{"name":"HiddenParent"}`), http.StatusCreated)
	createSearchFile(t, db, hiddenParent.ID, "Detached Needle.txt", 50)
	hiddenAt := time.Now().UTC()
	if err := db.Model(&meta.Node{}).Where("id = ?", hiddenParent.ID).Update("deleted_at", hiddenAt).Error; err != nil {
		t.Fatal(err)
	}

	alpha := createSearchFile(t, db, reports.ID, "Alpha Report.pdf", 10)
	beta := createSearchFile(t, db, reports.ID, "Beta Report.pdf", 20)
	gamma := createSearchFile(t, db, archive.ID, "Gamma Report.pdf", 30)
	formatPDF := createSearchFile(t, db, archive.ID, "Format A.pdf", 15)
	formatTXT := createSearchFile(t, db, archive.ID, "Format B.txt", 25)
	sortBase := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	for _, item := range []struct {
		node meta.Node
		at   time.Time
	}{
		{alpha, sortBase.Add(time.Minute)},
		{gamma, sortBase.Add(2 * time.Minute)},
		{beta, sortBase.Add(3 * time.Minute)},
	} {
		if err := db.Model(&meta.Node{}).Where("id = ?", item.node.ID).Update("updated_at", item.at).Error; err != nil {
			t.Fatal(err)
		}
	}
	_ = formatPDF
	_ = formatTXT

	var alice meta.User
	if err := db.Where("username = ?", "search-a").First(&alice).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID: alice.ID, Name: "测试同步文件夹", Kind: "synology_files",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusActive, Revision: 1,
		TargetNodeID: &rootA.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.SourceItem{
		SourceID: source.ID, ExternalID: "beta-report", NodeID: &beta.ID,
		NodeRevision: beta.Revision, Kind: meta.SourceItemKindFile,
		Path: "Reports/Beta Report.pdf", Size: 20, State: meta.SourceItemStateSynced,
		LastSeenAt: time.Now().UTC(),
	}).Error; err != nil {
		t.Fatal(err)
	}

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

	res = request(t, router, http.MethodGet,
		"/api/v1/search?q=report&type=file&offset=1&limit=1&sort=name&order=asc",
		tokenA, nil, http.StatusOK)
	var rangePage searchRangeDTO
	if err := json.Unmarshal(res.Body.Bytes(), &rangePage); err != nil {
		t.Fatal(err)
	}
	if rangePage.TotalCount != 3 || rangePage.Offset != 1 || rangePage.Limit != 1 ||
		rangePage.Sort != "name" || rangePage.Order != "asc" {
		t.Fatalf("unexpected search range metadata: %+v", rangePage)
	}
	if len(rangePage.Items) != 1 || rangePage.Items[0].Node.ID != beta.ID {
		t.Fatalf("unexpected search range items: %+v", rangePage.Items)
	}

	structuredURL := fmt.Sprintf(
		"/api/v1/search?q=report&kind=pdf&modified_from=%s&min_size=15&max_size=25&source_id=%d&offset=0&limit=10&sort=name&order=asc",
		url.QueryEscape(sortBase.Add(150*time.Second).Format(time.RFC3339)),
		source.ID,
	)
	res = request(t, router, http.MethodGet, structuredURL, tokenA, nil, http.StatusOK)
	var structured searchRangeDTO
	if err := json.Unmarshal(res.Body.Bytes(), &structured); err != nil {
		t.Fatal(err)
	}
	if structured.TotalCount != 1 || len(structured.Items) != 1 || structured.Items[0].Node.ID != beta.ID {
		t.Fatalf("structured filters=%+v", structured)
	}

	res = request(t, router, http.MethodGet,
		"/api/v1/search?kind=pdf&min_size=20&offset=0&limit=10&sort=name&order=asc",
		tokenA, nil, http.StatusOK)
	var filterOnly searchRangeDTO
	if err := json.Unmarshal(res.Body.Bytes(), &filterOnly); err != nil {
		t.Fatal(err)
	}
	if filterOnly.TotalCount != 2 {
		t.Fatalf("filter-only total=%d want=2 items=%+v", filterOnly.TotalCount, filterOnly.Items)
	}
	for _, item := range filterOnly.Items {
		if item.Node.Type != meta.NodeTypeFile || !strings.HasSuffix(strings.ToLower(item.Node.Name), ".pdf") || item.Node.Size < 20 {
			t.Fatalf("filter-only leaked item=%+v", item)
		}
	}

	res = request(t, router, http.MethodGet,
		"/api/v1/search?q=report&type=file&offset=99&limit=1&sort=name&order=asc",
		tokenA, nil, http.StatusOK)
	var emptyRange searchRangeDTO
	if err := json.Unmarshal(res.Body.Bytes(), &emptyRange); err != nil {
		t.Fatal(err)
	}
	if len(emptyRange.Items) != 0 || emptyRange.TotalCount != 3 || emptyRange.Offset != 99 {
		t.Fatalf("unexpected empty search range: %+v", emptyRange)
	}

	request(t, router, http.MethodGet,
		"/api/v1/search?q=report&type=file&offset=-1&limit=1",
		tokenA, nil, http.StatusBadRequest)
	request(t, router, http.MethodGet,
		"/api/v1/search?q=report&type=file&offset=0&limit=1&cursor="+url.QueryEscape(first.NextCursor),
		tokenA, nil, http.StatusBadRequest)
	request(t, router, http.MethodGet,
		"/api/v1/search?q=report&type=file&limit=1&group=type",
		tokenA, nil, http.StatusBadRequest)
	request(t, router, http.MethodGet,
		"/api/v1/search?q=report&type=file&offset=0&limit=1&group=unknown",
		tokenA, nil, http.StatusBadRequest)
	request(t, router, http.MethodGet,
		"/api/v1/search?q=report&type=file&offset=0&limit=1&folders_first=maybe",
		tokenA, nil, http.StatusBadRequest)

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

	res = request(t, router, http.MethodGet, "/api/v1/search?q=report&type=file&sort=size&order=desc&limit=1", tokenA, nil, http.StatusOK)
	var sizeFirst searchPageDTO
	if err := json.Unmarshal(res.Body.Bytes(), &sizeFirst); err != nil {
		t.Fatal(err)
	}
	if len(sizeFirst.Items) != 1 || sizeFirst.Items[0].Node.ID != gamma.ID || sizeFirst.NextCursor == "" {
		t.Fatalf("size-desc first page=%+v", sizeFirst)
	}
	res = request(t, router, http.MethodGet,
		"/api/v1/search?q=report&type=file&sort=size&order=desc&limit=1&cursor="+url.QueryEscape(sizeFirst.NextCursor),
		tokenA, nil, http.StatusOK)
	var sizeSecond searchPageDTO
	if err := json.Unmarshal(res.Body.Bytes(), &sizeSecond); err != nil {
		t.Fatal(err)
	}
	if len(sizeSecond.Items) != 1 || sizeSecond.Items[0].Node.ID != beta.ID {
		t.Fatalf("size-desc second page=%+v", sizeSecond)
	}

	res = request(t, router, http.MethodGet, "/api/v1/search?q=report&type=file&sort=updated&order=desc&limit=3", tokenA, nil, http.StatusOK)
	var updated searchPageDTO
	if err := json.Unmarshal(res.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if len(updated.Items) != 3 {
		t.Fatalf("updated-desc results=%+v", updated.Items)
	}
	if got := []uint64{updated.Items[0].Node.ID, updated.Items[1].Node.ID, updated.Items[2].Node.ID}; fmt.Sprint(got) != fmt.Sprint([]uint64{beta.ID, gamma.ID, alpha.ID}) {
		t.Fatalf("updated-desc ids=%v", got)
	}

	res = request(t, router, http.MethodGet, "/api/v1/search?q=report&type=file&sort=name&order=desc&limit=3", tokenA, nil, http.StatusOK)
	var namesDesc searchPageDTO
	if err := json.Unmarshal(res.Body.Bytes(), &namesDesc); err != nil {
		t.Fatal(err)
	}
	if len(namesDesc.Items) != 3 {
		t.Fatalf("name-desc results=%+v", namesDesc.Items)
	}
	if got := []string{namesDesc.Items[0].Node.Name, namesDesc.Items[1].Node.Name, namesDesc.Items[2].Node.Name}; fmt.Sprint(got) != fmt.Sprint([]string{"Gamma Report.pdf", "Beta Report.pdf", "Alpha Report.pdf"}) {
		t.Fatalf("name-desc names=%v", got)
	}

	res = request(t, router, http.MethodGet, "/api/v1/search?q=format&type=file&sort=type&order=asc&limit=10", tokenA, nil, http.StatusOK)
	var typesAsc searchPageDTO
	if err := json.Unmarshal(res.Body.Bytes(), &typesAsc); err != nil {
		t.Fatal(err)
	}
	if len(typesAsc.Items) != 2 || typesAsc.Items[0].Node.ID != formatPDF.ID || typesAsc.Items[1].Node.ID != formatTXT.ID {
		t.Fatalf("type-asc results=%+v", typesAsc.Items)
	}

	res = request(t, router, http.MethodGet,
		"/api/v1/search?q=format&type=file&offset=0&limit=10&sort=name&order=asc&group=type&folders_first=true",
		tokenA, nil, http.StatusOK)
	var groupedFormats searchRangeDTO
	if err := json.Unmarshal(res.Body.Bytes(), &groupedFormats); err != nil {
		t.Fatal(err)
	}
	if len(groupedFormats.Items) != 2 || len(groupedFormats.Groups) != 2 {
		t.Fatalf("grouped format results=%+v", groupedFormats)
	}
	if groupedFormats.Items[0].Node.ID != formatPDF.ID || groupedFormats.Items[1].Node.ID != formatTXT.ID {
		t.Fatalf("grouped format item order=%+v", groupedFormats.Items)
	}
	if groupedFormats.Groups[0].Key != "ext:pdf" ||
		groupedFormats.Groups[0].StartIndex != 0 ||
		groupedFormats.Groups[0].ItemCount != 1 ||
		groupedFormats.Groups[1].Key != "ext:txt" ||
		groupedFormats.Groups[1].StartIndex != 1 ||
		groupedFormats.Groups[1].ItemCount != 1 {
		t.Fatalf("grouped format indexes=%+v", groupedFormats.Groups)
	}

	res = request(t, router, http.MethodGet,
		"/api/v1/search?q=report&type=file&offset=0&limit=10&sort=name&order=asc&group=size",
		tokenA, nil, http.StatusOK)
	var groupedReports searchRangeDTO
	if err := json.Unmarshal(res.Body.Bytes(), &groupedReports); err != nil {
		t.Fatal(err)
	}
	if len(groupedReports.Groups) != 1 ||
		groupedReports.Groups[0].Key != "tiny" ||
		groupedReports.Groups[0].ItemCount != 3 ||
		groupedReports.Groups[0].StartIndex != 0 {
		t.Fatalf("size grouped reports=%+v", groupedReports)
	}

	request(t, router, http.MethodGet,
		"/api/v1/search?q=other&type=file&limit=2&cursor="+url.QueryEscape(first.NextCursor),
		tokenA, nil, http.StatusBadRequest)
	request(t, router, http.MethodGet,
		"/api/v1/search?q=report&type=file&kind=pdf&limit=2&cursor="+url.QueryEscape(first.NextCursor),
		tokenA, nil, http.StatusBadRequest)
	request(t, router, http.MethodGet,
		"/api/v1/search?q=report&type=file&sort=size&order=asc&limit=2&cursor="+url.QueryEscape(first.NextCursor),
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

	res = request(t, router, http.MethodGet,
		"/api/v1/search?q="+url.QueryEscape("projects/reports")+"&type=file&limit=200",
		tokenA, nil, http.StatusOK)
	var pathSpanning searchPageDTO
	if err := json.Unmarshal(res.Body.Bytes(), &pathSpanning); err != nil {
		t.Fatal(err)
	}
	if len(pathSpanning.Items) != 2 {
		t.Fatalf("slash path search should retain full-path semantics: %+v", pathSpanning)
	}
	for _, item := range pathSpanning.Items {
		if !strings.HasPrefix(strings.ToLower(item.Path), "projects/reports/") {
			t.Fatalf("unexpected slash path result %q", item.Path)
		}
	}

	res = request(t, router, http.MethodGet, "/api/v1/search?q=needle&type=file&limit=200", tokenA, nil, http.StatusOK)
	var detached searchPageDTO
	if err := json.Unmarshal(res.Body.Bytes(), &detached); err != nil {
		t.Fatal(err)
	}
	if len(detached.Items) != 0 {
		t.Fatalf("active child below deleted ancestor must stay unreachable: %+v", detached.Items)
	}

	request(t, router, http.MethodGet, "/api/v1/search", tokenA, nil, http.StatusBadRequest)
	request(t, router, http.MethodGet, "/api/v1/search?q=x", tokenA, nil, http.StatusBadRequest)
	request(t, router, http.MethodGet, "/api/v1/search?q=report&type=other", tokenA, nil, http.StatusBadRequest)
	request(t, router, http.MethodGet, "/api/v1/search?kind=unknown", tokenA, nil, http.StatusBadRequest)
	request(t, router, http.MethodGet, "/api/v1/search?kind=pdf&min_size=-1", tokenA, nil, http.StatusBadRequest)
	request(t, router, http.MethodGet, "/api/v1/search?kind=pdf&min_size=20&max_size=10", tokenA, nil, http.StatusBadRequest)
	request(t, router, http.MethodGet, "/api/v1/search?kind=pdf&modified_from=bad", tokenA, nil, http.StatusBadRequest)
	request(t, router, http.MethodGet, "/api/v1/search?q=report&limit=201", tokenA, nil, http.StatusBadRequest)
	request(t, router, http.MethodGet, "/api/v1/search?q=report&sort=other", tokenA, nil, http.StatusBadRequest)
	request(t, router, http.MethodGet, "/api/v1/search?q=report&order=sideways", tokenA, nil, http.StatusBadRequest)
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
