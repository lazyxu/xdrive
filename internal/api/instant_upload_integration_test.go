package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
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

type instantUploadTestEnv struct {
	db     *gorm.DB
	server *Server
	router http.Handler
}

func newInstantUploadTestEnv(t *testing.T) instantUploadTestEnv {
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
	schema := "instant_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		Auth:           auth.New("instant-upload-integration-secret", time.Hour),
		RefreshTTL:     24 * time.Hour,
		AllowedOrigin:  "http://localhost",
		MaxUploadBytes: 32 << 20,
	}
	return instantUploadTestEnv{db: db, server: server, router: server.Router()}
}

func TestInstantUploadIsOwnerScopedAndQuotaFree(t *testing.T) {
	env := newInstantUploadTestEnv(t)
	aliceToken := createTestUser(t, env.db, env.router, "instant-alice", "instant-password-a")
	bobToken := createTestUser(t, env.db, env.router, "instant-bob", "instant-password-b")
	aliceRoot := requestNode(t, env.router, http.MethodGet, "/api/v1/nodes/root", aliceToken, nil, http.StatusOK)
	bobRoot := requestNode(t, env.router, http.MethodGet, "/api/v1/nodes/root", bobToken, nil, http.StatusOK)

	const payload = "owner-scoped-instant-upload-content"
	seed := uploadTestFile(t, env.router, aliceToken, aliceRoot.ID, "seed.bin", payload)
	hash := instantSHA256(payload)

	var alice meta.User
	if err := env.db.Where("username = ?", "instant-alice").First(&alice).Error; err != nil {
		t.Fatal(err)
	}
	if err := env.db.Model(&alice).Update("quota_bytes", int64(len(payload))).Error; err != nil {
		t.Fatal(err)
	}

	initBody := func(parentID uint64, name, resumeKey string) *bytes.Reader {
		body, err := json.Marshal(uploadInitRequest{
			ParentID:  &parentID,
			Name:      name,
			Size:      int64(len(payload)),
			ChunkSize: defaultUploadChunkSize,
			SHA256:    hash,
			ResumeKey: resumeKey,
		})
		if err != nil {
			t.Fatal(err)
		}
		return bytes.NewReader(body)
	}

	res := request(
		t, env.router, http.MethodPost, "/api/v1/uploads", aliceToken,
		initBody(aliceRoot.ID, "instant-copy.bin", "instant-owner-copy"),
		http.StatusCreated,
	)
	if got := res.Header().Get("X-XDrive-Instant-Upload"); got != "1" {
		t.Fatalf("instant header=%q", got)
	}
	var instant uploadSessionDTO
	if err := json.Unmarshal(res.Body.Bytes(), &instant); err != nil {
		t.Fatal(err)
	}
	if instant.Status != meta.UploadStatusFinalized || instant.Result == nil || instant.Result.Name != "instant-copy.bin" {
		t.Fatalf("instant session=%+v", instant)
	}
	var parts int64
	if err := env.db.Model(&meta.UploadPart{}).Where("session_id = ?", instant.ID).Count(&parts).Error; err != nil {
		t.Fatal(err)
	}
	if parts != 0 {
		t.Fatalf("instant upload created %d chunk rows", parts)
	}

	var seedFile, copiedFile meta.File
	if err := env.db.Where("node_id = ?", seed.ID).First(&seedFile).Error; err != nil {
		t.Fatal(err)
	}
	if err := env.db.Where("node_id = ?", instant.Result.ID).First(&copiedFile).Error; err != nil {
		t.Fatal(err)
	}
	if copiedFile.StorageKey != seedFile.StorageKey {
		t.Fatalf("instant copy storage key=%q want=%q", copiedFile.StorageKey, seedFile.StorageKey)
	}
	var blob meta.ContentBlob
	if err := env.db.First(&blob, "storage_key = ?", seedFile.StorageKey).Error; err != nil {
		t.Fatal(err)
	}
	if blob.RefCount != 2 {
		t.Fatalf("refcount=%d want=2", blob.RefCount)
	}
	aliceQuota := requestQuotaUsage(t, env.router, aliceToken)
	if aliceQuota.PhysicalUsedBytes != int64(len(payload)) ||
		aliceQuota.LogicalFileBytes != 2*int64(len(payload)) {
		t.Fatalf("alice quota=%+v", aliceQuota)
	}

	// Knowing a global SHA is not proof of possession. Bob must receive a
	// normal active upload session because he has no durable reference to this
	// CAS object.
	bobRes := request(
		t, env.router, http.MethodPost, "/api/v1/uploads", bobToken,
		initBody(bobRoot.ID, "known-hash.bin", "instant-cross-user"),
		http.StatusCreated,
	)
	if got := bobRes.Header().Get("X-XDrive-Instant-Upload"); got != "" {
		t.Fatalf("cross-user request leaked instant hit via header=%q", got)
	}
	var bobSession uploadSessionDTO
	if err := json.Unmarshal(bobRes.Body.Bytes(), &bobSession); err != nil {
		t.Fatal(err)
	}
	if bobSession.Status != meta.UploadStatusActive || bobSession.Result != nil {
		t.Fatalf("cross-user upload unexpectedly finalized: %+v", bobSession)
	}
	if err := env.db.First(&blob, "storage_key = ?", seedFile.StorageKey).Error; err != nil {
		t.Fatal(err)
	}
	if blob.RefCount != 2 {
		t.Fatalf("cross-user hash probe changed refcount=%d", blob.RefCount)
	}

	metrics := request(t, env.router, http.MethodGet, "/metrics", "", nil, http.StatusOK)
	if !strings.Contains(metrics.Body.String(), `xdrive_upload_operations_total{operation="instant",result="success"} 1`) {
		t.Fatalf("instant metric missing:\n%s", metrics.Body.String())
	}
}

func TestInstantUploadOverwritePreservesHistory(t *testing.T) {
	env := newInstantUploadTestEnv(t)
	token := createTestUser(t, env.db, env.router, "instant-overwrite", "instant-password")
	root := requestNode(t, env.router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)

	const desired = "instant-overwrite-desired"
	const old = "instant-overwrite-old"
	source := uploadTestFile(t, env.router, token, root.ID, "source.bin", desired)
	target := uploadTestFile(t, env.router, token, root.ID, "target.bin", old)

	var sourceFile, oldTargetFile meta.File
	if err := env.db.Where("node_id = ?", source.ID).First(&sourceFile).Error; err != nil {
		t.Fatal(err)
	}
	if err := env.db.Where("node_id = ?", target.ID).First(&oldTargetFile).Error; err != nil {
		t.Fatal(err)
	}

	body, err := json.Marshal(uploadInitRequest{
		NodeID:           &target.ID,
		Size:             int64(len(desired)),
		ChunkSize:        defaultUploadChunkSize,
		SHA256:           instantSHA256(desired),
		ResumeKey:        "instant-overwrite-resume",
		ExpectedRevision: target.Revision,
	})
	if err != nil {
		t.Fatal(err)
	}
	res := request(
		t, env.router, http.MethodPost, "/api/v1/uploads", token,
		bytes.NewReader(body), http.StatusCreated,
	)
	if res.Header().Get("X-XDrive-Instant-Upload") != "1" {
		t.Fatalf("overwrite did not use instant upload")
	}
	var session uploadSessionDTO
	if err := json.Unmarshal(res.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	if session.Result == nil || session.Result.Revision != target.Revision+1 {
		t.Fatalf("overwrite session=%+v", session)
	}

	var updated meta.File
	if err := env.db.Where("node_id = ?", target.ID).First(&updated).Error; err != nil {
		t.Fatal(err)
	}
	if updated.StorageKey != sourceFile.StorageKey || updated.SHA256 != sourceFile.SHA256 {
		t.Fatalf("updated target=%+v source=%+v", updated, sourceFile)
	}
	var versions []meta.FileVersion
	if err := env.db.Where("node_id = ?", target.ID).Order("revision").Find(&versions).Error; err != nil {
		t.Fatal(err)
	}
	if len(versions) != 1 || versions[0].StorageKey != oldTargetFile.StorageKey || versions[0].Revision != target.Revision {
		t.Fatalf("versions=%+v", versions)
	}

	download := request(
		t, env.router, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/content", target.ID),
		token, nil, http.StatusOK,
	)
	if download.Body.String() != desired {
		t.Fatalf("download=%q want=%q", download.Body.String(), desired)
	}
}

func instantSHA256(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func TestInstantUploadBlobHealthFailureFallsBackToChunks(t *testing.T) {
	env := newInstantUploadTestEnv(t)
	token := createTestUser(t, env.db, env.router, "instant-repair", "instant-password")
	root := requestNode(t, env.router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)

	const payload = "instant-health-fallback"
	seed := uploadTestFile(t, env.router, token, root.ID, "seed.bin", payload)
	var file meta.File
	if err := env.db.Where("node_id = ?", seed.ID).First(&file).Error; err != nil {
		t.Fatal(err)
	}
	if err := env.server.Store.Delete(context.Background(), file.StorageKey); err != nil {
		t.Fatal(err)
	}

	body, err := json.Marshal(uploadInitRequest{
		ParentID:  &root.ID,
		Name:      "repair-copy.bin",
		Size:      int64(len(payload)),
		ChunkSize: defaultUploadChunkSize,
		SHA256:    instantSHA256(payload),
		ResumeKey: "instant-repair-fallback",
	})
	if err != nil {
		t.Fatal(err)
	}
	res := request(
		t, env.router, http.MethodPost, "/api/v1/uploads", token,
		bytes.NewReader(body), http.StatusCreated,
	)
	if res.Header().Get("X-XDrive-Instant-Upload") != "" {
		t.Fatal("unhealthy CAS object must not instant-finalize")
	}
	var session uploadSessionDTO
	if err := json.Unmarshal(res.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	if session.Status != meta.UploadStatusActive {
		t.Fatalf("fallback session=%+v", session)
	}
}
