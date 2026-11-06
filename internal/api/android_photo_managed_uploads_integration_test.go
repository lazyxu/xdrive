package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
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

func TestAndroidPhotoManagedUploadUsesDeviceSourceTargetAndCanonicalCAS(t *testing.T) {
	db, server, owner, foreign, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(
		&meta.ClientDevice{}, &meta.LocalSourceBinding{}, &meta.SyncRun{},
		&meta.FileVersion{}, &meta.ContentBlob{}, &meta.UploadSession{}, &meta.UploadPart{},
	); err != nil {
		t.Fatal(err)
	}
	localStore, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server.Store = localStore
	server.MaxUploadBytes = 16 << 20
	server.Auth = auth.New("android-photo-managed-upload-integration", time.Hour)
	gin.SetMode(gin.TestMode)
	router := server.Router()
	token, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	foreignToken, err := server.Auth.Issue(foreign.ID, foreign.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	secret := strings.Repeat("verified-android-native-token-", 2)
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Platform: "android",
		Name: "Pixel 9", CredentialHash: deviceCredentialDigest(secret),
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	proof := map[string]string{
		"X-XDrive-Device-ID": device.ID, "X-XDrive-Device-Token": secret,
	}
	created := requestWithHeaders(t, router, http.MethodPut,
		"/api/v1/android/photos/backup-destination", token,
		strings.NewReader(`{"name":"Android 原件"}`), http.StatusCreated, proof)
	var target struct {
		SourceID uint64 `json:"source_id"`
		SourceRevision uint64 `json:"source_revision"`
		TargetNodeID uint64 `json:"target_node_id"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &target); err != nil {
		t.Fatal(err)
	}
	if target.SourceID == 0 || target.SourceRevision != 1 || target.TargetNodeID == 0 ||
		target.TargetNodeID == root.ID {
		t.Fatalf("invalid Android managed Source/Target: %+v", target)
	}
	// An Owner JWT, another Owner or unbound Source identity must never
	// adopt the canonical Push destination.
	requestWithHeaders(t, router, http.MethodPost, "/api/v1/uploads", token,
		strings.NewReader(fmt.Sprintf(`{"parent_id":%d,"name":"ordinary.jpg","size":3}`,
			target.TargetNodeID)), http.StatusConflict, nil)

	name := "xdrive-photo-" + strings.Repeat("a", 20) + "-" + strings.Repeat("b", 20) + ".jpg"
	digest := sha256.Sum256([]byte("abc"))
	hash := hex.EncodeToString(digest[:])
	resume := "and_" + strings.Repeat("c", 64)
	const chunkSize = 8 << 20
	start := fmt.Sprintf(`{"parent_id":%d,"name":%q,"size":3,"chunk_size":%d,"conflict_policy":"fail","sha256":%q,"resume_key":%q}`,
		target.TargetNodeID, name, chunkSize, hash, resume)
	endpoint := "/api/v1/android/photos/managed/uploads"
	requestWithHeaders(t, router, http.MethodPost, endpoint, foreignToken,
		strings.NewReader(start), http.StatusForbidden, proof)
	requestWithHeaders(t, router, http.MethodPost, endpoint, token,
		strings.NewReader(start), http.StatusForbidden, nil)
	for _, invalid := range []string{
		strings.Replace(start, fmt.Sprintf(`"parent_id":%d`, target.TargetNodeID),
			fmt.Sprintf(`"parent_id":%d`, root.ID), 1),
		strings.Replace(start, `"conflict_policy":"fail"`,
			`"conflict_policy":"overwrite"`, 1),
		strings.Replace(start, `"resume_key"`,
			`"source_id":999,"resume_key"`, 1),
	} {
		requestWithHeaders(t, router, http.MethodPost, endpoint, token,
			strings.NewReader(invalid), http.StatusForbidden, proof)
	}
	init := requestWithHeaders(t, router, http.MethodPost, endpoint, token,
		strings.NewReader(start), http.StatusCreated, proof)
	var session uploadSessionDTO
	if err := json.Unmarshal(init.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	if session.ID == "" || session.Status != meta.UploadStatusActive ||
		session.ParentID == nil || *session.ParentID != target.TargetNodeID ||
		session.Name != name || session.ResumeKey != resume {
		t.Fatalf("unverified Android UploadSession: %+v", session)
	}
	var persisted meta.UploadSession
	if err := db.Where("id = ?", session.ID).Take(&persisted).Error; err != nil {
		t.Fatal(err)
	}
	if persisted.SourceID != target.SourceID || persisted.SourceRevision != 1 ||
		persisted.SourceDeviceID != device.ID || persisted.SourceTargetID != target.TargetNodeID ||
		persisted.SourceRootID != "" || persisted.SourceRootFingerprint != "" ||
		persisted.SourceRunID != "" || persisted.ShareID != nil {
		t.Fatalf("UploadSession lacks immutable Source/Device/Target: %+v", persisted)
	}
	u := endpoint + "/" + session.ID
	requestWithHeaders(t, router, http.MethodGet, u, token,
		nil, http.StatusForbidden, nil)
	requestWithHeaders(t, router, http.MethodGet, u, token,
		nil, http.StatusOK, proof)

	chunkHeaders := map[string]string{
		"X-XDrive-Device-ID": device.ID,
		"X-XDrive-Device-Token": secret,
		"X-Chunk-SHA256": hash,
	}
	requestWithHeaders(t, router, http.MethodPut, u+"/chunks/0", token,
		bytes.NewReader([]byte("abc")), http.StatusCreated, chunkHeaders)
	finalize := requestWithHeaders(t, router, http.MethodPost,
		u+"/finalize", token, strings.NewReader(`{}`), http.StatusOK, proof)
	var committed uploadSessionDTO
	if err := json.Unmarshal(finalize.Body.Bytes(), &committed); err != nil {
		t.Fatal(err)
	}
	if committed.Status != meta.UploadStatusFinalized || committed.Result == nil ||
		committed.Result.Name != name || committed.Result.Size != 3 ||
		committed.Result.ParentID == nil || *committed.Result.ParentID != target.TargetNodeID {
		t.Fatalf("no canonical CAS/Node original receipt: %+v", committed)
	}
	body := fmt.Sprintf(`{"parent_id":%d,"name":%q,"size":3,"chunk_size":%d,"sha256":%q,"resume_key":%q}`,
		target.TargetNodeID, name, chunkSize, hash, resume)
	got := requestWithHeaders(t, router, http.MethodPost,
		endpoint+"/resume-lookup", token, strings.NewReader(body), http.StatusOK, proof)
	var receipt uploadSessionDTO
	if err := json.Unmarshal(got.Body.Bytes(), &receipt); err != nil {
		t.Fatal(err)
	}
	if receipt.ID != session.ID || receipt.Status != meta.UploadStatusFinalized ||
		receipt.Result == nil || receipt.Result.ID != committed.Result.ID {
		t.Fatalf("Android managed read-only reconciliation lost receipt: %+v", receipt)
	}
	// The legacy Owner-root Android endpoint cannot retrieve a managed
	// Source Session by replaying the same unpredictable resume key.
	requestWithHeaders(t, router, http.MethodPost, "/api/v1/uploads/android-photo-receipt",
		token, strings.NewReader(body), http.StatusNotFound, nil)

	// A Source revision change fences every existing session (even when
	// Owner bearer and Android Device credentials are otherwise unchanged).
	if err := db.Model(&meta.Source{}).Where("id = ?", target.SourceID).
		Update("revision", uint64(2)).Error; err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodGet, u, token,
		nil, http.StatusForbidden, proof)
	if err := db.Model(&meta.Source{}).Where("id = ?", target.SourceID).
		Update("revision", uint64(1)).Error; err != nil {
		t.Fatal(err)
	}
	// A revoked Device fences pending chunk and finalize; an existing
	// committed Node is not erased and cannot be falsified into another ACK.
	nextName := "xdrive-video-" + strings.Repeat("d", 20) + "-" + strings.Repeat("e", 20) + ".mp4"
	nextKey := "and_" + strings.Repeat("f", 64)
	nextInit := strings.ReplaceAll(strings.Replace(start, name, nextName), resume, nextKey)
	pending := requestWithHeaders(t, router, http.MethodPost, endpoint,
		token, strings.NewReader(nextInit), http.StatusCreated, proof)
	var next uploadSessionDTO
	if err := json.Unmarshal(pending.Body.Bytes(), &next); err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodPost,
		"/api/v1/devices/"+device.ID+"/revoke", token, nil, http.StatusNoContent, nil)
	requestWithHeaders(t, router, http.MethodPut, endpoint+"/"+next.ID+"/chunks/0", token,
		bytes.NewReader([]byte("abc")), http.StatusForbidden, chunkHeaders)
	requestWithHeaders(t, router, http.MethodPost, endpoint+"/"+next.ID+"/finalize",
		token, strings.NewReader(`{}`), http.StatusForbidden, proof)
	requestWithHeaders(t, router, http.MethodPost, endpoint+"/resume-lookup",
		token, strings.NewReader(body), http.StatusForbidden, proof)

	var authCount int64
	if err := db.Model(&meta.AuditEvent{}).
		Where("action = ? AND result = ?", uploadAuthorizationAuditAction, "success").
		Count(&authCount).Error; err != nil || authCount < 3 {
		t.Fatalf("missing durable UploadSession/Chunk/Finalize audit: count=%d err=%v", authCount, err)
	}
}
