package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photooriginalretention"
	"github.com/lazyxu/xdrive/internal/storage"
)

func TestIOSPhotoOriginalHoldPositiveHTTPPhysicalCASAndImmutability(t *testing.T) {
	db, server, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.UploadSession{}, &meta.UploadPart{},
		&meta.ContentBlob{}, &meta.FileVersion{},
		&meta.IOSPhotoOriginalHold{}, &meta.IOSPhotoOriginalHoldAncestor{}); err != nil {
		t.Fatal(err)
	}
	if err := photooriginalretention.InstallSchema(db); err != nil {
		t.Fatal(err)
	}
	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server.Store = local
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("ios-original-hold-end-to-end", time.Hour)
	ownerJWT, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	devSecret := "ios-original-retention-device-secret-012345"
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "iPhone",
		Platform: "ios", CredentialHash: deviceCredentialDigest(devSecret),
		CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	headers := map[string]string{
		"X-XDrive-Device-ID": device.ID, "X-XDrive-Device-Token": devSecret,
	}
	router := server.Router()
	dest := requestWithHeaders(t, router, http.MethodPut,
		"/api/v1/ios/photos/backup-destination", ownerJWT,
		strings.NewReader(`{"name":"iPhone"}`), http.StatusCreated, headers)
	var managed struct {
		SourceID     uint64 `json:"source_id"`
		TargetNodeID uint64 `json:"target_node_id"`
	}
	if err := json.Unmarshal(dest.Body.Bytes(), &managed); err != nil {
		t.Fatal(err)
	}
	if managed.SourceID == 0 || managed.TargetNodeID == 0 || managed.TargetNodeID == root.ID {
		t.Fatalf("invalid managed Source/Node: %+v", managed)
	}
	var source meta.Source
	if err := db.First(&source, managed.SourceID).Error; err != nil {
		t.Fatal(err)
	}
	payload := []byte("one exact photos original")
	hash := sha256.Sum256(payload)
	digest := hex.EncodeToString(hash[:])
	key, err := storage.ContentAddressedKey(digest)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := local.Put(context.Background(), key, bytes.NewReader(payload)); err != nil {
		t.Fatal(err)
	}
	node := meta.Node{OwnerID: owner.ID, ParentID: &managed.TargetNodeID,
		Name: "IMG-xios-0123456789abcdef01234567-0123456789ab.heic",
		Type: meta.NodeTypeFile, Revision: 1}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{NodeID: node.ID, Size: int64(len(payload)),
		SHA256: digest, StorageKey: key}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.ContentBlob{SHA256: digest, Size: int64(len(payload)),
		StorageKey: key, RefCount: 1, State: meta.ContentBlobStateReady}).Error; err != nil {
		t.Fatal(err)
	}
	sessionID := uuid.NewString()
	upload := meta.UploadSession{
		ID: sessionID, OwnerID: owner.ID, ParentID: &managed.TargetNodeID,
		ResultNodeID: &node.ID, Name: node.Name, RequestedName: node.Name,
		SourceID: managed.SourceID, SourceRevision: source.Revision,
		SourceDeviceID: device.ID, SourceTargetID: managed.TargetNodeID,
		TotalSize: int64(len(payload)), ChunkSize: defaultUploadChunkSize, ChunkCount: 1,
		SHA256: digest, ResumeKey: "ios_" + strings.Repeat("a", 64),
		ConflictPolicy: meta.UploadConflictPolicyFail,
		Status:         meta.UploadStatusFinalized, ExpiresAt: time.Now().Add(time.Hour),
	}
	// Active/uncertain UploadSession alone must NEVER mint a permanent
	// Hold, even if physical CAS bytes exist under the expected name.
	upload.Status = meta.UploadStatusActive
	if err := db.Create(&upload).Error; err != nil {
		t.Fatal(err)
	}
	body, err := json.Marshal(iosPhotoHoldRequest{
		NodeID: node.ID, NodeRevision: node.Revision, SessionID: sessionID,
		SHA256: digest, ByteSize: int64(len(payload)), Kind: "image",
	})
	if err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/ios/photos/managed/original-retention"
	requestWithHeaders(t, router, http.MethodPost, path, ownerJWT,
		bytes.NewReader(body), http.StatusConflict, headers)
	if err := db.Model(&meta.UploadSession{}).Where("id = ?", sessionID).
		Update("status", meta.UploadStatusFinalized).Error; err != nil {
		t.Fatal(err)
	}
	first := requestWithHeaders(t, router, http.MethodPost, path, ownerJWT,
		bytes.NewReader(body), http.StatusCreated, headers)
	var receipt struct {
		HoldID   string `json:"hold_id"`
		Retained bool   `json:"retained"`
		NodeID   uint64 `json:"node_id"`
		SHA256   string `json:"sha256"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &receipt); err != nil {
		t.Fatal(err)
	}
	if uuid.Validate(receipt.HoldID) != nil || !receipt.Retained ||
		receipt.NodeID != node.ID || receipt.SHA256 != digest {
		t.Fatalf("failed to issue real original hold: %+v", receipt)
	}
	second := requestWithHeaders(t, router, http.MethodPost, path, ownerJWT,
		bytes.NewReader(body), http.StatusOK, headers)
	var idem struct {
		HoldID string `json:"hold_id"`
	}
	if err := json.Unmarshal(second.Body.Bytes(), &idem); err != nil {
		t.Fatal(err)
	}
	if idem.HoldID != receipt.HoldID {
		t.Fatal("idempotent hold unexpectedly changed")
	}
	proofURL := path + "/" + receipt.HoldID
	requestWithHeaders(t, router, http.MethodGet, proofURL, ownerJWT,
		nil, http.StatusOK, headers)

	// A finalized UploadSession is ordinary short-lived transport history,
	// NOT a durable original: the real janitor deletes it on expiry. A
	// permanent held original must remain physically verifiable after that
	// cleanup, and re-preparing the same Hold must remain idempotent.
	if err := db.Model(&meta.UploadSession{}).Where("id = ?", sessionID).
		Update("expires_at", time.Now().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	if err := server.cleanupExpiredUploads(context.Background(), owner.ID); err != nil {
		t.Fatalf("normal expired UploadSession cleanup failed: %v", err)
	}
	var oldSessionCount int64
	if err := db.Model(&meta.UploadSession{}).Where("id = ?", sessionID).
		Count(&oldSessionCount).Error; err != nil || oldSessionCount != 0 {
		t.Fatalf("finalized upload session not pruned: count=%d err=%v",
			oldSessionCount, err)
	}
	requestWithHeaders(t, router, http.MethodGet, proofURL, ownerJWT,
		nil, http.StatusOK, headers)
	retained := requestWithHeaders(t, router, http.MethodPost, path, ownerJWT,
		bytes.NewReader(body), http.StatusOK, headers)
	var retainedProof struct {
		HoldID string `json:"hold_id"`
	}
	if err := json.Unmarshal(retained.Body.Bytes(), &retainedProof); err != nil {
		t.Fatal(err)
	}
	if retainedProof.HoldID != receipt.HoldID {
		t.Fatal("re-preparing an immutable Hold changed its identity after session cleanup")
	}

	if err := db.Delete(&meta.File{}, "node_id = ?", node.ID).Error; err == nil {
		t.Fatal("a confirmed held original File was deleted")
	}
	if err := db.Model(&meta.ContentBlob{}).Where("sha256 = ?", digest).
		Update("state", meta.ContentBlobStateDeleting).Error; err == nil {
		t.Fatal("held physical original entered GC-deleting state")
	}
	holdCount := int64(0)
	if err := db.Model(&meta.IOSPhotoOriginalHold{}).Where("node_id = ?", node.ID).
		Count(&holdCount).Error; err != nil || holdCount != 1 {
		t.Fatalf("lost durable hold: count=%d error=%v", holdCount, err)
	}
}
