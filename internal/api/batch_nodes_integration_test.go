package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
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

func TestBatchNodeMutationsAreAtomic(t *testing.T) {
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
		DB: db, Store: store, Auth: auth.New("batch-node-test-secret", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost", MaxUploadBytes: 10 << 20,
	}).Router()

	tokenA := createTestUser(t, db, router, "batch-user", "password-a")
	tokenB := createTestUser(t, db, router, "batch-other", "password-b")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", tokenA, nil, http.StatusOK)
	source := requestNode(
		t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID),
		tokenA, strings.NewReader(`{"name":"source"}`), http.StatusCreated,
	)
	copyTarget := requestNode(
		t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID),
		tokenA, strings.NewReader(`{"name":"copy-target"}`), http.StatusCreated,
	)
	moveTarget := requestNode(
		t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID),
		tokenA, strings.NewReader(`{"name":"move-target"}`), http.StatusCreated,
	)
	fileA := uploadTestFile(t, router, tokenA, source.ID, "a.txt", "aaa")
	fileB := uploadTestFile(t, router, tokenA, source.ID, "b.txt", "bbbb")

	refJSON := func(node nodeDTO) string {
		return fmt.Sprintf(`{"id":%d,"revision":%d}`, node.ID, node.Revision)
	}
	batchBody := func(items string, parentID uint64) string {
		return fmt.Sprintf(`{"items":[%s],"parent_id":%d}`, items, parentID)
	}

	copyRes := request(
		t, router, http.MethodPost, "/api/v1/nodes/batch/copy", tokenA,
		strings.NewReader(batchBody(refJSON(fileA)+","+refJSON(fileB), copyTarget.ID)),
		http.StatusCreated,
	)
	var copied batchNodesResponse
	if err := json.Unmarshal(copyRes.Body.Bytes(), &copied); err != nil {
		t.Fatal(err)
	}
	if copied.OperationID == "" || len(copied.Items) != 2 {
		t.Fatalf("unexpected batch copy result: %+v", copied)
	}
	copyChildren := request(
		t, router, http.MethodGet, fmt.Sprintf("/api/v1/nodes/%d/children", copyTarget.ID),
		tokenA, nil, http.StatusOK,
	)
	var copyItems []nodeDTO
	if err := json.Unmarshal(copyChildren.Body.Bytes(), &copyItems); err != nil {
		t.Fatal(err)
	}
	if len(copyItems) != 2 || copyItems[0].Name != "a.txt" || copyItems[1].Name != "b.txt" {
		t.Fatalf("unexpected copied children: %+v", copyItems)
	}

	staleMove := fmt.Sprintf(
		`{"items":[%s,{"id":%d,"revision":%d}],"parent_id":%d}`,
		refJSON(fileA), fileB.ID, fileB.Revision+99, moveTarget.ID,
	)
	request(t, router, http.MethodPost, "/api/v1/nodes/batch/move", tokenA, strings.NewReader(staleMove), http.StatusConflict)
	assertBatchNodeParent(t, db, fileA.ID, source.ID)
	assertBatchNodeParent(t, db, fileB.ID, source.ID)

	staleDelete := fmt.Sprintf(
		`{"items":[%s,{"id":%d,"revision":%d}]}`,
		refJSON(fileA), fileB.ID, fileB.Revision+99,
	)
	request(t, router, http.MethodPost, "/api/v1/nodes/batch/delete", tokenA, strings.NewReader(staleDelete), http.StatusConflict)
	assertBatchNodeActive(t, db, fileA.ID)
	assertBatchNodeActive(t, db, fileB.ID)

	moveRes := request(
		t, router, http.MethodPost, "/api/v1/nodes/batch/move", tokenA,
		strings.NewReader(batchBody(refJSON(fileA)+","+refJSON(fileB), moveTarget.ID)),
		http.StatusOK,
	)
	var moved batchNodesResponse
	if err := json.Unmarshal(moveRes.Body.Bytes(), &moved); err != nil {
		t.Fatal(err)
	}
	if moved.OperationID == "" || len(moved.Items) != 2 {
		t.Fatalf("unexpected batch move result: %+v", moved)
	}
	assertBatchNodeParent(t, db, fileA.ID, moveTarget.ID)
	assertBatchNodeParent(t, db, fileB.ID, moveTarget.ID)

	deleteItems := fmt.Sprintf(
		`{"items":[{"id":%d,"revision":%d},{"id":%d,"revision":%d}]}`,
		moved.Items[0].ID, moved.Items[0].Revision,
		moved.Items[1].ID, moved.Items[1].Revision,
	)
	deleteRes := request(
		t, router, http.MethodPost, "/api/v1/nodes/batch/delete", tokenA,
		strings.NewReader(deleteItems), http.StatusOK,
	)
	var deleted batchNodesResponse
	if err := json.Unmarshal(deleteRes.Body.Bytes(), &deleted); err != nil {
		t.Fatal(err)
	}
	if deleted.OperationID == "" || len(deleted.DeletedIDs) != 2 {
		t.Fatalf("unexpected batch delete result: %+v", deleted)
	}

	parent := requestNode(
		t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID),
		tokenA, strings.NewReader(`{"name":"nested-parent"}`), http.StatusCreated,
	)
	child := uploadTestFile(t, router, tokenA, parent.ID, "nested.txt", "nested")
	nestedDelete := fmt.Sprintf(
		`{"items":[{"id":%d,"revision":%d},{"id":%d,"revision":%d}]}`,
		parent.ID, parent.Revision, child.ID, child.Revision,
	)
	request(t, router, http.MethodPost, "/api/v1/nodes/batch/delete", tokenA, strings.NewReader(nestedDelete), http.StatusOK)
	var deletedChild meta.Node
	if err := db.Unscoped().First(&deletedChild, child.ID).Error; err != nil {
		t.Fatal(err)
	}
	if deletedChild.DeletedAt == nil || deletedChild.TrashRootID == nil || *deletedChild.TrashRootID != parent.ID {
		t.Fatalf("nested child should share parent trash root: %+v", deletedChild)
	}

	crossUserCopy := fmt.Sprintf(
		`{"items":[{"id":%d,"revision":%d}],"parent_id":%d}`,
		copyItems[0].ID, copyItems[0].Revision, copyTarget.ID,
	)
	request(t, router, http.MethodPost, "/api/v1/nodes/batch/copy", tokenB, strings.NewReader(crossUserCopy), http.StatusBadRequest)
}

func assertBatchNodeParent(t *testing.T, db *gorm.DB, id, parentID uint64) {
	t.Helper()
	var node meta.Node
	if err := db.First(&node, id).Error; err != nil {
		t.Fatal(err)
	}
	if node.ParentID == nil || *node.ParentID != parentID {
		t.Fatalf("node %d parent=%v want=%d", id, node.ParentID, parentID)
	}
}

func assertBatchNodeActive(t *testing.T, db *gorm.DB, id uint64) {
	t.Helper()
	var node meta.Node
	if err := db.First(&node, id).Error; err != nil {
		t.Fatal(err)
	}
	if node.DeletedAt != nil {
		t.Fatalf("node %d unexpectedly deleted", id)
	}
}
