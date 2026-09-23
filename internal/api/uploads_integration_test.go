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

func TestChunkedUploadResumeHashHistoryAndConflict(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)

	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "upload_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{},
		&meta.UploadSession{}, &meta.UploadPart{},
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
		Auth:           auth.New("chunk-upload-integration-secret", time.Hour),
		RefreshTTL:     24 * time.Hour,
		AllowedOrigin:  "http://localhost",
		MaxUploadBytes: 32 << 20,
	}).Router()

	token := createTestUser(t, db, router, "chunk-user", "chunk-password")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)

	const chunkSize = int64(4 << 20)
	data := make([]byte, 2*chunkSize+123)
	for i := range data {
		data[i] = byte((i*31 + 7) % 251)
	}
	fullHash := sha256Hex(data)
	initBody := fmt.Sprintf(
		`{"parent_id":%d,"name":"large.bin","size":%d,"chunk_size":%d,"sha256":%q,"resume_key":%q}`,
		root.ID, len(data), chunkSize, fullHash, fullHash,
	)
	initRes := request(t, router, http.MethodPost, "/api/v1/uploads", token, strings.NewReader(initBody), http.StatusCreated)
	var session uploadSessionDTO
	if err := json.Unmarshal(initRes.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	if session.ID == "" || session.ChunkCount != 3 || session.ChunkSize != chunkSize {
		t.Fatalf("unexpected upload session: %+v", session)
	}

	putPart := func(sessionID string, index int, content []byte, hash string, status int) {
		t.Helper()
		requestWithHeaders(
			t, router, http.MethodPut, fmt.Sprintf("/api/v1/uploads/%s/chunks/%d", sessionID, index),
			token, bytes.NewReader(content), status,
			map[string]string{
				"Content-Type":   "application/octet-stream",
				"X-Chunk-SHA256": hash,
			},
		)
	}
	part0 := data[:chunkSize]
	part1 := data[chunkSize : 2*chunkSize]
	part2 := data[2*chunkSize:]
	hash0, hash1, hash2 := sha256Hex(part0), sha256Hex(part1), sha256Hex(part2)

	putPart(session.ID, 0, part0, hash0, http.StatusCreated)
	// Same chunk/hash is idempotent and returns the already recorded part.
	putPart(session.ID, 0, part0, hash0, http.StatusOK)
	putPart(session.ID, 2, part2, hash2, http.StatusCreated)

	resumeRes := request(t, router, http.MethodPost, "/api/v1/uploads", token, strings.NewReader(initBody), http.StatusOK)
	var resumed uploadSessionDTO
	if err := json.Unmarshal(resumeRes.Body.Bytes(), &resumed); err != nil {
		t.Fatal(err)
	}
	if resumed.ID != session.ID || len(resumed.Received) != 2 {
		t.Fatalf("resume lost server state: %+v", resumed)
	}

	putPart(session.ID, 1, part1, strings.Repeat("0", 64), http.StatusUnprocessableEntity)
	putPart(session.ID, 1, part1, hash1, http.StatusCreated)

	finalRes := request(t, router, http.MethodPost, "/api/v1/uploads/"+session.ID+"/finalize", token, strings.NewReader(`{}`), http.StatusOK)
	var finalized uploadSessionDTO
	if err := json.Unmarshal(finalRes.Body.Bytes(), &finalized); err != nil {
		t.Fatal(err)
	}
	if finalized.Status != meta.UploadStatusFinalized || finalized.Result == nil {
		t.Fatalf("finalize result: %+v", finalized)
	}
	if finalized.Result.Size != int64(len(data)) || finalized.Result.SHA256 != fullHash || finalized.Result.Revision != 1 {
		t.Fatalf("finalized node=%+v", finalized.Result)
	}
	node := *finalized.Result

	download := request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/content", node.ID), token, nil, http.StatusOK)
	if !bytes.Equal(download.Body.Bytes(), data) {
		t.Fatal("assembled content differs from source")
	}
	if got := download.Header().Get("X-Content-SHA256"); got != fullHash {
		t.Fatalf("X-Content-SHA256=%q want=%q", got, fullHash)
	}

	// A lost finalize response can be recovered without creating another node.
	finalAgain := request(t, router, http.MethodPost, "/api/v1/uploads/"+session.ID+"/finalize", token, strings.NewReader(`{}`), http.StatusOK)
	var idempotent uploadSessionDTO
	if err := json.Unmarshal(finalAgain.Body.Bytes(), &idempotent); err != nil {
		t.Fatal(err)
	}
	if idempotent.Result == nil || idempotent.Result.ID != node.ID {
		t.Fatalf("idempotent finalize=%+v", idempotent)
	}

	// Same-file overwrite can reuse unchanged fixed blocks from the current
	// revision. Only the changed middle chunk is uploaded over the network.
	deltaData := append([]byte(nil), data...)
	deltaData[chunkSize+17] ^= 0x7f
	deltaHash := sha256Hex(deltaData)
	deltaChunkHashes := []string{
		sha256Hex(deltaData[:chunkSize]),
		sha256Hex(deltaData[chunkSize : 2*chunkSize]),
		sha256Hex(deltaData[2*chunkSize:]),
	}
	deltaInitJSON, err := json.Marshal(map[string]any{
		"node_id":           node.ID,
		"size":              len(deltaData),
		"chunk_size":        chunkSize,
		"sha256":            deltaHash,
		"chunk_sha256":      deltaChunkHashes,
		"resume_key":        deltaHash,
		"expected_revision": node.Revision,
	})
	if err != nil {
		t.Fatal(err)
	}
	deltaInit := request(t, router, http.MethodPost, "/api/v1/uploads", token, bytes.NewReader(deltaInitJSON), http.StatusCreated)
	var deltaSession uploadSessionDTO
	if err := json.Unmarshal(deltaInit.Body.Bytes(), &deltaSession); err != nil {
		t.Fatal(err)
	}
	if len(deltaSession.Received) != 2 {
		t.Fatalf("expected 2 server-reused chunks, got %+v", deltaSession.Received)
	}
	reused := map[int]uploadPartDTO{}
	for _, part := range deltaSession.Received {
		reused[part.Index] = part
		if !part.Reused {
			t.Fatalf("chunk %d was prefilled but not marked reused: %+v", part.Index, part)
		}
	}
	if reused[0].SHA256 != deltaChunkHashes[0] || reused[2].SHA256 != deltaChunkHashes[2] {
		t.Fatalf("unexpected reused chunks: %+v", deltaSession.Received)
	}
	if _, ok := reused[1]; ok {
		t.Fatalf("changed middle chunk was incorrectly reused: %+v", deltaSession.Received)
	}

	putPart(deltaSession.ID, 1, deltaData[chunkSize:2*chunkSize], deltaChunkHashes[1], http.StatusCreated)
	deltaFinal := request(t, router, http.MethodPost, "/api/v1/uploads/"+deltaSession.ID+"/finalize", token, strings.NewReader(`{}`), http.StatusOK)
	var deltaDone uploadSessionDTO
	if err := json.Unmarshal(deltaFinal.Body.Bytes(), &deltaDone); err != nil {
		t.Fatal(err)
	}
	if deltaDone.Result == nil || deltaDone.Result.Revision != 2 || deltaDone.Result.SHA256 != deltaHash {
		t.Fatalf("delta overwrite=%+v", deltaDone.Result)
	}
	deltaDownload := request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/content", node.ID), token, nil, http.StatusOK)
	if !bytes.Equal(deltaDownload.Body.Bytes(), deltaData) {
		t.Fatal("delta overwrite content differs from source")
	}

	var reusedRows int64
	if err := db.Model(&meta.UploadPart{}).Where("session_id = ?", deltaSession.ID).Count(&reusedRows).Error; err != nil {
		t.Fatal(err)
	}
	if reusedRows != 0 {
		t.Fatalf("finalized upload parts were not cleaned: %d", reusedRows)
	}

	// A subsequent chunked overwrite publishes another revision and preserves
	// the delta revision in version history.
	overwriteData := []byte("chunked-overwrite-version-two")
	overwriteHash := sha256Hex(overwriteData)
	overwriteBody := fmt.Sprintf(
		`{"node_id":%d,"size":%d,"chunk_size":%d,"sha256":%q,"resume_key":%q,"expected_revision":%d}`,
		node.ID, len(overwriteData), chunkSize, overwriteHash, overwriteHash, 2,
	)
	overwriteInit := request(t, router, http.MethodPost, "/api/v1/uploads", token, strings.NewReader(overwriteBody), http.StatusCreated)
	var overwriteSession uploadSessionDTO
	if err := json.Unmarshal(overwriteInit.Body.Bytes(), &overwriteSession); err != nil {
		t.Fatal(err)
	}
	putPart(overwriteSession.ID, 0, overwriteData, overwriteHash, http.StatusCreated)
	overwriteFinal := request(t, router, http.MethodPost, "/api/v1/uploads/"+overwriteSession.ID+"/finalize", token, strings.NewReader(`{}`), http.StatusOK)
	var overwritten uploadSessionDTO
	if err := json.Unmarshal(overwriteFinal.Body.Bytes(), &overwritten); err != nil {
		t.Fatal(err)
	}
	if overwritten.Result == nil || overwritten.Result.Revision != 3 || overwritten.Result.SHA256 != overwriteHash {
		t.Fatalf("chunk overwrite=%+v", overwritten.Result)
	}

	var history []meta.FileVersion
	if err := db.Where("node_id = ?", node.ID).Order("revision ASC").Find(&history).Error; err != nil {
		t.Fatal(err)
	}
	if len(history) != 2 ||
		history[0].Revision != 1 || history[0].SHA256 != fullHash || history[0].Size != int64(len(data)) ||
		history[1].Revision != 2 || history[1].SHA256 != deltaHash || history[1].Size != int64(len(deltaData)) {
		t.Fatalf("history after chunk overwrite=%+v", history)
	}
	oldBlob, err := store.Open(context.Background(), history[0].StorageKey)
	if err != nil {
		t.Fatalf("historical blob missing: %v", err)
	}
	oldBytes := make([]byte, len(data))
	n, readErr := oldBlob.Read(oldBytes)
	_ = oldBlob.Close()
	if readErr != nil || n != len(data) || !bytes.Equal(oldBytes, data) {
		t.Fatalf("historical blob corrupted n=%d err=%v", n, readErr)
	}

	// A stale finalize must not replace a newer revision.
	staleData := []byte("stale-chunk-writer")
	staleHash := sha256Hex(staleData)
	staleBody := fmt.Sprintf(
		`{"node_id":%d,"size":%d,"chunk_size":%d,"sha256":%q,"resume_key":"stale-%s","expected_revision":3}`,
		node.ID, len(staleData), chunkSize, staleHash, staleHash,
	)
	staleInit := request(t, router, http.MethodPost, "/api/v1/uploads", token, strings.NewReader(staleBody), http.StatusCreated)
	var staleSession uploadSessionDTO
	if err := json.Unmarshal(staleInit.Body.Bytes(), &staleSession); err != nil {
		t.Fatal(err)
	}
	putPart(staleSession.ID, 0, staleData, staleHash, http.StatusCreated)

	winner := requestNodeWithHeaders(
		t, router, http.MethodPut, fmt.Sprintf("/api/v1/files/%d/content", node.ID),
		token, strings.NewReader("server-winner"), http.StatusOK,
		map[string]string{"If-Match": `"3"`},
	)
	if winner.Revision != 4 {
		t.Fatalf("winner revision=%d", winner.Revision)
	}
	request(t, router, http.MethodPost, "/api/v1/uploads/"+staleSession.ID+"/finalize", token, strings.NewReader(`{}`), http.StatusConflict)
	current := request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/content", node.ID), token, nil, http.StatusOK)
	if current.Body.String() != "server-winner" {
		t.Fatalf("stale finalize overwrote current file: %q", current.Body.String())
	}

	// Abort removes upload rows and temporary part blobs.
	abortData := []byte("abort-me")
	abortHash := sha256Hex(abortData)
	abortBody := fmt.Sprintf(
		`{"parent_id":%d,"name":"abort.bin","size":%d,"chunk_size":%d,"sha256":%q,"resume_key":"abort-%s"}`,
		root.ID, len(abortData), chunkSize, abortHash, abortHash,
	)
	abortInit := request(t, router, http.MethodPost, "/api/v1/uploads", token, strings.NewReader(abortBody), http.StatusCreated)
	var abortSession uploadSessionDTO
	if err := json.Unmarshal(abortInit.Body.Bytes(), &abortSession); err != nil {
		t.Fatal(err)
	}
	putPart(abortSession.ID, 0, abortData, abortHash, http.StatusCreated)
	var abortPart meta.UploadPart
	if err := db.Where("session_id = ?", abortSession.ID).First(&abortPart).Error; err != nil {
		t.Fatal(err)
	}
	request(t, router, http.MethodDelete, "/api/v1/uploads/"+abortSession.ID, token, nil, http.StatusNoContent)
	if err := db.First(&meta.UploadSession{}, "id = ?", abortSession.ID).Error; err == nil {
		t.Fatal("aborted upload session row survived")
	}
	if _, err := store.Open(context.Background(), abortPart.StorageKey); err == nil {
		t.Fatal("aborted upload part blob survived")
	}
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
