package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
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

type finalizeExistingCASCountingStore struct {
	*capacityOverrideLocal
	mu      sync.Mutex
	putKeys []string
}

func (s *finalizeExistingCASCountingStore) Put(
	ctx context.Context,
	key string,
	reader io.Reader,
) (int64, error) {
	s.mu.Lock()
	s.putKeys = append(s.putKeys, key)
	s.mu.Unlock()
	return s.capacityOverrideLocal.Put(ctx, key, reader)
}

func (s *finalizeExistingCASCountingStore) resetPuts() {
	s.mu.Lock()
	s.putKeys = nil
	s.mu.Unlock()
}

func (s *finalizeExistingCASCountingStore) nonStagingPuts() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	prefix := storage.UploadStagingDir + "/"
	out := make([]string, 0, len(s.putKeys))
	for _, key := range s.putKeys {
		if !strings.HasPrefix(key, prefix) {
			out = append(out, key)
		}
	}
	return out
}

func TestUploadFinalizeExistingCASSkipsAssembledTempWrite(t *testing.T) {
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

	schema := "upload_existing_cas_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf("CREATE SCHEMA \"%s\"", schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = baseDB.Exec(fmt.Sprintf("DROP SCHEMA \"%s\" CASCADE", schema)).Error
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
	sqlDB.SetMaxOpenConns(2)
	sqlDB.SetMaxIdleConns(0)
	t.Cleanup(func() { _ = sqlDB.Close() })

	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{},
		&meta.FileVersion{}, &meta.ContentBlob{}, &meta.Share{},
		&meta.UploadSession{}, &meta.UploadPart{}, &meta.AuditEvent{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE UNIQUE INDEX idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE UNIQUE INDEX idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL").Error; err != nil {
		t.Fatal(err)
	}

	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	store := &finalizeExistingCASCountingStore{
		capacityOverrideLocal: &capacityOverrideLocal{
			Local: local, availableOverride: -1,
		},
	}
	router := (&Server{
		DB: db, Store: store,
		Auth:           auth.New("upload-existing-cas-performance-secret", time.Hour),
		RefreshTTL:     24 * time.Hour,
		AllowedOrigin:  "http://localhost",
		MaxUploadBytes: 32 << 20,
	}).Router()

	tokenA := createTestUser(t, db, router, "cas-owner-a", "password-a")
	tokenB := createTestUser(t, db, router, "cas-owner-b", "password-b")
	rootA := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", tokenA, nil, http.StatusOK)
	rootB := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", tokenB, nil, http.StatusOK)

	const chunkSize = int64(4 << 20)
	data := bytes.Repeat([]byte("existing-cas-finalize-"), 8192)
	hash := sha256Hex(data)

	start := func(token string, rootID uint64, name, resumeKey string) uploadSessionDTO {
		t.Helper()
		body := fmt.Sprintf(
			"{\"parent_id\":%d,\"name\":%q,\"size\":%d,\"chunk_size\":%d,\"sha256\":%q,\"resume_key\":%q}",
			rootID, name, len(data), chunkSize, hash, resumeKey,
		)
		res := request(
			t, router, http.MethodPost, "/api/v1/uploads", token,
			strings.NewReader(body), http.StatusCreated,
		)
		var session uploadSessionDTO
		if err := json.Unmarshal(res.Body.Bytes(), &session); err != nil {
			t.Fatal(err)
		}
		if session.Status != meta.UploadStatusActive {
			t.Fatalf("upload %s unexpectedly bypassed data transfer: %+v", name, session)
		}
		return session
	}
	putChunk := func(token, sessionID string, payload []byte) {
		t.Helper()
		requestWithHeaders(
			t, router, http.MethodPut,
			fmt.Sprintf("/api/v1/uploads/%s/chunks/0", sessionID),
			token, bytes.NewReader(payload), http.StatusCreated,
			map[string]string{
				"Content-Type":   "application/octet-stream",
				"X-Chunk-SHA256": sha256Hex(payload),
			},
		)
	}
	finalize := func(token, sessionID string, status int) []byte {
		t.Helper()
		res := request(
			t, router, http.MethodPost,
			"/api/v1/uploads/"+sessionID+"/finalize",
			token, strings.NewReader("{}"), status,
		)
		return append([]byte(nil), res.Body.Bytes()...)
	}

	ownerSession := start(tokenA, rootA.ID, "owner.bin", "owner-seed")
	putChunk(tokenA, ownerSession.ID, data)
	store.resetPuts()
	finalize(tokenA, ownerSession.ID, http.StatusOK)
	if puts := store.nonStagingPuts(); len(puts) != 1 {
		t.Fatalf("unique-content finalize assembled writes=%d keys=%v want=1", len(puts), puts)
	}

	casKey, err := storage.ContentAddressedKey(hash)
	if err != nil {
		t.Fatal(err)
	}
	info, err := local.Stat(context.Background(), casKey)
	if err != nil || info.Size != int64(len(data)) {
		t.Fatalf("seed CAS stat=%+v err=%v", info, err)
	}

	bad := append([]byte(nil), data...)
	bad[len(bad)/2] ^= 0x7f
	badSession := start(tokenB, rootB.ID, "bad.bin", "cross-user-bad")
	putChunk(tokenB, badSession.ID, bad)
	store.resetPuts()
	finalize(tokenB, badSession.ID, http.StatusUnprocessableEntity)
	if puts := store.nonStagingPuts(); len(puts) != 0 {
		t.Fatalf("hash-mismatch finalize wrote assembled objects: %v", puts)
	}
	request(t, router, http.MethodDelete, "/api/v1/uploads/"+badSession.ID, tokenB, nil, http.StatusNoContent)

	goodSession := start(tokenB, rootB.ID, "good.bin", "cross-user-good")
	putChunk(tokenB, goodSession.ID, data)
	store.resetPuts()
	finalBody := finalize(tokenB, goodSession.ID, http.StatusOK)
	if puts := store.nonStagingPuts(); len(puts) != 0 {
		t.Fatalf("existing-CAS finalize wrote assembled objects: %v", puts)
	}

	var finalized uploadSessionDTO
	if err := json.Unmarshal(finalBody, &finalized); err != nil {
		t.Fatal(err)
	}
	if finalized.Result == nil {
		t.Fatalf("missing finalized result: %+v", finalized)
	}
	var file meta.File
	if err := db.First(&file, "node_id = ?", finalized.Result.ID).Error; err != nil {
		t.Fatal(err)
	}
	if file.StorageKey != casKey || file.SHA256 != hash {
		t.Fatalf("finalized file=%+v want key=%q hash=%q", file, casKey, hash)
	}
	var blob meta.ContentBlob
	if err := db.First(&blob, "sha256 = ?", hash).Error; err != nil {
		t.Fatal(err)
	}
	if blob.RefCount != 2 {
		t.Fatalf("CAS ref_count=%d want=2", blob.RefCount)
	}
}
