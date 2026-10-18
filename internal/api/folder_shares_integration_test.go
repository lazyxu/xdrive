package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Reuse the same real PostgreSQL and CAS setup as legacy file-share tests.
// Each test runs sequentially: the integration fixtures own their schema.
func folderShareTestFixture(t *testing.T) (*gin.Engine, *gorm.DB, string, meta.Node) {
	t.Helper()
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
		&meta.AuditEvent{}, &meta.Share{}, &meta.UploadPart{}, &meta.LocalPushQuotaHold{},
		&meta.UploadSession{}, &meta.ContentBlob{}, &meta.FileVersion{}, &meta.File{},
		&meta.Node{}, &meta.RefreshToken{}, &meta.User{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{},
		&meta.ContentBlob{}, &meta.Share{}, &meta.UploadSession{}, &meta.UploadPart{},
		&meta.LocalPushQuotaHold{}, &meta.AuditEvent{},
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
		DB: db, Store: store, Auth: auth.New("folder-share-test-secret", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost", MaxUploadBytes: 10 << 20,
	}).Router()
	token := createTestUser(t, db, router, "folder-owner", "owner-password")
	rootDTO := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	var root meta.Node
	if err := db.First(&root, rootDTO.ID).Error; err != nil {
		t.Fatal(err)
	}
	return router, db, token, root
}

func publicFolderChildrenTestRequest(
	t *testing.T, router http.Handler, token, password string, parentID, cursor uint64, status int,
) *publicFolderSharePage {
	t.Helper()
	body := fmt.Sprintf(`{"password":%q,"parent_id":%d,"cursor":%d}`, password, parentID, cursor)
	response := requestWithHeaders(t, router, http.MethodPost,
		"/api/v1/public/share/children", "", strings.NewReader(body), status,
		map[string]string{"X-XDrive-Share-Token": token})
	if status != http.StatusOK {
		return nil
	}
	var page publicFolderSharePage
	if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	return &page
}

func TestFolderShareBoundedPrivateNavigationAndFileTicket(t *testing.T) {
	router, db, ownerToken, ownerRoot := folderShareTestFixture(t)
	otherToken := createTestUser(t, db, router, "folder-other", "other-password")
	otherRoot := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", otherToken, nil, http.StatusOK)

	parentID := ownerRoot.ID
	shared := meta.Node{
		OwnerID: ownerRoot.OwnerID, ParentID: &parentID, Name: "shared-album",
		Type: meta.NodeTypeDir, Revision: 1,
	}
	if err := db.Create(&shared).Error; err != nil {
		t.Fatal(err)
	}
	if response := request(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/shares", ownerRoot.ID), ownerToken,
		strings.NewReader(`{"max_downloads":0}`), http.StatusNotFound); response.Code != http.StatusNotFound {
		t.Fatal("root sharing must be disabled")
	}
	dirs := make([]meta.Node, 205)
	for i := range dirs {
		dirs[i] = meta.Node{
			OwnerID: ownerRoot.OwnerID, ParentID: &shared.ID, Type: meta.NodeTypeDir,
			Revision: 1, Name: fmt.Sprintf("folder-%04d", i),
		}
	}
	if err := db.CreateInBatches(dirs, 50).Error; err != nil {
		t.Fatal(err)
	}
	file := uploadTestFile(t, router, ownerToken, dirs[0].ID, "inside.txt", "nested-content")
	outside := uploadTestFile(t, router, ownerToken, ownerRoot.ID, "outside.txt", "do-not-share")
	otherFile := uploadTestFile(t, router, otherToken, otherRoot.ID, "other.txt", "private")

	createdRes := request(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/shares", shared.ID), ownerToken,
		strings.NewReader(`{"password":"folder-password","max_downloads":2}`), http.StatusCreated)
	var created createdShareDTO
	if err := json.Unmarshal(createdRes.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if len(created.Token) < 40 || !created.HasPassword {
		t.Fatalf("invalid folder share: %+v", created)
	}
	listed := request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/nodes/%d/shares", shared.ID), ownerToken, nil, http.StatusOK)
	if strings.Contains(listed.Body.String(), created.Token) {
		t.Fatal("existing shares leaked the bearer capability")
	}
	request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/nodes/%d/shares", shared.ID), otherToken, nil, http.StatusNotFound)
	var public publicShareDTO
	if err := json.Unmarshal(publicShareRequest(t, router, http.MethodGet, created.Token, nil,
		http.StatusOK).Body.Bytes(), &public); err != nil {
		t.Fatal(err)
	}
	if public.Type != meta.NodeTypeDir || public.Size != 0 || !public.RequiresPassword {
		t.Fatalf("folder metadata wrong: %+v", public)
	}
	publicFolderChildrenTestRequest(t, router, created.Token, "wrong", 0, 0, http.StatusUnauthorized)
	publicFolderChildrenTestRequest(t, router, created.Token, "folder-password",
		ownerRoot.ID, 0, http.StatusNotFound)
	publicFolderChildrenTestRequest(t, router, created.Token, "folder-password",
		otherRoot.ID, 0, http.StatusNotFound)

	first := publicFolderChildrenTestRequest(t, router, created.Token, "folder-password", 0, 0, http.StatusOK)
	if first.ParentID != shared.ID || len(first.Items) != 100 || first.NextCursor == 0 {
		t.Fatalf("bad first bounded page: parent=%d len=%d next=%d", first.ParentID, len(first.Items), first.NextCursor)
	}
	second := publicFolderChildrenTestRequest(t, router, created.Token, "folder-password",
		shared.ID, first.NextCursor, http.StatusOK)
	if len(second.Items) != 100 || second.NextCursor == 0 {
		t.Fatalf("bad second bounded page: len=%d next=%d", len(second.Items), second.NextCursor)
	}
	third := publicFolderChildrenTestRequest(t, router, created.Token, "folder-password",
		shared.ID, second.NextCursor, http.StatusOK)
	if len(third.Items) != 5 || third.NextCursor != 0 {
		t.Fatalf("bad final page: len=%d next=%d", len(third.Items), third.NextCursor)
	}
	nested := publicFolderChildrenTestRequest(t, router, created.Token, "folder-password",
		dirs[0].ID, 0, http.StatusOK)
	if len(nested.Items) != 1 || nested.Items[0].ID != file.ID ||
		nested.Items[0].Size != int64(len("nested-content")) {
		t.Fatalf("nested file missing or incorrect: %+v", nested)
	}

	for _, deniedID := range []uint64{outside.ID, otherFile.ID} {
		body := fmt.Sprintf(`{"password":"folder-password","node_id":%d}`, deniedID)
		requestWithHeaders(t, router, http.MethodPost, "/api/v1/public/share/download-ticket",
			"", strings.NewReader(body), http.StatusNotFound,
			map[string]string{"X-XDrive-Share-Token": created.Token})
	}
	downloadBody := fmt.Sprintf(`{"password":"folder-password","node_id":%d}`, file.ID)
	getTicket := func() publicShareDownloadTicketDTO {
		response := requestWithHeaders(t, router, http.MethodPost,
			"/api/v1/public/share/download-ticket", "", strings.NewReader(downloadBody),
			http.StatusOK, map[string]string{"X-XDrive-Share-Token": created.Token})
		var ticket publicShareDownloadTicketDTO
		if err := json.Unmarshal(response.Body.Bytes(), &ticket); err != nil {
			t.Fatal(err)
		}
		return ticket
	}
	firstTicket := getTicket()
	content := requestWithHeaders(t, router, http.MethodGet, firstTicket.URL, "", nil,
		http.StatusOK, nil)
	if content.Body.String() != "nested-content" {
		t.Fatalf("wrong descendant content: %q", content.Body.String())
	}
	secondTicket := getTicket()
	if err := db.Model(&meta.Node{}).Where("id = ?", file.ID).
		Update("parent_id", ownerRoot.ID).Error; err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodGet, secondTicket.URL, "", nil,
		http.StatusGone, nil)
	requestWithHeaders(t, router, http.MethodPost, "/api/v1/public/share/download-ticket",
		"", strings.NewReader(downloadBody), http.StatusGone,
		map[string]string{"X-XDrive-Share-Token": created.Token})

	request(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/shares/%d", created.ID),
		ownerToken, nil, http.StatusNoContent)
	publicShareRequest(t, router, http.MethodGet, created.Token, nil, http.StatusGone)
}

// This is a cancellable HTTP READ, never a user-started durable FileOperation.
// A held PostgreSQL table read proves that client-side Context cancellation
// actually interrupts a blocked SQL query instead of just ignoring the result.
func TestFolderShareReadRequestContextCancellation(t *testing.T) {
	router, db, ownerToken, root := folderShareTestFixture(t)
	shared := meta.Node{
		OwnerID: root.OwnerID, ParentID: &root.ID,
		Name: "cancellable-page", Type: meta.NodeTypeDir, Revision: 1,
	}
	if err := db.Create(&shared).Error; err != nil {
		t.Fatal(err)
	}
	created := request(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/shares", shared.ID), ownerToken,
		strings.NewReader(`{"max_downloads":0}`), http.StatusCreated)
	var share createdShareDTO
	if err := json.Unmarshal(created.Body.Bytes(), &share); err != nil {
		t.Fatal(err)
	}

	lock := db.Begin()
	if lock.Error != nil {
		t.Fatal(lock.Error)
	}
	defer lock.Rollback()
	if err := lock.Exec("LOCK TABLE xd_nodes IN ACCESS EXCLUSIVE MODE").Error; err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	body := fmt.Sprintf(`{"parent_id":%d,"cursor":0}`, shared.ID)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/public/share/children",
		strings.NewReader(body)).WithContext(ctx)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-XDrive-Share-Token", share.Token)
	response := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		defer close(done)
		router.ServeHTTP(response, req)
	}()

	// Observe an authentic PostgreSQL lock waiter, rather than canceling
	// before the handler reaches the database.
	waiterDeadline := time.Now().Add(5 * time.Second)
	observed := false
	for time.Now().Before(waiterDeadline) {
		var waiters int64
		if err := db.Raw(`SELECT COUNT(*) FROM pg_stat_activity
			WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock'
			  AND query LIKE '%xd_nodes%'`).Scan(&waiters).Error; err != nil {
			t.Fatal(err)
		}
		if waiters > 0 {
			observed = true
			break
		}
		select {
		case <-done:
			t.Fatal("folder share returned before reaching the held PostgreSQL query")
		case <-time.After(10 * time.Millisecond):
		}
	}
	if !observed {
		t.Fatal("did not observe a held real PostgreSQL folder-share read")
	}

	cancelStart := time.Now()
	cancel()
	var cancelElapsed time.Duration
	select {
	case <-done:
		cancelElapsed = time.Since(cancelStart)
		if cancelElapsed > 160*time.Millisecond {
			t.Fatalf("SQL handler survived cancelled HTTP Request.Context for %s", cancelElapsed)
		}
	case <-time.After(160 * time.Millisecond):
		t.Fatal("Go public folder-share handler did not exit within 160ms of HTTP cancellation")
	}
	if response.Code == http.StatusOK {
		t.Fatal("aborted SQL read returned success without authorized page")
	}
	// PostgreSQL may acknowledge a canceled statement a few milliseconds
	// after Gin has returned. Poll the actual SQL waiter until it is gone,
	// without extending the original 160ms end-to-end cancellation budget.
	cancelDeadline := cancelStart.Add(160 * time.Millisecond)
	var remaining int64
	for {
		if err := db.Raw(`SELECT COUNT(*) FROM pg_stat_activity
			WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock'
			  AND query LIKE '%xd_nodes%'`).Scan(&remaining).Error; err != nil {
			t.Fatal(err)
		}
		if remaining == 0 {
			break
		}
		if !time.Now().Before(cancelDeadline) {
			t.Fatalf("cancelled folder-share query still holds %d PostgreSQL lock waiters after 160ms", remaining)
		}
		time.Sleep(5 * time.Millisecond)
	}
	sqlReleaseElapsed := time.Since(cancelStart)
	if sqlReleaseElapsed > 160*time.Millisecond {
		t.Fatalf("SQL waiters cleared only after %s (budget 160ms)", sqlReleaseElapsed)
	}
	t.Logf("FOLDER_SHARE_CANCEL_REAL_POSTGRES waiters=1 context_exit_ms=%.3f sql_release_ms=%.3f remaining=0",
		float64(cancelElapsed.Microseconds())/1000, float64(sqlReleaseElapsed.Microseconds())/1000)
}

// Opt-in only: this is a REAL 100k PostgreSQL Node directory metadata
// pagination benchmark, NOT 100k distinct photo/video CAS bytes nor a new
// accepted six-platform baseline. It emits an actual wall-time result when run.
func TestFolderShare100kRealPostgresPageBaseline(t *testing.T) {
	if os.Getenv("XD_FOLDER_SHARE_100K_PERF") != "1" {
		t.Skip("set XD_FOLDER_SHARE_100K_PERF=1 for real 100k metadata benchmark")
	}
	router, db, token, root := folderShareTestFixture(t)
	shared := meta.Node{
		OwnerID: root.OwnerID, ParentID: &root.ID,
		Name: "large-share", Type: meta.NodeTypeDir, Revision: 1,
	}
	if err := db.Create(&shared).Error; err != nil {
		t.Fatal(err)
	}
	const count = 100000
	items := make([]meta.Node, count)
	for i := range items {
		items[i] = meta.Node{
			OwnerID: root.OwnerID, ParentID: &shared.ID, Name: fmt.Sprintf("entry-%06d", i),
			Type: meta.NodeTypeDir, Revision: 1,
		}
	}
	seedStart := time.Now()
	if err := db.CreateInBatches(items, 1000).Error; err != nil {
		t.Fatal(err)
	}
	seedDuration := time.Since(seedStart)
	created := request(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/shares", shared.ID), token,
		strings.NewReader(`{"max_downloads":0}`), http.StatusCreated)
	var share createdShareDTO
	if err := json.Unmarshal(created.Body.Bytes(), &share); err != nil {
		t.Fatal(err)
	}
	var cursor uint64
	var total int
	var httpBytes int64
	pageDurations := make([]float64, 0, count/publicFolderSharePageLimit)
	start := time.Now()
	for pageIndex := 0; pageIndex < count/publicFolderSharePageLimit; pageIndex++ {
		body := fmt.Sprintf(`{"password":"","parent_id":%d,"cursor":%d}`, shared.ID, cursor)
		pageStart := time.Now()
		response := requestWithHeaders(t, router, http.MethodPost,
			"/api/v1/public/share/children", "", strings.NewReader(body), http.StatusOK,
			map[string]string{"X-XDrive-Share-Token": share.Token})
		pageDurations = append(pageDurations, float64(time.Since(pageStart).Microseconds())/1000)
		httpBytes += int64(response.Body.Len())
		var page publicFolderSharePage
		if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
			t.Fatal(err)
		}
		if len(page.Items) != publicFolderSharePageLimit {
			t.Fatalf("page %d size=%d", pageIndex, len(page.Items))
		}
		if cursor != 0 && page.Items[0].ID <= cursor {
			t.Fatalf("cursor did not advance at page %d", pageIndex)
		}
		cursor = page.NextCursor
		total += len(page.Items)
		if pageIndex+1 < count/publicFolderSharePageLimit && cursor == 0 {
			t.Fatal("premature end of 100k listing")
		}
	}
	elapsed := time.Since(start)
	if total != count || cursor != 0 || httpBytes <= 0 {
		t.Fatalf("100k folder walk incomplete: total=%d next=%d bytes=%d", total, cursor, httpBytes)
	}
	sort.Float64s(pageDurations)
	evidence := map[string]interface{}{
		"sample":  os.Getenv("XD_FOLDER_SHARE_SAMPLE"),
		"entries": total, "pages": len(pageDurations),
		"seed_ms":         seedDuration.Milliseconds(),
		"page_walk_ms":    elapsed.Milliseconds(),
		"page_p50_ms":     pageDurations[len(pageDurations)/2],
		"page_p95_ms":     pageDurations[len(pageDurations)*95/100-1],
		"page_worst_ms":   pageDurations[len(pageDurations)-1],
		"http_body_bytes": httpBytes,
		"scope":           "real PostgreSQL17 metadata Nodes, NOT original physical CAS",
	}
	encoded, err := json.Marshal(evidence)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("FOLDER_SHARE_100K %s", encoded)
}
