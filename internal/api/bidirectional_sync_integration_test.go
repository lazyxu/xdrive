package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
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

type bidirectionalSyncFixture struct {
	db     *gorm.DB
	router http.Handler
	token  string
	client *clientpkg.Client
	server *httptest.Server
}

func newBidirectionalSyncFixture(t *testing.T) bidirectionalSyncFixture {
	t.Helper()
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)

	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "bidirectional_sync_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		Auth:           auth.New("bidirectional-sync-secret", time.Hour),
		RefreshTTL:     24 * time.Hour,
		AllowedOrigin:  "http://localhost",
		MaxUploadBytes: 32 << 20,
	}).Router()
	token := createTestUser(t, db, router, "sync-user", "sync-password")
	server := httptest.NewServer(router)
	t.Cleanup(server.Close)

	return bidirectionalSyncFixture{
		db: db, router: router, token: token,
		client: clientpkg.New(server.URL, token),
		server: server,
	}
}

func TestBidirectionalSyncWebToClientLifecycle(t *testing.T) {
	f := newBidirectionalSyncFixture(t)
	ctx := context.Background()

	webRoot := requestNode(t, f.router, http.MethodGet, "/api/v1/nodes/root", f.token, nil, http.StatusOK)
	clientRoot, err := f.client.Root(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if clientRoot.ID != webRoot.ID {
		t.Fatalf("root id mismatch: web=%d client=%d", webRoot.ID, clientRoot.ID)
	}

	webA := requestNode(t, f.router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", webRoot.ID),
		f.token, strings.NewReader(`{"name":"WebA"}`), http.StatusCreated)
	webB := requestNode(t, f.router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", webRoot.ID),
		f.token, strings.NewReader(`{"name":"WebB"}`), http.StatusCreated)
	webFile := uploadTestFile(t, f.router, f.token, webA.ID, "web.txt", "web-v1")

	assertClientPath(t, ctx, f.client, "WebA/web.txt", webFile.ID)
	assertClientContent(t, ctx, f.client, webFile.ID, "web-v1")

	webUpdated := requestNodeWithHeaders(t, f.router, http.MethodPut,
		fmt.Sprintf("/api/v1/files/%d/content", webFile.ID),
		f.token, strings.NewReader("web-v2"), http.StatusOK,
		map[string]string{"If-Match": syncETag(webFile.Revision)})
	if webUpdated.Revision <= webFile.Revision {
		t.Fatalf("overwrite did not advance revision: before=%d after=%d", webFile.Revision, webUpdated.Revision)
	}
	assertClientContent(t, ctx, f.client, webFile.ID, "web-v2")

	versions, err := f.client.Versions(ctx, webFile.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(versions) != 1 || versions[0].Revision != webFile.Revision {
		t.Fatalf("client version history=%+v", versions)
	}

	webMoved := requestNodeWithHeaders(t, f.router, http.MethodPatch,
		fmt.Sprintf("/api/v1/nodes/%d", webFile.ID),
		f.token,
		strings.NewReader(fmt.Sprintf(`{"name":"web-renamed.txt","parent_id":%d}`, webB.ID)),
		http.StatusOK,
		map[string]string{"If-Match": syncETag(webUpdated.Revision)})
	if webMoved.ID != webFile.ID {
		t.Fatalf("web move recreated node: before=%d after=%d", webFile.ID, webMoved.ID)
	}
	assertClientPathMissing(t, ctx, f.client, "WebA/web.txt")
	assertClientPath(t, ctx, f.client, "WebB/web-renamed.txt", webFile.ID)

	webTree := requestNode(t, f.router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", webA.ID),
		f.token, strings.NewReader(`{"name":"WebTree"}`), http.StatusCreated)
	webNested := requestNode(t, f.router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", webTree.ID),
		f.token, strings.NewReader(`{"name":"Nested"}`), http.StatusCreated)
	webLeaf := uploadTestFile(t, f.router, f.token, webNested.ID, "leaf.txt", "leaf-v1")
	assertClientPath(t, ctx, f.client, "WebA/WebTree/Nested/leaf.txt", webLeaf.ID)

	webTreeMoved := requestNodeWithHeaders(t, f.router, http.MethodPatch,
		fmt.Sprintf("/api/v1/nodes/%d", webTree.ID),
		f.token,
		strings.NewReader(fmt.Sprintf(`{"name":"WebTreeMoved","parent_id":%d}`, webB.ID)),
		http.StatusOK,
		map[string]string{"If-Match": syncETag(webTree.Revision)})
	if webTreeMoved.ID != webTree.ID {
		t.Fatalf("Web directory move recreated root: before=%d after=%d", webTree.ID, webTreeMoved.ID)
	}
	assertClientPathMissing(t, ctx, f.client, "WebA/WebTree/Nested/leaf.txt")
	assertClientPath(t, ctx, f.client, "WebB/WebTreeMoved/Nested/leaf.txt", webLeaf.ID)

	requestWithHeaders(t, f.router, http.MethodDelete,
		fmt.Sprintf("/api/v1/nodes/%d", webTree.ID),
		f.token, nil, http.StatusNoContent,
		map[string]string{"If-Match": syncETag(webTreeMoved.Revision)})
	assertClientPathMissing(t, ctx, f.client, "WebB/WebTreeMoved/Nested/leaf.txt")
	treeTrash, err := f.client.Trash(ctx)
	if err != nil {
		t.Fatal(err)
	}
	deletedTree := findClientNode(treeTrash, webTree.ID)
	if deletedTree == nil {
		t.Fatalf("client trash missing Web-deleted directory tree root: %+v", treeTrash)
	}
	treeRestored := requestNodeWithHeaders(t, f.router, http.MethodPost,
		fmt.Sprintf("/api/v1/trash/%d/restore", webTree.ID),
		f.token, nil, http.StatusOK,
		map[string]string{"If-Match": syncETag(deletedTree.Revision)})
	if treeRestored.ID != webTree.ID {
		t.Fatalf("Web directory restore recreated root: before=%d after=%d", webTree.ID, treeRestored.ID)
	}
	assertClientPath(t, ctx, f.client, "WebB/WebTreeMoved/Nested/leaf.txt", webLeaf.ID)

	requestWithHeaders(t, f.router, http.MethodDelete,
		fmt.Sprintf("/api/v1/nodes/%d", webFile.ID),
		f.token, nil, http.StatusNoContent,
		map[string]string{"If-Match": syncETag(webMoved.Revision)})
	assertClientPathMissing(t, ctx, f.client, "WebB/web-renamed.txt")

	trash, err := f.client.Trash(ctx)
	if err != nil {
		t.Fatal(err)
	}
	deleted := findClientNode(trash, webFile.ID)
	if deleted == nil || deleted.DeletedAt == nil || deleted.Revision != webMoved.Revision+1 {
		t.Fatalf("client trash entry=%+v", deleted)
	}

	restored := requestNodeWithHeaders(t, f.router, http.MethodPost,
		fmt.Sprintf("/api/v1/trash/%d/restore", webFile.ID),
		f.token, nil, http.StatusOK,
		map[string]string{"If-Match": syncETag(deleted.Revision)})
	if restored.ID != webFile.ID || restored.Revision != deleted.Revision+1 {
		t.Fatalf("restored node=%+v", restored)
	}
	assertClientPath(t, ctx, f.client, "WebB/web-renamed.txt", webFile.ID)
	assertClientContent(t, ctx, f.client, webFile.ID, "web-v2")

	versions, err = f.client.Versions(ctx, webFile.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(versions) == 0 {
		t.Fatal("version history disappeared after trash restore")
	}
	versionV1 := versions[len(versions)-1]
	versionRestored := requestNodeWithHeaders(t, f.router, http.MethodPost,
		fmt.Sprintf("/api/v1/files/%d/versions/%d/restore", webFile.ID, versionV1.ID),
		f.token, nil, http.StatusOK,
		map[string]string{"If-Match": syncETag(restored.Revision)})
	if versionRestored.ID != webFile.ID || versionRestored.Revision != restored.Revision+1 {
		t.Fatalf("version restore recreated node or revision did not advance: %+v", versionRestored)
	}
	assertClientContent(t, ctx, f.client, webFile.ID, "web-v1")
}

func TestBidirectionalSyncClientToWebLifecycle(t *testing.T) {
	f := newBidirectionalSyncFixture(t)
	ctx := context.Background()

	root, err := f.client.Root(ctx)
	if err != nil {
		t.Fatal(err)
	}
	clientA, err := f.client.CreateDir(ctx, root.ID, "ClientA")
	if err != nil {
		t.Fatal(err)
	}
	clientB, err := f.client.CreateDir(ctx, root.ID, "ClientB")
	if err != nil {
		t.Fatal(err)
	}
	assertWebChild(t, f.router, f.token, root.ID, clientA.ID, "ClientA")
	assertWebChild(t, f.router, f.token, root.ID, clientB.ID, "ClientB")

	clientFile, err := f.client.Upload(ctx, clientA.ID, "client.txt", strings.NewReader("client-v1"))
	if err != nil {
		t.Fatal(err)
	}
	assertWebChild(t, f.router, f.token, clientA.ID, clientFile.ID, "client.txt")
	assertWebContent(t, f.router, f.token, clientFile.ID, "client-v1")

	clientUpdated, err := f.client.Overwrite(ctx, clientFile.ID, clientFile.Revision, strings.NewReader("client-v2"))
	if err != nil {
		t.Fatal(err)
	}
	assertWebContent(t, f.router, f.token, clientFile.ID, "client-v2")

	clientEmpty, err := f.client.Overwrite(ctx, clientFile.ID, clientUpdated.Revision, strings.NewReader(""))
	if err != nil {
		t.Fatal(err)
	}
	if clientEmpty.Size != 0 {
		t.Fatalf("empty overwrite size=%d", clientEmpty.Size)
	}
	assertWebContent(t, f.router, f.token, clientFile.ID, "")

	clientRefilled, err := f.client.Overwrite(ctx, clientFile.ID, clientEmpty.Revision, strings.NewReader("client-v3"))
	if err != nil {
		t.Fatal(err)
	}
	newName := "client-renamed.txt"
	moved, err := f.client.RenameMove(ctx, clientFile.ID, clientRefilled.Revision, &newName, &clientB.ID)
	if err != nil {
		t.Fatal(err)
	}
	if moved.ID != clientFile.ID {
		t.Fatalf("client move recreated node: before=%d after=%d", clientFile.ID, moved.ID)
	}
	assertWebChildMissing(t, f.router, f.token, clientA.ID, clientFile.ID)
	assertWebChild(t, f.router, f.token, clientB.ID, clientFile.ID, newName)

	treeRoot, err := f.client.CreateDir(ctx, clientA.ID, "Tree")
	if err != nil {
		t.Fatal(err)
	}
	treeNested, err := f.client.CreateDir(ctx, treeRoot.ID, "Nested")
	if err != nil {
		t.Fatal(err)
	}
	treeFile, err := f.client.Upload(ctx, treeNested.ID, "leaf.txt", strings.NewReader("leaf"))
	if err != nil {
		t.Fatal(err)
	}
	treeName := "TreeMoved"
	treeMoved, err := f.client.RenameMove(ctx, treeRoot.ID, treeRoot.Revision, &treeName, &clientB.ID)
	if err != nil {
		t.Fatal(err)
	}
	if treeMoved.ID != treeRoot.ID {
		t.Fatalf("directory move recreated root node: before=%d after=%d", treeRoot.ID, treeMoved.ID)
	}
	assertWebChild(t, f.router, f.token, clientB.ID, treeRoot.ID, treeName)
	assertWebChild(t, f.router, f.token, treeRoot.ID, treeNested.ID, "Nested")
	assertWebChild(t, f.router, f.token, treeNested.ID, treeFile.ID, "leaf.txt")

	if err := f.client.Delete(ctx, treeMoved.ID, treeMoved.Revision); err != nil {
		t.Fatal(err)
	}
	assertWebChildMissing(t, f.router, f.token, clientB.ID, treeRoot.ID)
	treeTrashRes := request(t, f.router, http.MethodGet, "/api/v1/trash", f.token, nil, http.StatusOK)
	var treeTrash []nodeDTO
	if err := json.Unmarshal(treeTrashRes.Body.Bytes(), &treeTrash); err != nil {
		t.Fatal(err)
	}
	var deletedTree *nodeDTO
	for i := range treeTrash {
		if treeTrash[i].ID == treeRoot.ID {
			deletedTree = &treeTrash[i]
			break
		}
	}
	if deletedTree == nil {
		t.Fatalf("Web trash missing client-deleted directory root: %+v", treeTrash)
	}
	treeRestored, err := f.client.RestoreTrash(ctx, treeRoot.ID, deletedTree.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if treeRestored.ID != treeRoot.ID {
		t.Fatalf("client directory restore recreated root: before=%d after=%d", treeRoot.ID, treeRestored.ID)
	}
	assertWebChild(t, f.router, f.token, clientB.ID, treeRoot.ID, treeName)
	assertWebChild(t, f.router, f.token, treeRoot.ID, treeNested.ID, "Nested")
	assertWebChild(t, f.router, f.token, treeNested.ID, treeFile.ID, "leaf.txt")

	if err := f.client.Delete(ctx, moved.ID, moved.Revision); err != nil {
		t.Fatal(err)
	}
	assertWebChildMissing(t, f.router, f.token, clientB.ID, clientFile.ID)
	webTrash := request(t, f.router, http.MethodGet, "/api/v1/trash", f.token, nil, http.StatusOK)
	var trash []nodeDTO
	if err := json.Unmarshal(webTrash.Body.Bytes(), &trash); err != nil {
		t.Fatal(err)
	}
	var deleted *nodeDTO
	for i := range trash {
		if trash[i].ID == clientFile.ID {
			deleted = &trash[i]
			break
		}
	}
	if deleted == nil || deleted.DeletedAt == nil {
		t.Fatalf("web trash does not contain client-deleted file: %+v", trash)
	}

	clientRestored, err := f.client.RestoreTrash(ctx, clientFile.ID, deleted.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if clientRestored.ID != clientFile.ID {
		t.Fatalf("client restore recreated node: before=%d after=%d", clientFile.ID, clientRestored.ID)
	}
	assertWebChild(t, f.router, f.token, clientB.ID, clientFile.ID, newName)

	versions, err := f.client.Versions(ctx, clientFile.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(versions) < 3 {
		t.Fatalf("expected overwrite history, got %+v", versions)
	}
	var original *clientpkg.FileVersion
	for i := range versions {
		if versions[i].Revision == clientFile.Revision {
			original = &versions[i]
			break
		}
	}
	if original == nil {
		t.Fatalf("original version not present: %+v", versions)
	}
	versionRestored, err := f.client.RestoreVersion(ctx, clientFile.ID, clientRestored.Revision, original.ID)
	if err != nil {
		t.Fatal(err)
	}
	if versionRestored.ID != clientFile.ID {
		t.Fatalf("version restore recreated node: before=%d after=%d", clientFile.ID, versionRestored.ID)
	}
	assertWebContent(t, f.router, f.token, clientFile.ID, "client-v1")
}

func TestBidirectionalSyncTwoClientsConvergeThroughServer(t *testing.T) {
	f := newBidirectionalSyncFixture(t)
	ctx := context.Background()
	clientA := f.client
	clientB := clientpkg.New(f.server.URL, f.token)

	root, err := clientA.Root(ctx)
	if err != nil {
		t.Fatal(err)
	}
	dir, err := clientA.CreateDir(ctx, root.ID, "Shared")
	if err != nil {
		t.Fatal(err)
	}
	created, err := clientA.Upload(ctx, dir.ID, "two-client.txt", strings.NewReader("from-a"))
	if err != nil {
		t.Fatal(err)
	}
	assertClientPath(t, ctx, clientB, "Shared/two-client.txt", created.ID)
	assertClientContent(t, ctx, clientB, created.ID, "from-a")

	bSnapshot := assertClientPath(t, ctx, clientB, "Shared/two-client.txt", created.ID)
	updated, err := clientB.Overwrite(ctx, bSnapshot.ID, bSnapshot.Revision, strings.NewReader("from-b"))
	if err != nil {
		t.Fatal(err)
	}
	assertClientContent(t, ctx, clientA, created.ID, "from-b")

	webRenamed := requestNodeWithHeaders(t, f.router, http.MethodPatch,
		fmt.Sprintf("/api/v1/nodes/%d", created.ID),
		f.token, strings.NewReader(`{"name":"two-client-renamed.txt"}`), http.StatusOK,
		map[string]string{"If-Match": syncETag(updated.Revision)})
	assertClientPathMissing(t, ctx, clientA, "Shared/two-client.txt")
	assertClientPathMissing(t, ctx, clientB, "Shared/two-client.txt")
	assertClientPath(t, ctx, clientA, "Shared/two-client-renamed.txt", created.ID)
	assertClientPath(t, ctx, clientB, "Shared/two-client-renamed.txt", created.ID)

	aSnapshot := assertClientPath(t, ctx, clientA, "Shared/two-client-renamed.txt", created.ID)
	if aSnapshot.Revision != webRenamed.Revision {
		t.Fatalf("client A revision=%d want=%d", aSnapshot.Revision, webRenamed.Revision)
	}
	if err := clientA.Delete(ctx, created.ID, aSnapshot.Revision); err != nil {
		t.Fatal(err)
	}
	assertClientPathMissing(t, ctx, clientB, "Shared/two-client-renamed.txt")
	trash, err := clientB.Trash(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if findClientNode(trash, created.ID) == nil {
		t.Fatalf("client B did not observe client A deletion in trash: %+v", trash)
	}
}

func TestBidirectionalSyncRapidUnicodeAndCaseOnlyOperations(t *testing.T) {
	f := newBidirectionalSyncFixture(t)
	ctx := context.Background()
	root, err := f.client.Root(ctx)
	if err != nil {
		t.Fatal(err)
	}

	unicodeDir, err := f.client.CreateDir(ctx, root.ID, "中文 目录")
	if err != nil {
		t.Fatal(err)
	}
	unicodeFile, err := f.client.Upload(ctx, unicodeDir.ID, "报告 2026.txt", strings.NewReader("内容-v1"))
	if err != nil {
		t.Fatal(err)
	}
	assertWebChild(t, f.router, f.token, unicodeDir.ID, unicodeFile.ID, "报告 2026.txt")
	assertWebContent(t, f.router, f.token, unicodeFile.ID, "内容-v1")

	caseFile, err := f.client.Upload(ctx, root.ID, "CaseName.txt", strings.NewReader("case"))
	if err != nil {
		t.Fatal(err)
	}
	caseOnly := "casename.txt"
	caseRenamed, err := f.client.RenameMove(ctx, caseFile.ID, caseFile.Revision, &caseOnly, nil)
	if err != nil {
		t.Fatal(err)
	}
	if caseRenamed.ID != caseFile.ID {
		t.Fatalf("case-only rename recreated node: before=%d after=%d", caseFile.ID, caseRenamed.ID)
	}
	assertWebChild(t, f.router, f.token, root.ID, caseFile.ID, caseOnly)

	rapid, err := f.client.Upload(ctx, root.ID, "rapid.txt", strings.NewReader("rapid"))
	if err != nil {
		t.Fatal(err)
	}
	rapidName := "rapid-renamed.txt"
	rapid, err = f.client.RenameMove(ctx, rapid.ID, rapid.Revision, &rapidName, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.client.Delete(ctx, rapid.ID, rapid.Revision); err != nil {
		t.Fatal(err)
	}
	assertWebChildMissing(t, f.router, f.token, root.ID, rapid.ID)
	trash, err := f.client.Trash(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var count int
	for _, node := range trash {
		if node.ID == rapid.ID {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("rapid create/rename/delete produced %d trash entries, want 1: %+v", count, trash)
	}
}

func TestBidirectionalSyncRevisionConflictsDoNotLoseData(t *testing.T) {
	f := newBidirectionalSyncFixture(t)
	ctx := context.Background()
	root := requestNode(t, f.router, http.MethodGet, "/api/v1/nodes/root", f.token, nil, http.StatusOK)

	file := uploadTestFile(t, f.router, f.token, root.ID, "conflict.txt", "base")
	clientSnapshot, err := f.client.List(ctx, root.ID)
	if err != nil {
		t.Fatal(err)
	}
	stale := findClientNode(clientSnapshot, file.ID)
	if stale == nil {
		t.Fatal("client did not observe conflict.txt")
	}

	webUpdated := requestNodeWithHeaders(t, f.router, http.MethodPut,
		fmt.Sprintf("/api/v1/files/%d/content", file.ID),
		f.token, strings.NewReader("web-wins"), http.StatusOK,
		map[string]string{"If-Match": syncETag(file.Revision)})
	if _, err := f.client.Overwrite(ctx, file.ID, stale.Revision, strings.NewReader("stale-client-write")); !clientpkg.IsRevisionConflict(err) {
		t.Fatalf("stale client overwrite error=%v want revision conflict", err)
	}
	assertWebContent(t, f.router, f.token, file.ID, "web-wins")

	if err := f.client.Delete(ctx, file.ID, stale.Revision); !clientpkg.IsRevisionConflict(err) {
		t.Fatalf("stale client delete error=%v want revision conflict", err)
	}
	assertWebContent(t, f.router, f.token, file.ID, "web-wins")

	clientUpdated, err := f.client.Overwrite(ctx, file.ID, webUpdated.Revision, strings.NewReader("client-wins"))
	if err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, f.router, http.MethodDelete,
		fmt.Sprintf("/api/v1/nodes/%d", file.ID),
		f.token, nil, http.StatusConflict,
		map[string]string{"If-Match": syncETag(webUpdated.Revision)})
	assertClientContent(t, ctx, f.client, file.ID, "client-wins")
	if clientUpdated.Revision != webUpdated.Revision+1 {
		t.Fatalf("client revision=%d want=%d", clientUpdated.Revision, webUpdated.Revision+1)
	}
}

func assertClientPath(t *testing.T, ctx context.Context, cli *clientpkg.Client, path string, id uint64) clientpkg.Node {
	t.Helper()
	nodes, err := cli.Walk(ctx)
	if err != nil {
		t.Fatal(err)
	}
	node, ok := nodes[path]
	if !ok {
		t.Fatalf("client path %q missing; namespace=%v", path, mapKeys(nodes))
	}
	if node.ID != id {
		t.Fatalf("client path %q id=%d want=%d", path, node.ID, id)
	}
	return node
}

func assertClientPathMissing(t *testing.T, ctx context.Context, cli *clientpkg.Client, path string) {
	t.Helper()
	nodes, err := cli.Walk(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if node, ok := nodes[path]; ok {
		t.Fatalf("client path %q unexpectedly exists: %+v", path, node)
	}
}

func assertClientContent(t *testing.T, ctx context.Context, cli *clientpkg.Client, id uint64, want string) {
	t.Helper()
	var out bytes.Buffer
	if err := cli.DownloadTo(ctx, id, &out); err != nil {
		t.Fatal(err)
	}
	if out.String() != want {
		t.Fatalf("client content=%q want=%q", out.String(), want)
	}
}

func assertWebChild(t *testing.T, router http.Handler, token string, parentID, childID uint64, name string) {
	t.Helper()
	res := request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/nodes/%d/children", parentID),
		token, nil, http.StatusOK)
	var children []nodeDTO
	if err := json.Unmarshal(res.Body.Bytes(), &children); err != nil {
		t.Fatal(err)
	}
	for _, child := range children {
		if child.ID == childID {
			if child.Name != name {
				t.Fatalf("web child id=%d name=%q want=%q", childID, child.Name, name)
			}
			return
		}
	}
	t.Fatalf("web child id=%d name=%q missing: %+v", childID, name, children)
}

func assertWebChildMissing(t *testing.T, router http.Handler, token string, parentID, childID uint64) {
	t.Helper()
	res := request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/nodes/%d/children", parentID),
		token, nil, http.StatusOK)
	var children []nodeDTO
	if err := json.Unmarshal(res.Body.Bytes(), &children); err != nil {
		t.Fatal(err)
	}
	for _, child := range children {
		if child.ID == childID {
			t.Fatalf("web child id=%d unexpectedly exists: %+v", childID, child)
		}
	}
}

func assertWebContent(t *testing.T, router http.Handler, token string, id uint64, want string) {
	t.Helper()
	res := request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/files/%d/content", id),
		token, nil, http.StatusOK)
	data, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != want {
		t.Fatalf("web content=%q want=%q", data, want)
	}
}

func findClientNode(nodes []clientpkg.Node, id uint64) *clientpkg.Node {
	for i := range nodes {
		if nodes[i].ID == id {
			return &nodes[i]
		}
	}
	return nil
}

func mapKeys(nodes map[string]clientpkg.Node) []string {
	out := make([]string, 0, len(nodes))
	for key := range nodes {
		out = append(out, key)
	}
	return out
}

func syncETag(revision uint64) string {
	return string('"') + strconv.FormatUint(revision, 10) + string('"')
}
