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
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

func TestLocalPushStagingOwnDeviceActualBytesNeverCommitSource(t *testing.T) {
	db, server, owner, other, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.LocalSourceBinding{},
		&meta.LocalPushStaging{}, &meta.UploadSession{}, &meta.SyncRun{}, &meta.FileVersion{},
		&meta.ContentBlob{}); err != nil {
		t.Fatal(err)
	}
	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server.Store = local
	server.Auth = auth.New("local-push-private-staging-test", time.Hour)
	server.RefreshTTL = 24 * time.Hour
	gin.SetMode(gin.TestMode)
	router := server.Router()
	ownerJWT, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	foreignJWT, err := server.Auth.Issue(other.ID, other.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	secret := "local-push-staging-A-owning-device-secret"
	foreignSecret := "local-push-staging-B-foreign-device-secret"
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "Owning A",
		Platform: "linux", CredentialHash: deviceCredentialDigest(secret),
		CreatedAt: now, UpdatedAt: now,
	}
	foreignDevice := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "Foreign B",
		Platform: "windows", CredentialHash: deviceCredentialDigest(foreignSecret),
		CreatedAt: now, UpdatedAt: now,
	}
	for _, d := range []meta.ClientDevice{device, foreignDevice} {
		if err := db.Create(&d).Error; err != nil {
			t.Fatal(err)
		}
	}
	target := createFilePropertiesDir(t, db, owner.ID, root.ID, "Backup Target")
	source := meta.Source{
		OwnerID: owner.ID, Name: "Private staging source",
		Kind: meta.SourceKindLocalFolder, Direction: meta.SourceDirectionPush,
		SyncMode: meta.SourceSyncModeBackup, Status: meta.SourceStatusPaused,
		Revision: 7, TargetNodeID: &target.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	rootID := uuid.NewString()
	fingerprint := strings.Repeat("a", 64)
	if err := db.Create(&meta.LocalSourceBinding{
		SourceID: source.ID, OwnerID: owner.ID, DeviceID: device.ID,
		RootID: rootID, RootFingerprint: fingerprint,
		CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	proof := map[string]string{
		"If-Match":                        "\"7\"",
		"X-XDrive-Device-ID":              device.ID,
		"X-XDrive-Device-Token":           secret,
		"X-XDrive-Local-Root-ID":          rootID,
		"X-XDrive-Local-Root-Fingerprint": fingerprint,
	}
	cloneProof := func() map[string]string {
		copy := make(map[string]string, len(proof))
		for k, v := range proof {
			copy[k] = v
		}
		return copy
	}
	payload := []byte(strings.Repeat("real-agent-original-contents-", 8000))
	sha := sha256.Sum256(payload)
	input := localPushStageRequest{
		CurrentSnapshotSHA256: strings.Repeat("b", 64),
		CurrentPathKey:        strings.Repeat("c", 64),
		SHA256:                hex.EncodeToString(sha[:]), Size: int64(len(payload)),
	}
	marshal := func(v localPushStageRequest) string {
		t.Helper()
		data, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		return string(data)
	}
	url := fmt.Sprintf("/api/v1/sources/%d/local-staging", source.ID)
	post := func(jwt string, headers map[string]string, body string, expected int) localPushStageDTO {
		t.Helper()
		response := requestWithHeaders(t, router, http.MethodPost, url, jwt,
			strings.NewReader(body), expected, headers)
		if strings.Contains(response.Body.String(), rootID) ||
			strings.Contains(response.Body.String(), fingerprint) ||
			strings.Contains(response.Body.String(), secret) {
			t.Fatal("native Root or credential leaked through staging reply")
		}
		if expected != http.StatusCreated && expected != http.StatusOK {
			return localPushStageDTO{}
		}
		if !strings.Contains(response.Header().Get("Cache-Control"), "no-store") ||
			response.Header().Get("ETag") != "\"7\"" {
			t.Fatalf("staging response omitted no-store/revision fencing: %v", response.Header())
		}
		var got localPushStageDTO
		if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		return got
	}
	stage := post(ownerJWT, cloneProof(), marshal(input), http.StatusCreated)
	if stage.SourceID != source.ID || stage.Revision != 7 ||
		stage.Status != localPushStageReserved || stage.Size != int64(len(payload)) ||
		stage.StageID == "" {
		t.Fatalf("invalid private stage reservation: %+v", stage)
	}
	replay := post(ownerJWT, cloneProof(), marshal(input), http.StatusOK)
	// PostgreSQL stores microsecond timestamps whereas the initial Go
	// reservation may hold nanoseconds. JSON round-tripping the initial
	// response must not turn exact stage reuse into a false negative.
	if replay.StageID != stage.StageID || replay.SourceID != stage.SourceID ||
		replay.Revision != stage.Revision || replay.Size != stage.Size ||
		replay.Status != stage.Status ||
		replay.ExpiresAt.Sub(stage.ExpiresAt) <= -time.Millisecond ||
		replay.ExpiresAt.Sub(stage.ExpiresAt) >= time.Millisecond ||
		replay.ContentVerified || replay.CommitSupported ||
		replay.Authoritative || replay.MissingInferenceSafe {
		t.Fatalf("duplicate stage reservation was not idempotent: %+v %+v", replay, stage)
	}
	bad := input
	bad.SHA256 = strings.Repeat("d", 64)
	post(ownerJWT, cloneProof(), marshal(bad), http.StatusConflict)
	bad = input
	bad.Size = localPushStageMaxBytes + 1
	post(ownerJWT, cloneProof(), marshal(bad), http.StatusBadRequest)
	post(foreignJWT, cloneProof(), marshal(input), http.StatusNotFound)
	post(ownerJWT, map[string]string{"If-Match": "\"7\""},
		marshal(input), http.StatusForbidden)
	foreignProof := cloneProof()
	foreignProof["X-XDrive-Device-ID"] = foreignDevice.ID
	foreignProof["X-XDrive-Device-Token"] = foreignSecret
	post(ownerJWT, foreignProof, marshal(input), http.StatusForbidden)

	bytesURL := url + "/" + stage.StageID + "/content"
	response := requestWithHeaders(t, router, http.MethodPut, bytesURL,
		ownerJWT, bytes.NewReader(payload), http.StatusOK, cloneProof())
	var received localPushStageDTO
	if err := json.Unmarshal(response.Body.Bytes(), &received); err != nil ||
		received.StageID != stage.StageID || received.Status != localPushStageReady {
		t.Fatalf("native Source bytes not staged correctly: %+v err=%v", received, err)
	}
	key, err := localPushStageStoreKey(stage.StageID)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := local.Open(context.Background(), key)
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(handle)
	_ = handle.Close()
	if err != nil || !bytes.Equal(data, payload) {
		t.Fatalf("physical staging bytes do not match native upload: %v", err)
	}
	requestWithHeaders(t, router, http.MethodPut, bytesURL,
		ownerJWT, bytes.NewReader(payload), http.StatusConflict, cloneProof())
	status := requestWithHeaders(t, router, http.MethodGet,
		url+"/"+stage.StageID, ownerJWT, nil, http.StatusOK, cloneProof())
	if !strings.Contains(status.Body.String(), "\"status\":\"staged\"") {
		t.Fatalf("owning Agent staging readback missing ready state: %s", status.Body.String())
	}
	var sources int64
	if err := db.Model(&meta.SourceItem{}).Where("source_id = ?", source.ID).Count(&sources).Error; err != nil || sources != 0 {
		t.Fatalf("staging unexpectedly committed SourceItems: count=%d err=%v", sources, err)
	}
	var runs, versions, blobs int64
	for _, check := range []struct {
		model any
		count *int64
	}{
		{&meta.SyncRun{}, &runs}, {&meta.FileVersion{}, &versions}, {&meta.ContentBlob{}, &blobs},
	} {
		if err := db.Model(check.model).Count(check.count).Error; err != nil {
			t.Fatal(err)
		}
	}
	if runs != 0 || versions != 0 || blobs != 0 {
		t.Fatalf("staging granted canonical upload/run authority: %d %d %d", runs, versions, blobs)
	}
	if err := db.Where("id = ?", source.ID).Take(&source).Error; err != nil ||
		source.Status != meta.SourceStatusPaused {
		t.Fatalf("staging activated local Source: status=%q err=%v", source.Status, err)
	}
	requestWithHeaders(t, router, http.MethodDelete, url+"/"+stage.StageID,
		ownerJWT, nil, http.StatusNoContent, cloneProof())
	if _, err := local.Open(context.Background(), key); !os.IsNotExist(err) {
		t.Fatalf("cancelled temp staging remained on disk: %v", err)
	}
	next := post(ownerJWT, cloneProof(), marshal(input), http.StatusCreated)
	if next.StageID == stage.StageID {
		t.Fatal("cancelled stage ID reused for new upload")
	}
	// A stale session must never control a newer staging reservation.
	requestWithHeaders(t, router, http.MethodGet, url+"/"+stage.StageID,
		ownerJWT, nil, http.StatusNotFound, cloneProof())

	badData := append([]byte(nil), payload...)
	badData[0] ^= 1
	failedURL := url + "/" + next.StageID + "/content"
	requestWithHeaders(t, router, http.MethodPut, failedURL,
		ownerJWT, bytes.NewReader(badData), http.StatusConflict, cloneProof())
	failedKey, err := localPushStageStoreKey(next.StageID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := local.Open(context.Background(), failedKey); !os.IsNotExist(err) {
		t.Fatalf("digest mismatch retained temporary uploaded bytes: %v", err)
	}
	// Revocation must block *all* subsequent write and readback requests.
	revokedAt := time.Now().UTC()
	if err := db.Model(&meta.ClientDevice{}).Where("id = ?", device.ID).
		Update("revoked_at", &revokedAt).Error; err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodGet, url+"/"+next.StageID,
		ownerJWT, nil, http.StatusForbidden, cloneProof())
	requestWithHeaders(t, router, http.MethodPost, url,
		ownerJWT, strings.NewReader(marshal(input)), http.StatusForbidden, cloneProof())

	// Keep UI and Owner JWT read-only behavior unchanged: the stage is never
	// a generic UploadSession and cannot be finalized by /uploads/:id.
	var genericSessions int64
	if err := db.Model(&meta.UploadSession{}).Count(&genericSessions).Error; err != nil || genericSessions != 0 {
		t.Fatalf("local staging leaked into generic uploads: count=%d err=%v", genericSessions, err)
	}
}

func TestLocalPushStageCanonicalTemporaryKeyAndBudget(t *testing.T) {
	for _, input := range []localPushStageRequest{
		{Size: -1, CurrentSnapshotSHA256: strings.Repeat("a", 64),
			CurrentPathKey: strings.Repeat("b", 64), SHA256: strings.Repeat("c", 64)},
		{Size: localPushStageMaxBytes + 1, CurrentSnapshotSHA256: strings.Repeat("a", 64),
			CurrentPathKey: strings.Repeat("b", 64), SHA256: strings.Repeat("c", 64)},
		{Size: 1, CurrentSnapshotSHA256: strings.Repeat("A", 64),
			CurrentPathKey: strings.Repeat("b", 64), SHA256: strings.Repeat("c", 64)},
	} {
		if validLocalPushStageRequest(input) {
			t.Fatalf("invalid/unbounded private staging request admitted: %+v", input)
		}
	}
	for _, wrong := range []string{"", "../../outside", uuid.NewString() + "/../xx"} {
		if key, err := localPushStageStoreKey(wrong); err == nil || key != "" {
			t.Fatalf("untrusted stage id gained storage key: %q %v", key, err)
		}
	}
	id := uuid.NewString()
	if got, err := localPushStageStoreKey(id); err != nil ||
		got != storage.UploadStagingDir+"/localpush/"+id+".part" {
		t.Fatalf("server-owned temporary storage key incorrect: %q %v", got, err)
	}
}
