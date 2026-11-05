package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestIOSPhotoManagedUploadExactSourceDeviceAndNodeAdmission(t *testing.T) {
	db, server, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.UploadSession{}, &meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("photo-managed-upload-admission", time.Hour)
	router := server.Router()
	token, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	raw := "ios-photo-managed-upload-device-credential-0001"
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Platform: "ios", Name: "Mobile",
		CredentialHash: deviceCredentialDigest(raw), CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	headers := map[string]string{
		"X-XDrive-Device-ID": device.ID, "X-XDrive-Device-Token": raw,
	}
	created := requestWithHeaders(t, router, http.MethodPut,
		"/api/v1/ios/photos/backup-destination", token,
		strings.NewReader(`{"name":"备份相册"}`), http.StatusCreated, headers)
	var response struct {
		SourceID     uint64 `json:"source_id"`
		TargetNodeID uint64 `json:"target_node_id"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.SourceID == 0 || response.TargetNodeID == 0 || response.TargetNodeID == root.ID {
		t.Fatalf("invalid managed Photo Source/Node: %+v", response)
	}
	scope := iosPhotoManagedUploadScope{
		ownerID: owner.ID, deviceID: device.ID,
		sourceID: response.SourceID, sourceRevision: 1, targetID: response.TargetNodeID,
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/ios/photos/managed/uploads", nil)
	c.Request.Header.Set("X-XDrive-Device-Token", raw)
	c.Set(iosPhotoManagedContextKey, scope)
	digest := strings.Repeat("a", 64)
	key := "ios_" + strings.Repeat("b", 64)
	name := "IMG-xios-0123456789abcdef01234567-0123456789ab.heic"
	req := uploadInitRequest{
		ParentID: &response.TargetNodeID, Name: name,
		ConflictPolicy: meta.UploadConflictPolicyFail,
		Size:           64, ChunkSize: defaultUploadChunkSize,
		SHA256: digest, ResumeKey: key,
	}
	if !validIOSPhotoManagedUploadInit(req, scope) {
		t.Fatal("valid original should be admitted by policy")
	}
	ctx := context.Background()
	if err := requireSourceRunOrLocalPushTargetTx(
		ctx, db, c, owner.ID, response.TargetNodeID, req); err != nil {
		t.Fatalf("verified iOS Source+Device+Node original rejected: %v", err)
	}
	// Regular Owner, unrelated SourceRun, Desktop Source and a bare resume-key
	// never substitute for the current iPhone's independently verified token.
	regular, _ := gin.CreateTestContext(httptest.NewRecorder())
	if err := requireSourceRunOrLocalPushTargetTx(
		ctx, db, regular, owner.ID, response.TargetNodeID, req); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("generic Owner gained managed directory write: %v", err)
	}
	bad := req
	bad.ParentID = &root.ID
	if err := requireSourceRunOrLocalPushTargetTx(
		ctx, db, c, owner.ID, root.ID, bad); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("iOS scoped writer escaped target: %v", err)
	}
	bad = req
	bad.ResumeKey = "lp2_" + strings.Repeat("a", 64)
	if validIOSPhotoManagedUploadInit(bad, scope) {
		t.Fatal("Desktop Push resume key was admitted as an iOS original")
	}
	bad = req
	bad.ConflictPolicy = meta.UploadConflictPolicyOverwrite
	if validIOSPhotoManagedUploadInit(bad, scope) {
		t.Fatal("managed photo overwrite was admitted")
	}
	session := meta.UploadSession{
		ID: uuid.NewString(), OwnerID: owner.ID,
		ParentID: &response.TargetNodeID, Name: name, RequestedName: name,
		ConflictPolicy: meta.UploadConflictPolicyFail, TotalSize: req.Size,
		ChunkSize: req.ChunkSize, SHA256: digest, ResumeKey: key,
		Status: meta.UploadStatusActive,
	}
	if err := requireSourceRunOrLocalPushFinalizeTx(
		ctx, db, c, session, response.TargetNodeID); err != nil {
		t.Fatalf("valid managed iOS finalize denied: %v", err)
	}
	if err := authorizeUploadSessionWriteTx(ctx, db, c, session); err != nil {
		t.Fatalf("valid managed iOS chunk write denied: %v", err)
	}
	if err := requireSourceRunOrLocalPushFinalizeTx(
		ctx, db, regular, session, response.TargetNodeID); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("generic Owner gained iOS Source finalize: %v", err)
	}
	// Device token revocation must revoke original creates AND finalize,
	// regardless of prior successful HTTP admission.
	if err := db.Model(&meta.ClientDevice{}).Where("id = ?", device.ID).
		Update("revoked_at", now).Error; err != nil {
		t.Fatal(err)
	}
	if err := requireSourceRunOrLocalPushTargetTx(
		ctx, db, c, owner.ID, response.TargetNodeID, req); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("revoked iPhone continued writing: %v", err)
	}
	if err := requireSourceRunOrLocalPushFinalizeTx(
		ctx, db, c, session, response.TargetNodeID); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("revoked iPhone finalized old session: %v", err)
	}
	if err := authorizeUploadSessionWriteTx(ctx, db, c, session); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("revoked iPhone wrote an upload chunk: %v", err)
	}
}
