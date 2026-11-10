package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

// Exercise the REAL iOS managed HTTP endpoints against PostgreSQL and physical
// local CAS bytes. Policy-only tests cannot prove upload -> finalize -> receipt.
// This is not a signed iPhone/PhotoKit or production NAS acceptance test.
func TestIOSPhotoManagedOriginalHTTPResumeFinalizeCASReadback(t *testing.T) {
	db, server, owner, foreign, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(
		&meta.ClientDevice{}, &meta.UploadSession{}, &meta.UploadPart{},
		&meta.ContentBlob{}, &meta.FileVersion{},
	); err != nil {
		t.Fatal(err)
	}
	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server.Store = local
	server.MaxUploadBytes = 32 << 20
	server.Auth = auth.New("ios-managed-original-real-http-cas", time.Hour)
	gin.SetMode(gin.TestMode)
	router := server.Router()
	ownerToken, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	foreignToken, err := server.Auth.Issue(foreign.ID, foreign.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}

	secret := "ios-original-http-device-secret-20261110"
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "iPhone Test",
		Platform: "ios", CredentialHash: deviceCredentialDigest(secret),
		CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	headers := map[string]string{
		"X-XDrive-Device-ID":    device.ID,
		"X-XDrive-Device-Token": secret,
	}
	encode := func(value any) *bytes.Reader {
		t.Helper()
		raw, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		return bytes.NewReader(raw)
	}
	destination := requestWithHeaders(t, router, http.MethodPut,
		"/api/v1/ios/photos/backup-destination", ownerToken,
		encode(map[string]any{"name": "iPhone 原件"}),
		http.StatusCreated, headers)
	var target struct {
		SourceID     uint64 `json:"source_id"`
		TargetNodeID uint64 `json:"target_node_id"`
	}
	if err := json.Unmarshal(destination.Body.Bytes(), &target); err != nil {
		t.Fatal(err)
	}
	if target.SourceID == 0 || target.TargetNodeID == 0 ||
		target.TargetNodeID == root.ID {
		t.Fatalf("untrusted managed target: %+v", target)
	}

	// Cross an 8 MiB chunk boundary to exercise two real UploadParts.
	// The deterministic payload is NOT a real HEIC; media decode belongs
	// to the signed-device portion of issue #4249.
	content := make([]byte, int(defaultUploadChunkSize)+193)
	for i := range content {
		content[i] = byte((i*37 + 11) % 251)
	}
	digest := func(data []byte) string {
		sum := sha256.Sum256(data)
		return hex.EncodeToString(sum[:])
	}
	fullHash := digest(content)
	name := "IMG-xios-0123456789abcdef01234567-0123456789ab.heic"
	resumeKey := "ios_" + strings.Repeat("c", 64)
	identity := map[string]any{
		"parent_id":  target.TargetNodeID,
		"name":       name,
		"size":       len(content),
		"chunk_size": defaultUploadChunkSize,
		"sha256":     fullHash,
		"resume_key": resumeKey,
	}
	createBody := map[string]any{
		"parent_id":       target.TargetNodeID,
		"name":            name,
		"size":            len(content),
		"chunk_size":      defaultUploadChunkSize,
		"sha256":          fullHash,
		"resume_key":      resumeKey,
		"conflict_policy": meta.UploadConflictPolicyFail,
	}
	path := "/api/v1/ios/photos/managed/uploads"
	// An Owner bearer without the independently enrolled phone cannot
	// perform writes, even if it knows the managed target and resume key.
	requestWithHeaders(t, router, http.MethodPost, path, ownerToken,
		encode(createBody), http.StatusForbidden, nil)
	requestWithHeaders(t, router, http.MethodPost, path, foreignToken,
		encode(createBody), http.StatusForbidden, headers)
	started := requestWithHeaders(t, router, http.MethodPost, path, ownerToken,
		encode(createBody), http.StatusCreated, headers)
	var session uploadSessionDTO
	if err := json.Unmarshal(started.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	if uuid.Validate(session.ID) != nil || session.Result != nil ||
		session.Status != meta.UploadStatusActive || session.ChunkCount != 2 ||
		len(session.Received) != 0 {
		t.Fatalf("untrusted original create response: %+v", session)
	}

	// A lost create/chunk response must be reconciled read-only. Neither
	// repeated lookup nor the first chunk can create an extra Server Node.
	lookupPath := path + "/resume-lookup"
	readLookup := func(status int) uploadSessionDTO {
		t.Helper()
		resp := requestWithHeaders(t, router, http.MethodPost, lookupPath,
			ownerToken, encode(identity), status, headers)
		var got uploadSessionDTO
		if status == http.StatusOK {
			if err := json.Unmarshal(resp.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
		}
		return got
	}
	if got := readLookup(http.StatusOK); got.ID != session.ID ||
		got.Result != nil || len(got.Received) != 0 {
		t.Fatalf("lost-create ACK lookup is not exact/read-only: %+v", got)
	}
	first := content[:int(defaultUploadChunkSize)]
	second := content[int(defaultUploadChunkSize):]
	chunk := func(index int, data []byte, expected int) {
		t.Helper()
		h := map[string]string{
			"X-XDrive-Device-ID":    device.ID,
			"X-XDrive-Device-Token": secret,
			"Content-Type":          "application/octet-stream",
			"X-Chunk-SHA256":        digest(data),
		}
		requestWithHeaders(t, router, http.MethodPut,
			fmt.Sprintf("%s/%s/chunks/%d", path, session.ID, index),
			ownerToken, bytes.NewReader(data), expected, h)
	}
	chunk(0, first, http.StatusCreated)
	chunk(0, first, http.StatusOK)
	if got := readLookup(http.StatusOK); got.ID != session.ID ||
		len(got.Received) != 1 || got.Received[0].Index != 0 ||
		got.Result != nil {
		t.Fatalf("chunk recovery was not idempotent: %+v", got)
	}
	chunk(1, second, http.StatusCreated)
	requestWithHeaders(t, router, http.MethodPost,
		path+"/"+session.ID+"/finalize", ownerToken,
		encode(map[string]any{}), http.StatusOK, headers)

	// Simulate an ACK lost AFTER Server commit: do not trust the unseen
	// finalize body. Reconcile and verify the exact finalized Node instead.
	finalized := readLookup(http.StatusOK)
	if finalized.ID != session.ID || finalized.Status != meta.UploadStatusFinalized ||
		finalized.Result == nil || finalized.Result.ParentID == nil ||
		*finalized.Result.ParentID != target.TargetNodeID ||
		finalized.Result.SHA256 != fullHash || finalized.Result.Size != int64(len(content)) {
		t.Fatalf("lost-finalize ACK did not recover an exact Node: %+v", finalized)
	}
	nodeID := finalized.Result.ID
	receiptPath := fmt.Sprintf("/api/v1/ios/photos/managed/receipts/nodes/%d", nodeID)
	receipt := requestWithHeaders(t, router, http.MethodGet,
		receiptPath, ownerToken, nil, http.StatusOK, headers)
	var current struct {
		ID       uint64 `json:"id"`
		ParentID uint64 `json:"parent_id"`
		Name     string `json:"name"`
		Size     int64  `json:"size"`
		SHA256   string `json:"sha256"`
		Revision uint64 `json:"revision"`
	}
	if err := json.Unmarshal(receipt.Body.Bytes(), &current); err != nil {
		t.Fatal(err)
	}
	if current.ID != nodeID || current.ParentID != target.TargetNodeID ||
		current.Name != name || current.Size != int64(len(content)) ||
		current.SHA256 != fullHash || current.Revision != finalized.Result.Revision {
		t.Fatalf("current managed receipt disagrees with finalized original: %+v", current)
	}
	var actualFile meta.File
	if err := db.Where("node_id = ?", nodeID).Take(&actualFile).Error; err != nil {
		t.Fatal(err)
	}
	cas, err := local.Open(context.Background(), actualFile.StorageKey)
	if err != nil {
		t.Fatal(err)
	}
	storedBytes, readErr := io.ReadAll(cas)
	closeErr := cas.Close()
	if readErr != nil || closeErr != nil || !bytes.Equal(storedBytes, content) ||
		digest(storedBytes) != fullHash || actualFile.SHA256 != fullHash {
		t.Fatalf("physical CAS original failed exact-byte SHA-256 readback: read=%v close=%v", readErr, closeErr)
	}
	var sessions, nodes int64
	if err := db.Model(&meta.UploadSession{}).
		Where("source_id = ? AND source_device_id = ?", target.SourceID, device.ID).
		Count(&sessions).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.Node{}).
		Where("id = ? AND owner_id = ? AND parent_id = ?", nodeID, owner.ID, target.TargetNodeID).
		Count(&nodes).Error; err != nil {
		t.Fatal(err)
	}
	if sessions != 1 || nodes != 1 {
		t.Fatalf("lost ACK created duplicate sessions/nodes: sessions=%d nodes=%d", sessions, nodes)
	}

	// Revocation protects readback/recovery, even for data successfully
	// uploaded earlier. It must NOT erase or corrupt physical CAS bytes.
	if err := db.Model(&meta.ClientDevice{}).Where("id = ?", device.ID).
		Update("revoked_at", time.Now().UTC()).Error; err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodGet,
		receiptPath, ownerToken, nil, http.StatusForbidden, headers)
	requestWithHeaders(t, router, http.MethodPost,
		lookupPath, ownerToken, encode(identity), http.StatusForbidden, headers)
}
