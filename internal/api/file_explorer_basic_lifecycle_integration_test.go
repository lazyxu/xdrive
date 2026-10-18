package api

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/background"
	clientpkg "github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func TestFileExplorerBasicLifecycleAcrossClientAndServer(t *testing.T) {
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
	baseSQL.SetMaxIdleConns(0)
	t.Cleanup(func() { _ = baseSQL.Close() })

	schema := "fileexplorer_basic_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	sqlDB.SetMaxIdleConns(0)
	t.Cleanup(func() { _ = sqlDB.Close() })

	if err := db.AutoMigrate(
		&meta.User{},
		&meta.RefreshToken{},
		&meta.Node{},
		&meta.File{},
		&meta.FileVersion{},
		&meta.ContentBlob{},
		&meta.Share{},
		&meta.UploadSession{},
		&meta.UploadPart{}, &meta.LocalPushQuotaHold{},
		&meta.AuditEvent{},
		&meta.FileOperation{},
		&meta.ArchivePrepareRun{},
	); err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		`CREATE UNIQUE INDEX idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`,
		`CREATE UNIQUE INDEX idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`,
		`CREATE INDEX idx_xd_nodes_children_name ON xd_nodes(owner_id, parent_id, type, lower(name), id) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`,
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := meta.InstallNodeChangeJournal(db); err != nil {
		t.Fatal(err)
	}

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	archiveCtx, archiveCancel := context.WithCancel(context.Background())
	t.Cleanup(archiveCancel)
	archiveScheduler := background.NewScheduler(archiveCtx, background.Config{
		Capacity: map[background.ResourceClass]int{
			background.ResourceInteractiveIO: 1,
		},
		QueueCapacity: map[background.ResourceClass]int{
			background.ResourceInteractiveIO: 8,
		},
	})
	t.Cleanup(archiveScheduler.Close)
	srv := &Server{
		DB:                  db,
		Store:               store,
		Auth:                auth.New("file-explorer-basic-secret", time.Hour),
		RefreshTTL:          24 * time.Hour,
		AllowedOrigin:       "http://localhost",
		MaxUploadBytes:      32 << 20,
		BackgroundScheduler: archiveScheduler,
	}
	srv.StartArchivePrepareTasks(archiveCtx)
	router := srv.Router()
	token := createTestUser(t, db, router, "file-explorer-basic", "password-file-explorer-basic")
	otherToken := createTestUser(t, db, router, "file-explorer-basic-other", "password-file-explorer-basic-other")

	httpServer := httptest.NewServer(router)
	t.Cleanup(httpServer.Close)
	cli := clientpkg.New(httpServer.URL, token)
	observer := clientpkg.New(httpServer.URL, token)
	ctx := context.Background()

	root, err := cli.Root(ctx)
	if err != nil {
		t.Fatal(err)
	}
	baseline, err := observer.NodeChanges(ctx, 0, 1000)
	if err != nil {
		t.Fatal(err)
	}
	cursor := baseline.LatestCursor

	source, err := cli.CreateDir(ctx, root.ID, "source")
	if err != nil {
		t.Fatal(err)
	}
	target, err := cli.CreateDir(ctx, root.ID, "target")
	if err != nil {
		t.Fatal(err)
	}
	sourceByID, err := cli.Node(ctx, source.ID)
	if err != nil {
		t.Fatal(err)
	}
	if sourceByID.ID != source.ID || sourceByID.Name != source.Name ||
		sourceByID.Type != meta.NodeTypeDir || sourceByID.ParentID == nil || *sourceByID.ParentID != root.ID {
		t.Fatalf("exact node lookup=%+v want source=%+v parent=%d", sourceByID, source, root.ID)
	}
	request(
		t, router, http.MethodGet, fmt.Sprintf("/api/v1/nodes/%d", source.ID),
		otherToken, nil, http.StatusNotFound,
	)
	empty, err := cli.CreateDir(ctx, source.ID, "empty")
	if err != nil {
		t.Fatal(err)
	}
	const helloBody = "hello from FileExplorer"
	hello, err := cli.Upload(ctx, source.ID, "hello.txt", strings.NewReader(helloBody))
	if err != nil {
		t.Fatal(err)
	}
	const moveBody = "move me"
	moveFile, err := cli.Upload(ctx, source.ID, "move.txt", strings.NewReader(moveBody))
	if err != nil {
		t.Fatal(err)
	}

	sourceRange := basicFileExplorerRange(t, cli, source.ID)
	if !sourceRange.HasTotalCount() || sourceRange.TotalCount != 3 {
		t.Fatalf("source initial range total=%d included=%v want=3/true", sourceRange.TotalCount, sourceRange.HasTotalCount())
	}
	for _, id := range []uint64{empty.ID, hello.ID, moveFile.ID} {
		if !basicRangeHasNode(sourceRange, id) {
			t.Fatalf("source initial range missing node %d: %+v", id, sourceRange.Items)
		}
	}

	// U01-A1: exercise a truly authorized first counted page over an actual
	// HTTP connection while its completed Gin response is delayed, then cancel
	// that request without changing the last committed directory snapshot.
	assertRealAuthenticatedPendingNavigationAbort(
		t, router, token, otherToken, root.ID, source.ID,
		[]uint64{source.ID, target.ID},
		[]uint64{empty.ID, hello.ID, moveFile.ID},
	)

	createdChanges, err := observer.NodeChanges(ctx, cursor, 1000)
	if err != nil {
		t.Fatal(err)
	}
	assertBasicNodeChange(t, createdChanges, source.ID, "upsert", root.ID)
	assertBasicNodeChange(t, createdChanges, target.ID, "upsert", root.ID)
	assertBasicNodeChange(t, createdChanges, empty.ID, "upsert", source.ID)
	assertBasicNodeChange(t, createdChanges, hello.ID, "upsert", source.ID)
	assertBasicNodeChange(t, createdChanges, moveFile.ID, "upsert", source.ID)
	cursor = createdChanges.LatestCursor

	var downloaded bytes.Buffer
	if err := cli.DownloadTo(ctx, hello.ID, &downloaded); err != nil {
		t.Fatal(err)
	}
	if downloaded.String() != helloBody {
		t.Fatalf("downloaded hello=%q want=%q", downloaded.String(), helloBody)
	}

	var archive bytes.Buffer
	if err := cli.DownloadArchiveTo(ctx, []uint64{source.ID}, &archive); err != nil {
		t.Fatal(err)
	}
	entries := basicArchiveEntries(t, archive.Bytes())
	for name, content := range map[string]string{
		"source/":          "",
		"source/empty/":    "",
		"source/hello.txt": helloBody,
		"source/move.txt":  moveBody,
	} {
		got, ok := entries[name]
		if !ok {
			t.Fatalf("folder download missing %q: %v", name, entries)
		}
		if got != content {
			t.Fatalf("folder download entry %q=%q want=%q", name, got, content)
		}
	}

	// U04: A real authenticated 202 Accepted must never be mistaken for a
	// committed file mutation. Cancel a queued copy through the public Client
	// before any worker starts; the Server, DB and Local CAS are real.
	cancelProbe, err := cli.CreateFileOperation(
		ctx,
		meta.FileOperationTypeCopy,
		[]clientpkg.BatchNodeRef{{ID: hello.ID, Revision: hello.Revision}},
		target.ID,
	)
	if err != nil {
		t.Fatal(err)
	}
	assertBasicQueuedFileOperation(t, cli, cancelProbe)
	assertBasicU04DurableTaskReceipt(t, httpServer.URL, token, otherToken, cancelProbe.ID, meta.FileOperationStatusQueued)
	request(
		t, router, http.MethodGet,
		"/api/v1/file-operations/"+cancelProbe.ID,
		otherToken, nil, http.StatusNotFound,
	)
	request(
		t, router, http.MethodPost,
		"/api/v1/file-operations/"+cancelProbe.ID+"/cancel",
		otherToken, nil, http.StatusNotFound,
	)
	cancelledProbe, err := cli.CancelFileOperation(ctx, cancelProbe.ID)
	if err != nil {
		t.Fatal(err)
	}
	assertBasicU04DurableTaskReceipt(t, httpServer.URL, token, otherToken, cancelProbe.ID, meta.FileOperationStatusCancelled)
	if cancelledProbe.Status != meta.FileOperationStatusCancelled ||
		cancelledProbe.ProcessedItems != 0 || cancelledProbe.ProcessedBytes != 0 ||
		cancelledProbe.Percent != 0 || cancelledProbe.FinishedAt == nil {
		t.Fatalf("queued cancel must be terminal with zero committed progress: %+v", cancelledProbe)
	}
	confirmedCancel, err := cli.GetFileOperation(ctx, cancelProbe.ID)
	if err != nil {
		t.Fatal(err)
	}
	if confirmedCancel.Status != meta.FileOperationStatusCancelled ||
		confirmedCancel.ProcessedItems != 0 || confirmedCancel.FinishedAt == nil {
		t.Fatalf("cancel receipt changed between POST and GET: %+v", confirmedCancel)
	}
	if processed, err := srv.processNextFileOperation(ctx); err != nil || processed {
		t.Fatalf("cancelled queued operation must not execute: processed=%v err=%v", processed, err)
	}
	if targetBefore := basicFileExplorerRange(t, cli, target.ID); targetBefore.TotalCount != 0 {
		t.Fatalf("cancelled operation changed the target before worker commit: %+v", targetBefore)
	}

	copyOperation, err := cli.CreateFileOperation(
		ctx,
		meta.FileOperationTypeCopy,
		[]clientpkg.BatchNodeRef{{ID: hello.ID, Revision: hello.Revision}},
		target.ID,
	)
	if err != nil {
		t.Fatal(err)
	}
	assertBasicQueuedFileOperation(t, cli, copyOperation)
	if page := basicFileExplorerRange(t, cli, target.ID); page.TotalCount != 0 {
		t.Fatalf("accepted copy changed target before worker execution: %+v", page)
	}
	processBasicFileOperation(t, srv, cli, copyOperation.ID)
	assertBasicU04DurableTaskReceipt(t, httpServer.URL, token, otherToken, copyOperation.ID, meta.FileOperationStatusCompleted)

	movedOperation, err := cli.CreateFileOperation(
		ctx,
		meta.FileOperationTypeMove,
		[]clientpkg.BatchNodeRef{{ID: moveFile.ID, Revision: moveFile.Revision}},
		target.ID,
	)
	if err != nil {
		t.Fatal(err)
	}
	assertBasicQueuedFileOperation(t, cli, movedOperation)
	if beforeMove := basicFileExplorerRange(t, cli, source.ID); !basicRangeHasNode(beforeMove, moveFile.ID) {
		t.Fatalf("accepted move removed source before worker execution: %+v", beforeMove)
	}
	processBasicFileOperation(t, srv, cli, movedOperation.ID)
	assertBasicU04DurableTaskReceipt(t, httpServer.URL, token, otherToken, movedOperation.ID, meta.FileOperationStatusCompleted)

	targetRange := basicFileExplorerRange(t, cli, target.ID)
	if targetRange.TotalCount != 2 {
		t.Fatalf("target range total=%d want=2 items=%+v", targetRange.TotalCount, targetRange.Items)
	}
	copiedHello := basicRangeNodeByName(t, targetRange, "hello.txt")
	movedFile := basicRangeNodeByName(t, targetRange, "move.txt")
	if movedFile.ID != moveFile.ID {
		t.Fatalf("move changed node identity: got=%d want=%d", movedFile.ID, moveFile.ID)
	}
	var copiedBytes bytes.Buffer
	if err := cli.DownloadTo(ctx, copiedHello.ID, &copiedBytes); err != nil {
		t.Fatal(err)
	}
	if copiedBytes.String() != helloBody {
		t.Fatalf("copied file content=%q want=%q", copiedBytes.String(), helloBody)
	}

	operationChanges, err := observer.NodeChanges(ctx, cursor, 1000)
	if err != nil {
		t.Fatal(err)
	}
	assertBasicNodeChange(t, operationChanges, copiedHello.ID, "upsert", target.ID)
	assertBasicNodeChange(t, operationChanges, moveFile.ID, "upsert", source.ID, target.ID)
	cursor = operationChanges.LatestCursor

	sourceRange = basicFileExplorerRange(t, cli, source.ID)
	if sourceRange.TotalCount != 2 || basicRangeHasNode(sourceRange, moveFile.ID) {
		t.Fatalf("source after move total=%d moveStillPresent=%v items=%+v", sourceRange.TotalCount, basicRangeHasNode(sourceRange, moveFile.ID), sourceRange.Items)
	}

	deleteOperation, err := cli.CreateFileOperation(
		ctx,
		meta.FileOperationTypeDelete,
		[]clientpkg.BatchNodeRef{{ID: hello.ID, Revision: hello.Revision}},
		0,
	)
	if err != nil {
		t.Fatal(err)
	}
	assertBasicQueuedFileOperation(t, cli, deleteOperation)
	if beforeDelete := basicFileExplorerRange(t, cli, source.ID); !basicRangeHasNode(beforeDelete, hello.ID) {
		t.Fatalf("accepted delete removed source before worker execution: %+v", beforeDelete)
	}
	processBasicFileOperation(t, srv, cli, deleteOperation.ID)
	assertBasicU04DurableTaskReceipt(t, httpServer.URL, token, otherToken, deleteOperation.ID, meta.FileOperationStatusCompleted)

	deleteChanges, err := observer.NodeChanges(ctx, cursor, 1000)
	if err != nil {
		t.Fatal(err)
	}
	assertBasicNodeChange(t, deleteChanges, hello.ID, "delete", source.ID)
	cursor = deleteChanges.LatestCursor
	request(
		t, router, http.MethodGet, fmt.Sprintf("/api/v1/nodes/%d", hello.ID),
		token, nil, http.StatusNotFound,
	)

	sourceRange = basicFileExplorerRange(t, cli, source.ID)
	if sourceRange.TotalCount != 1 || basicRangeHasNode(sourceRange, hello.ID) {
		t.Fatalf("source after delete total=%d helloPresent=%v items=%+v", sourceRange.TotalCount, basicRangeHasNode(sourceRange, hello.ID), sourceRange.Items)
	}

	trash, err := cli.Trash(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var trashedHello *clientpkg.Node
	for index := range trash {
		if trash[index].ID == hello.ID {
			item := trash[index]
			trashedHello = &item
			break
		}
	}
	if trashedHello == nil || trashedHello.DeletedAt == nil {
		t.Fatalf("deleted hello missing from Trash: %+v", trash)
	}

	restored, err := cli.RestoreTrash(ctx, trashedHello.ID, trashedHello.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if restored.ID != hello.ID || restored.Revision <= hello.Revision {
		t.Fatalf("restored hello=%+v original=%+v", restored, hello)
	}
	restoredByID, err := cli.Node(ctx, hello.ID)
	if err != nil {
		t.Fatal(err)
	}
	if restoredByID.ID != restored.ID || restoredByID.Revision != restored.Revision {
		t.Fatalf("restored exact lookup=%+v want=%+v", restoredByID, restored)
	}
	restoreChanges, err := observer.NodeChanges(ctx, cursor, 1000)
	if err != nil {
		t.Fatal(err)
	}
	assertBasicNodeChange(t, restoreChanges, hello.ID, "upsert", source.ID)

	sourceRange = basicFileExplorerRange(t, cli, source.ID)
	if sourceRange.TotalCount != 2 || !basicRangeHasNode(sourceRange, hello.ID) {
		t.Fatalf("source after restore total=%d helloPresent=%v items=%+v", sourceRange.TotalCount, basicRangeHasNode(sourceRange, hello.ID), sourceRange.Items)
	}
	downloaded.Reset()
	if err := cli.DownloadTo(ctx, hello.ID, &downloaded); err != nil {
		t.Fatal(err)
	}
	if downloaded.String() != helloBody {
		t.Fatalf("restored download=%q want=%q", downloaded.String(), helloBody)
	}

	// U04-B: actual running Worker and authenticated cancel RPC, not a
	// simulated terminal status or queued-before-start cancellation.
	assertBasicFileOperationRunningCancel(t, srv, db, cli, root.ID, restored)
	// U05: same Gin/PostgreSQL instance enforces byte length, owner isolation,
	// same-parent conflict, immutable revision and durable exact UTF-8 rename.
	assertBasicU05UTF8RenameServerContract(t, router, cli, token, otherToken, root.ID)
}

// assertBasicU05UTF8RenameServerContract is a real Gin/PostgreSQL/Owner rename
// path, never a mocked API success. Cross-owner existence is concealed as 404.
func assertBasicU05UTF8RenameServerContract(
	t *testing.T,
	router http.Handler,
	cli *clientpkg.Client,
	ownerToken, foreignToken string,
	rootID uint64,
) {
	t.Helper()
	ctx := context.Background()
	probe, err := cli.CreateDir(ctx, rootID, "u05-rename-original")
	if err != nil {
		t.Fatal(err)
	}
	occupied, err := cli.CreateDir(ctx, rootID, "u05-rename-occupied")
	if err != nil {
		t.Fatal(err)
	}
	nodePath := fmt.Sprintf("/api/v1/nodes/%d", probe.ID)
	patch := func(revision uint64, token, candidate string, status int) {
		t.Helper()
		requestWithHeaders(t, router, http.MethodPatch, nodePath, token,
			strings.NewReader(fmt.Sprintf("{\"name\":%q}", candidate)),
			status, map[string]string{"If-Match": fmt.Sprintf("\"%d\"", revision)})
	}
	check := func(name string, revision uint64) {
		t.Helper()
		current, err := cli.Node(ctx, probe.ID)
		if err != nil {
			t.Fatal(err)
		}
		if current.ID != probe.ID || current.Name != name || current.Revision != revision {
			t.Fatalf("U05 persisted node: got=%+v want name=%q revision=%d",
				current, name, revision)
		}
	}
	revision := probe.Revision
	exact255 := strings.Repeat("界", 85)
	over255 := exact255 + "a"
	if len([]byte(exact255)) != 255 || len([]byte(over255)) != 256 {
		t.Fatal("U05 precondition must measure UTF-8 bytes, not Unicode characters")
	}
	patch(revision, foreignToken, "foreign-overwrite", http.StatusNotFound)
	check(probe.Name, revision)
	patch(revision, ownerToken, over255, http.StatusBadRequest)
	check(probe.Name, revision)
	patch(revision, ownerToken, occupied.Name, http.StatusConflict)
	check(probe.Name, revision)
	patch(revision, ownerToken, exact255, http.StatusOK)
	check(exact255, revision+1)
	patch(revision, ownerToken, "stale-overwrite", http.StatusConflict)
	check(exact255, revision+1)
}

// assertRealAuthenticatedPendingNavigationAbort preserves the original
// Server Router, SQL authorization and counted-range response. Only a private
// test HTTP wrapper holds the already-authorized response bytes. This validates
// real wire cancellation and a concurrent authorized old-directory read; it is
// not a claim about mounted browser geometry or cancellation of an SQL query.
func assertRealAuthenticatedPendingNavigationAbort(
	t *testing.T,
	router http.Handler,
	ownerToken, foreignToken string,
	oldDirectoryID, nextDirectoryID uint64,
	expectedOldIDs, expectedNextIDs []uint64,
) {
	t.Helper()
	const holdHeader = "X-XDrive-U01-Hold-Authorized-Response"
	const timeout = 12 * time.Second
	nextPath := fmt.Sprintf("/api/v1/nodes/%d/children", nextDirectoryID)
	entered := make(chan int, 1)
	cancelObserved := make(chan struct{}, 1)
	release := make(chan struct{})

	gated := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(holdHeader) != "1" {
			router.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodGet || r.URL.Path != nextPath || r.URL.Query().Get("offset") != "0" {
			http.Error(w, "invalid private U01 test request", http.StatusBadRequest)
			return
		}
		// Run the real Gin auth, Owner scoping and PostgreSQL counted range
		// BEFORE withholding network delivery. Never fabricate HTTP 200.
		authorized := httptest.NewRecorder()
		router.ServeHTTP(authorized, r)
		entered <- authorized.Code
		if authorized.Code != http.StatusOK {
			w.WriteHeader(authorized.Code)
			_, _ = w.Write(authorized.Body.Bytes())
			return
		}
		select {
		case <-release:
			for key, values := range authorized.Header() {
				for _, value := range values {
					w.Header().Add(key, value)
				}
			}
			w.WriteHeader(authorized.Code)
			_, _ = w.Write(authorized.Body.Bytes())
		case <-r.Context().Done():
			cancelObserved <- struct{}{}
		}
	}))
	defer gated.Close()
	defer close(release)

	cli := clientpkg.New(gated.URL, ownerToken)
	oldSnapshot := basicFileExplorerRange(t, cli, oldDirectoryID)
	if oldSnapshot.TotalCount != int64(len(expectedOldIDs)) {
		t.Fatalf("authorized prior directory count=%d want=%d", oldSnapshot.TotalCount, len(expectedOldIDs))
	}
	for _, id := range expectedOldIDs {
		if !basicRangeHasNode(oldSnapshot, id) {
			t.Fatalf("old authorized directory missing node %d", id)
		}
	}

	// The other authenticated Owner must get a real Gin 404, not a stale
	// directory body or a frontend-fabricated empty result.
	foreign, err := http.NewRequest(http.MethodGet,
		gated.URL+nextPath+"?offset=0&limit=200", nil)
	if err != nil {
		t.Fatal(err)
	}
	foreign.Header.Set("Authorization", "Bearer "+foreignToken)
	foreignResponse, err := http.DefaultClient.Do(foreign)
	if err != nil {
		t.Fatal(err)
	}
	_ = foreignResponse.Body.Close()
	if foreignResponse.StatusCode != http.StatusNotFound {
		t.Fatalf("foreign Owner first directory range status=%d want=404", foreignResponse.StatusCode)
	}

	pendingCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pending, err := http.NewRequestWithContext(pendingCtx, http.MethodGet,
		gated.URL+nextPath+"?offset=0&limit=200&sort=name&order=asc", nil)
	if err != nil {
		t.Fatal(err)
	}
	pending.Header.Set("Authorization", "Bearer "+ownerToken)
	pending.Header.Set(holdHeader, "1")
	type pendingOutcome struct {
		status int
		err    error
	}
	outcome := make(chan pendingOutcome, 1)
	go func() {
		response, requestErr := http.DefaultClient.Do(pending)
		if requestErr != nil {
			outcome <- pendingOutcome{err: requestErr}
			return
		}
		_ = response.Body.Close()
		outcome <- pendingOutcome{status: response.StatusCode}
	}()

	select {
	case status := <-entered:
		if status != http.StatusOK {
			t.Fatalf("delayed original Gin authorization returned=%d want=200", status)
		}
	case <-time.After(timeout):
		t.Fatal("real authenticated counted range did not reach delayed-response barrier")
	}

	// The old authorized range remains accessible through a concurrent real
	// HTTP/SQL request; its item IDs are not replaced by a pending destination.
	stillOld := basicFileExplorerRange(t, cli, oldDirectoryID)
	if stillOld.TotalCount != oldSnapshot.TotalCount {
		t.Fatalf("pending navigation replaced old count: before=%d during=%d",
			oldSnapshot.TotalCount, stillOld.TotalCount)
	}
	for _, id := range expectedOldIDs {
		if !basicRangeHasNode(stillOld, id) {
			t.Fatalf("pending navigation lost old authorized Node %d", id)
		}
	}

	cancel()
	select {
	case result := <-outcome:
		if !errors.Is(result.err, context.Canceled) {
			t.Fatalf("cancelled HTTP request returned status=%d error=%v", result.status, result.err)
		}
	case <-time.After(timeout):
		t.Fatal("cancelled client HTTP request did not exit")
	}
	select {
	case <-cancelObserved:
	case <-time.After(timeout):
		t.Fatal("real HTTP handler did not observe request context cancellation")
	}

	// A new authenticated request must still return the complete first page.
	// No held response can overwrite the fresh one after cancellation.
	fresh := basicFileExplorerRange(t, cli, nextDirectoryID)
	if fresh.TotalCount != int64(len(expectedNextIDs)) {
		t.Fatalf("fresh counted destination=%d want=%d", fresh.TotalCount, len(expectedNextIDs))
	}
	for _, id := range expectedNextIDs {
		if !basicRangeHasNode(fresh, id) {
			t.Fatalf("fresh authorized destination missing Node %d", id)
		}
	}
}

// assertBasicFileOperationRunningCancel owns an isolated genuine PostgreSQL
// row lock to keep the original worker's transaction in flight after it has
// claimed the task. The actual client cancel endpoint must cancel the Go
// Worker context while the row is STILL LOCKED, without waiting for SQL to
// finish naturally. All source/target effects must roll back.
func assertBasicFileOperationRunningCancel(
	t *testing.T,
	srv *Server,
	db *gorm.DB,
	cli *clientpkg.Client,
	rootID uint64,
	source clientpkg.Node,
) {
	t.Helper()
	const timeout = 12 * time.Second
	ctx := context.Background()
	target, err := cli.CreateDir(ctx, rootID, "running-cancel-target")
	if err != nil {
		t.Fatal(err)
	}
	operation, err := cli.CreateFileOperation(ctx, meta.FileOperationTypeCopy,
		[]clientpkg.BatchNodeRef{{ID: source.ID, Revision: source.Revision}}, target.ID)
	if err != nil {
		t.Fatal(err)
	}
	assertBasicQueuedFileOperation(t, cli, operation)
	if before := basicFileExplorerRange(t, cli, target.ID); before.TotalCount != 0 {
		t.Fatalf("running-cancel target must be empty before worker: %+v", before)
	}

	// Acquire after enqueue (which itself checks source Revision under a lock).
	// GORM worker must wait at its real SELECT ... FOR UPDATE for this source.
	lockTx := db.Begin()
	if lockTx.Error != nil {
		t.Fatal(lockTx.Error)
	}
	defer func() { _ = lockTx.Rollback().Error }()
	var locked meta.Node
	if err := lockTx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ?", source.ID).
		First(&locked).Error; err != nil {
		t.Fatal(err)
	}
	if locked.ID != source.ID {
		t.Fatalf("unexpected source row lock identity=%d want=%d", locked.ID, source.ID)
	}

	type workerResult struct {
		processed bool
		err       error
	}
	workerDone := make(chan workerResult, 1)
	go func() {
		processed, err := srv.processNextFileOperation(context.Background())
		workerDone <- workerResult{processed: processed, err: err}
	}()

	// The claim must become genuinely RUNNING and install the real Worker
	// cancel cause before sending the HTTP request. Poll boundedly; don't
	// assume a fabricated running state or race ahead of registration.
	deadline := time.After(timeout)
	registered := false
	for !registered {
		select {
		case result := <-workerDone:
			t.Fatalf("worker escaped held source lock before cancellation: %+v", result)
		case <-deadline:
			t.Fatal("worker never claimed and registered a cancellable running operation")
		default:
		}
		status, err := cli.GetFileOperation(ctx, operation.ID)
		if err != nil {
			t.Fatal(err)
		}
		if status.Status != meta.FileOperationStatusQueued &&
			status.Status != meta.FileOperationStatusRunning {
			t.Fatalf("unexpected pre-cancel live status: %+v", status)
		}
		srv.fileOperationCancelMu.Lock()
		cancel := srv.fileOperationCancels[operation.ID]
		srv.fileOperationCancelMu.Unlock()
		registered = status.Status == meta.FileOperationStatusRunning && cancel != nil
		if !registered {
			select {
			case <-time.After(15 * time.Millisecond):
			case <-deadline:
				t.Fatal("running operation did not register its cancellation")
			}
		}
	}

	// Prove the actual Worker reached PostgreSQL's SELECT ... FOR UPDATE
	// and is waiting on our *separate* source-row transaction, not merely
	// marked running before a not-yet-started SQL statement. This avoids a
	// false pass that cancels between claim and execution.
	blocked := false
	lockWaitDeadline := time.After(timeout)
	for !blocked {
		var waitCount int64
		if err := db.Raw(`SELECT COUNT(*) FROM pg_stat_activity
WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock'
AND state = 'active' AND query ILIKE '%xd_nodes%'
AND query ILIKE '%FOR UPDATE%'`).Scan(&waitCount).Error; err != nil {
			t.Fatal(err)
		}
		blocked = waitCount > 0
		if !blocked {
			select {
			case result := <-workerDone:
				t.Fatalf("worker exited before reaching blocked source query: %+v", result)
			case <-time.After(25 * time.Millisecond):
			case <-lockWaitDeadline:
				t.Fatal("running Worker never reached held PostgreSQL source row")
			}
		}
	}

	acceptedCancel, err := cli.CancelFileOperation(ctx, operation.ID)
	if err != nil {
		t.Fatal(err)
	}
	if acceptedCancel.ID != operation.ID ||
		(acceptedCancel.Status != meta.FileOperationStatusCancelRequested &&
			acceptedCancel.Status != meta.FileOperationStatusCancelled) ||
		acceptedCancel.CancelRequestedAt == nil ||
		acceptedCancel.Status == meta.FileOperationStatusCompleted {
		t.Fatalf("real running cancellation must not report completion: %+v", acceptedCancel)
	}

	// Critical oracle: Worker must exit BEFORE the source row lock is
	// released, proving the actual cancel path interrupted pending SQL.
	select {
	case result := <-workerDone:
		if !result.processed || result.err != nil {
			t.Fatalf("real worker cancel did not settle cleanly: %+v", result)
		}
	case <-time.After(timeout):
		t.Fatal("running worker did not exit while source row remained locked")
	}
	if err := lockTx.Rollback().Error; err != nil {
		t.Fatal(err)
	}

	terminal, err := cli.GetFileOperation(ctx, operation.ID)
	if err != nil {
		t.Fatal(err)
	}
	if terminal.Status != meta.FileOperationStatusCancelled ||
		terminal.ProcessedItems != 0 || terminal.ProcessedBytes != 0 ||
		terminal.Percent != 0 || terminal.FinishedAt == nil ||
		terminal.CancelRequestedAt == nil {
		t.Fatalf("cancelled running worker must have truthful terminal zero progress: %+v", terminal)
	}
	if after := basicFileExplorerRange(t, cli, target.ID); after.TotalCount != 0 {
		t.Fatalf("running cancellation must roll back all target Nodes: %+v", after)
	}
}

func basicFileExplorerRange(
	t *testing.T,
	cli *clientpkg.Client,
	parentID uint64,
) clientpkg.ChildrenRange {
	t.Helper()
	page, err := cli.ListRange(context.Background(), parentID, clientpkg.ChildrenRangeOptions{
		Offset: 0,
		Limit:  200,
		Sort:   "name",
		Order:  "asc",
	})
	if err != nil {
		t.Fatal(err)
	}
	if page.Offset != 0 || page.Limit != 200 || !page.HasTotalCount() {
		t.Fatalf("unexpected FileExplorer range contract: %+v", page)
	}
	return page
}

func basicRangeHasNode(page clientpkg.ChildrenRange, nodeID uint64) bool {
	for _, node := range page.Items {
		if node.ID == nodeID {
			return true
		}
	}
	return false
}

func basicRangeNodeByName(
	t *testing.T,
	page clientpkg.ChildrenRange,
	name string,
) clientpkg.Node {
	t.Helper()
	for _, node := range page.Items {
		if node.Name == name {
			return node
		}
	}
	t.Fatalf("range missing %q: %+v", name, page.Items)
	return clientpkg.Node{}
}

func processBasicFileOperation(
	t *testing.T,
	srv *Server,
	cli *clientpkg.Client,
	operationID string,
) clientpkg.FileOperation {
	t.Helper()
	processed, err := srv.processNextFileOperation(context.Background())
	if err != nil || !processed {
		t.Fatalf("process file operation %s: processed=%v err=%v", operationID, processed, err)
	}
	current, err := cli.GetFileOperation(context.Background(), operationID)
	if err != nil {
		t.Fatal(err)
	}
	if current.Status != meta.FileOperationStatusCompleted ||
		current.ProcessedItems != current.TotalItems ||
		current.ProcessedBytes != current.TotalBytes {
		t.Fatalf("file operation did not complete cleanly: %+v", current)
	}
	return current
}

// assertBasicU04DurableTaskReceipt opens a NEW authenticated Client against
// the same real Gin/PostgreSQL store after task status transitions.
// A persisted Task Center receipt is independent of a one-off UI toast.
func assertBasicU04DurableTaskReceipt(
	t *testing.T,
	baseURL, ownerToken, foreignToken, operationID, expectedStatus string,
) {
	t.Helper()
	ctx := context.Background()
	reconnected := clientpkg.New(baseURL, ownerToken)
	got, err := reconnected.GetFileOperation(ctx, operationID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != operationID || got.Status != expectedStatus ||
		got.TotalItems != 1 || got.Type == "" {
		t.Fatalf("U04 reconnected GET: %+v want=%s %s", got, operationID, expectedStatus)
	}
	switch expectedStatus {
	case meta.FileOperationStatusQueued:
		if got.StartedAt != nil || got.FinishedAt != nil ||
			got.ProcessedItems != 0 || got.ProcessedBytes != 0 || got.Percent != 0 {
			t.Fatalf("U04 queued receipt falsely implied completion: %+v", got)
		}
	case meta.FileOperationStatusCancelled:
		if got.FinishedAt == nil || got.ProcessedItems != 0 ||
			got.ProcessedBytes != 0 || got.Percent != 0 {
			t.Fatalf("U04 cancelled receipt falsely implied committed bytes: %+v", got)
		}
	case meta.FileOperationStatusCompleted:
		if got.FinishedAt == nil || got.ProcessedItems != got.TotalItems ||
			got.ProcessedBytes != got.TotalBytes || got.Percent != 100 {
			t.Fatalf("U04 completed receipt lacks actual Worker commit: %+v", got)
		}
	default:
		t.Fatalf("unsupported U04 receipt status: %q", expectedStatus)
	}
	rows, err := reconnected.ListFileOperations(ctx, 50)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, row := range rows {
		if row.ID != operationID {
			continue
		}
		if found || row.Status != got.Status || row.Type != got.Type ||
			row.TotalItems != got.TotalItems || row.ProcessedItems != got.ProcessedItems ||
			row.TotalBytes != got.TotalBytes || row.ProcessedBytes != got.ProcessedBytes ||
			row.Percent != got.Percent || (row.FinishedAt == nil) != (got.FinishedAt == nil) {
			t.Fatalf("U04 Task Center list disagrees with GET: get=%+v list=%+v", got, row)
		}
		found = true
	}
	if !found {
		t.Fatalf("U04 operation missing after re-entry: %s", operationID)
	}
	foreign := clientpkg.New(baseURL, foreignToken)
	foreignRows, err := foreign.ListFileOperations(ctx, 50)
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range foreignRows {
		if row.ID == operationID {
			t.Fatalf("U04 Owner boundary leaked task after re-entry: %s", operationID)
		}
	}
}

// assertBasicQueuedFileOperation uses the actual Client->Gin->PostgreSQL
// control plane: a newly accepted task has an ID, but no committed file
// mutations, progress, or terminal receipt. The same lifecycle must be
// visible through GET and the Task Center's owner-scoped list.
func assertBasicQueuedFileOperation(
	t *testing.T,
	cli *clientpkg.Client,
	accepted clientpkg.FileOperation,
) {
	t.Helper()
	ctx := context.Background()
	assertPending := func(source string, op clientpkg.FileOperation) {
		t.Helper()
		if op.ID != accepted.ID || op.Status != meta.FileOperationStatusQueued ||
			op.TotalItems != 1 || op.ProcessedItems != 0 || op.ProcessedBytes != 0 ||
			op.Percent != 0 || op.CurrentItem != "" || op.StartedAt != nil ||
			op.FinishedAt != nil || op.CancelRequestedAt != nil || op.Undoable {
			t.Fatalf("%s represented queued acceptance as committed progress: %+v", source, op)
		}
	}
	assertPending("POST", accepted)
	fetched, err := cli.GetFileOperation(ctx, accepted.ID)
	if err != nil {
		t.Fatal(err)
	}
	assertPending("GET", fetched)
	operations, err := cli.ListFileOperations(ctx, 20)
	if err != nil {
		t.Fatal(err)
	}
	for _, operation := range operations {
		if operation.ID == accepted.ID {
			assertPending("list", operation)
			return
		}
	}
	t.Fatalf("accepted operation %s missing from owner-scoped task list", accepted.ID)
}

func assertBasicNodeChange(
	t *testing.T,
	page clientpkg.NodeChangePage,
	nodeID uint64,
	operation string,
	parentIDs ...uint64,
) {
	t.Helper()
	for _, change := range page.Changes {
		if change.NodeID != nodeID {
			continue
		}
		if change.Operation != operation {
			t.Fatalf("node %d change operation=%q want=%q", nodeID, change.Operation, operation)
		}
		got := append([]uint64(nil), change.AffectedParentIDs...)
		want := append([]uint64(nil), parentIDs...)
		sort.Slice(got, func(i, j int) bool { return got[i] < got[j] })
		sort.Slice(want, func(i, j int) bool { return want[i] < want[j] })
		if fmt.Sprint(got) != fmt.Sprint(want) {
			t.Fatalf("node %d affected parents=%v want=%v", nodeID, got, want)
		}
		if operation == "upsert" && change.Node == nil {
			t.Fatalf("node %d upsert change has no node payload", nodeID)
		}
		if operation == "delete" && change.Node != nil {
			t.Fatalf("node %d delete change unexpectedly has node payload", nodeID)
		}
		return
	}
	t.Fatalf("node %d %s change not found in %+v", nodeID, operation, page.Changes)
}

func basicArchiveEntries(t *testing.T, raw []byte) map[string]string {
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
