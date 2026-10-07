package api

import (
	"archive/zip"
	"bytes"
	"context"
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
	clientpkg "github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
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
		&meta.UploadPart{},
		&meta.AuditEvent{},
		&meta.FileOperation{},
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
	srv := &Server{
		DB:             db,
		Store:          store,
		Auth:           auth.New("file-explorer-basic-secret", time.Hour),
		RefreshTTL:     24 * time.Hour,
		AllowedOrigin:  "http://localhost",
		MaxUploadBytes: 32 << 20,
	}
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

	copyOperation, err := cli.CreateFileOperation(
		ctx,
		meta.FileOperationTypeCopy,
		[]clientpkg.BatchNodeRef{{ID: hello.ID, Revision: hello.Revision}},
		target.ID,
	)
	if err != nil {
		t.Fatal(err)
	}
	processBasicFileOperation(t, srv, cli, copyOperation.ID)

	movedOperation, err := cli.CreateFileOperation(
		ctx,
		meta.FileOperationTypeMove,
		[]clientpkg.BatchNodeRef{{ID: moveFile.ID, Revision: moveFile.Revision}},
		target.ID,
	)
	if err != nil {
		t.Fatal(err)
	}
	processBasicFileOperation(t, srv, cli, movedOperation.ID)

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
	processBasicFileOperation(t, srv, cli, deleteOperation.ID)

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
