package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
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

func TestGlobalContentDedupQuotaAndLastReferenceDeletion(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)

	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "dedup_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error
	}()

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
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{}, &meta.ContentBlob{},
		&meta.Share{}, &meta.UploadSession{}, &meta.UploadPart{}, &meta.AuditEvent{},
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
	server := &Server{
		DB: db, Store: store,
		Auth:           auth.New("dedup-integration-secret", time.Hour),
		RefreshTTL:     24 * time.Hour,
		AllowedOrigin:  "http://localhost",
		MaxUploadBytes: 32 << 20,
	}
	router := server.Router()

	aliceToken := createTestUser(t, db, router, "dedup-alice", "dedup-password-a")
	bobToken := createTestUser(t, db, router, "dedup-bob", "dedup-password-b")
	var aliceUser meta.User
	if err := db.Where("username = ?", "dedup-alice").First(&aliceUser).Error; err != nil {
		t.Fatal(err)
	}
	aliceRoot := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", aliceToken, nil, http.StatusOK)
	bobRoot := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", bobToken, nil, http.StatusOK)

	const payload = "global-content-addressed-dedup-payload"
	aliceOne := uploadTestFile(t, router, aliceToken, aliceRoot.ID, "a-one.bin", payload)
	var firstFile meta.File
	if err := db.Where("node_id = ?", aliceOne.ID).First(&firstFile).Error; err != nil {
		t.Fatal(err)
	}
	if !storage.IsContentAddressedKey(firstFile.StorageKey) {
		t.Fatalf("first storage key is not CAS: %q", firstFile.StorageKey)
	}
	if err := store.Delete(context.Background(), firstFile.StorageKey); err != nil {
		t.Fatal(err)
	}

	// A new identical upload must repair a missing CAS object before retaining
	// another metadata reference.
	aliceTwo := uploadTestFile(t, router, aliceToken, aliceRoot.ID, "a-two.bin", payload)
	repaired, err := store.Open(context.Background(), firstFile.StorageKey)
	if err != nil {
		t.Fatalf("missing CAS object was not repaired: %v", err)
	}
	repairedBytes, err := io.ReadAll(repaired)
	_ = repaired.Close()
	if err != nil || string(repairedBytes) != payload {
		t.Fatalf("repaired CAS content=%q err=%v", repairedBytes, err)
	}

	bobOne := uploadTestFile(t, router, bobToken, bobRoot.ID, "b-one.bin", payload)

	var files []meta.File
	if err := db.Where("node_id IN ?", []uint64{aliceOne.ID, aliceTwo.ID, bobOne.ID}).Order("node_id").Find(&files).Error; err != nil {
		t.Fatal(err)
	}
	if len(files) != 3 {
		t.Fatalf("files=%+v", files)
	}
	key := files[0].StorageKey
	if !storage.IsContentAddressedKey(key) {
		t.Fatalf("storage key is not CAS: %q", key)
	}
	for _, file := range files[1:] {
		if file.StorageKey != key {
			t.Fatalf("identical content was not deduplicated: %q != %q", file.StorageKey, key)
		}
	}

	var blob meta.ContentBlob
	if err := db.First(&blob, "storage_key = ?", key).Error; err != nil {
		t.Fatal(err)
	}
	if blob.RefCount != 3 || blob.Size != int64(len(payload)) || blob.State != meta.ContentBlobStateReady {
		t.Fatalf("blob=%+v", blob)
	}

	aliceQuota := requestQuotaUsage(t, router, aliceToken)
	if aliceQuota.LogicalFileBytes != 2*int64(len(payload)) || aliceQuota.PhysicalUsedBytes != int64(len(payload)) {
		t.Fatalf("alice quota=%+v", aliceQuota)
	}
	bobQuota := requestQuotaUsage(t, router, bobToken)
	if bobQuota.LogicalFileBytes != int64(len(payload)) || bobQuota.PhysicalUsedBytes != int64(len(payload)) {
		t.Fatalf("bob quota=%+v", bobQuota)
	}

	permanentlyDeleteTestNode(t, router, aliceToken, aliceOne)
	if err := db.First(&blob, "storage_key = ?", key).Error; err != nil {
		t.Fatal(err)
	}
	if blob.RefCount != 2 {
		t.Fatalf("refcount after first delete=%d want=2", blob.RefCount)
	}
	if f, err := store.Open(context.Background(), key); err != nil {
		t.Fatalf("shared blob deleted too early: %v", err)
	} else {
		_ = f.Close()
	}

	permanentlyDeleteTestNode(t, router, aliceToken, aliceTwo)
	if err := db.First(&blob, "storage_key = ?", key).Error; err != nil {
		t.Fatal(err)
	}
	if blob.RefCount != 1 {
		t.Fatalf("refcount after second delete=%d want=1", blob.RefCount)
	}

	permanentlyDeleteTestNode(t, router, bobToken, bobOne)
	if err := db.First(&meta.ContentBlob{}, "storage_key = ?", key).Error; !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("content blob row survived final delete: %v", err)
	}
	if f, err := store.Open(context.Background(), key); err == nil {
		_ = f.Close()
		t.Fatal("physical blob survived final reference deletion")
	}

	// Simulate a process crash after metadata reached deleting/refcount=0 but
	// before the physical object and ContentBlob row were removed. The janitor
	// must finish the deletion on the next pass.
	const pending = "pending-cas-gc"
	pendingHash := sha256Hex([]byte(pending))
	pendingKey, err := storage.ContentAddressedKey(pendingHash)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Put(context.Background(), pendingKey, strings.NewReader(pending)); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.ContentBlob{
		SHA256: pendingHash, StorageKey: pendingKey, Size: int64(len(pending)),
		RefCount: 0, State: meta.ContentBlobStateDeleting,
	}).Error; err != nil {
		t.Fatal(err)
	}

	// Server-reused upload ranges are temporary references to the old blob and
	// must keep it alive even after durable file/version refs reach zero.
	session := meta.UploadSession{
		ID: "dedup-reuse-keepalive", OwnerID: aliceUser.ID, NodeID: &aliceOne.ID,
		ExpectedRevision: aliceOne.Revision, TotalSize: int64(len(pending)), ChunkSize: int64(len(pending)),
		ChunkCount: 1, Status: meta.UploadStatusActive, ExpiresAt: time.Now().Add(time.Hour),
	}
	if err := db.Create(&session).Error; err != nil {
		t.Fatal(err)
	}
	part := meta.UploadPart{
		SessionID: session.ID, PartIndex: 0, Size: int64(len(pending)), SHA256: pendingHash,
		StorageKey: ".xdrive-reuse/test/000000", Reused: true,
		SourceStorageKey: pendingKey,
	}
	if err := db.Create(&part).Error; err != nil {
		t.Fatal(err)
	}
	if err := server.reapDeletingContentBlobs(context.Background()); err != nil {
		t.Fatal(err)
	}
	var kept meta.ContentBlob
	if err := db.First(&kept, "sha256 = ?", pendingHash).Error; err != nil {
		t.Fatalf("reused upload part did not keep CAS metadata alive: %v", err)
	}
	if f, err := store.Open(context.Background(), pendingKey); err != nil {
		t.Fatalf("reused upload part did not keep CAS object alive: %v", err)
	} else {
		_ = f.Close()
	}

	if err := db.Where("session_id = ?", session.ID).Delete(&meta.UploadPart{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&meta.UploadSession{}, "id = ?", session.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := server.reapDeletingContentBlobs(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&meta.ContentBlob{}, "sha256 = ?", pendingHash).Error; !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("pending content blob row survived janitor: %v", err)
	}
	if f, err := store.Open(context.Background(), pendingKey); err == nil {
		_ = f.Close()
		t.Fatal("pending CAS object survived janitor")
	}
}

func requestQuotaUsage(t *testing.T, router http.Handler, token string) quotaUsageDTO {
	t.Helper()
	res := request(t, router, http.MethodGet, "/api/v1/me/quota", token, nil, http.StatusOK)
	var usage quotaUsageDTO
	if err := json.Unmarshal(res.Body.Bytes(), &usage); err != nil {
		t.Fatal(err)
	}
	return usage
}

func permanentlyDeleteTestNode(t *testing.T, router http.Handler, token string, node nodeDTO) {
	t.Helper()
	requestWithHeaders(
		t, router, http.MethodDelete, fmt.Sprintf("/api/v1/nodes/%d", node.ID), token, nil,
		http.StatusNoContent, map[string]string{"If-Match": fmt.Sprintf("\"%d\"", node.Revision)},
	)
	res := request(t, router, http.MethodGet, "/api/v1/trash", token, nil, http.StatusOK)
	var trash []nodeDTO
	if err := json.Unmarshal(res.Body.Bytes(), &trash); err != nil {
		t.Fatal(err)
	}
	for _, item := range trash {
		if item.ID != node.ID {
			continue
		}
		requestWithHeaders(
			t, router, http.MethodDelete, fmt.Sprintf("/api/v1/trash/%d", item.ID), token, nil,
			http.StatusNoContent, map[string]string{"If-Match": fmt.Sprintf("\"%d\"", item.Revision)},
		)
		return
	}
	t.Fatalf("node %d not found in trash", node.ID)
}
