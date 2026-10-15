package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

type localPushExistingCASTestFixture struct {
	server           *Server
	ctx              *gin.Context
	local            *storage.Local
	device           meta.ClientDevice
	source           meta.Source
	stage            meta.LocalPushStaging
	proof            localSourceExecutorProof
	body             []byte
	stageKey, casKey string
}

func makeLocalPushExistingCASTestFixture(t *testing.T) localPushExistingCASTestFixture {
	t.Helper()
	db, server, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.LocalSourceBinding{},
		&meta.LocalPushStaging{}, &meta.ContentBlob{}); err != nil {
		t.Fatal(err)
	}
	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server.Store = local
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("GET", "/__internal-only/local-push-existing-cas", nil)
	c.Set("userID", owner.ID)
	secret := "local-precommit-owning-device-test-secret"
	now := time.Now().UTC()
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID,
		Name: "owning test device", Platform: "linux",
		CredentialHash: deviceCredentialDigest(secret), CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	target := createFilePropertiesDir(t, db, owner.ID, root.ID, "Private backup target")
	source := meta.Source{
		OwnerID: owner.ID, Name: "Native Push source",
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
	proof := localSourceExecutorProof{DeviceID: device.ID, RootID: rootID, SourceRevision: 7}
	c.Set(localSourceExecutorContextKey, proof)
	c.Request.Header.Set("X-XDrive-Device-Token", secret)
	c.Request.Header.Set("X-XDrive-Local-Root-Fingerprint", fingerprint)

	body := bytes.Repeat([]byte("canonical-private-original-"), 900)
	sha := sha256.Sum256(body)
	digest := hex.EncodeToString(sha[:])
	casKey, err := storage.ContentAddressedKey(digest)
	if err != nil {
		t.Fatal(err)
	}
	stage := meta.LocalPushStaging{
		SourceID: source.ID, StageID: uuid.NewString(), OwnerID: owner.ID,
		SourceRevision: 7, DeviceID: device.ID, RootID: rootID,
		RootFingerprint: fingerprint, TargetNodeID: target.ID,
		CurrentSnapshotSHA256: strings.Repeat("b", 64),
		CurrentPathKey:        strings.Repeat("c", 64),
		ContentSHA256:         digest, TotalSize: int64(len(body)),
		Status: localPushStageReady, ExpiresAt: now.Add(15 * time.Minute),
	}
	if err := db.Create(&stage).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.ContentBlob{
		SHA256: digest, Size: int64(len(body)), StorageKey: casKey,
		RefCount: 1, State: meta.ContentBlobStateReady,
	}).Error; err != nil {
		t.Fatal(err)
	}
	stageKey, err := localPushStageStoreKey(stage.StageID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := local.Put(context.Background(), stageKey, bytes.NewReader(body)); err != nil {
		t.Fatal(err)
	}
	if _, err := local.Put(context.Background(), casKey, bytes.NewReader(body)); err != nil {
		t.Fatal(err)
	}
	return localPushExistingCASTestFixture{
		server: server, ctx: c, local: local, device: device, source: source,
		stage: stage, proof: proof, body: body, stageKey: stageKey, casKey: casKey,
	}
}

func (f localPushExistingCASTestFixture) observe() (bool, error) {
	return f.server.observeBoundLocalPushExistingCAS(
		f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
	)
}

func TestLocalPushExistingCASPrecommitHasIndependentPhysicalAndScopedSQLChecks(t *testing.T) {
	f := makeLocalPushExistingCASTestFixture(t)
	if ok, err := f.observe(); err != nil || !ok {
		t.Fatalf("fresh device-bound canonical reuse observation failed: ok=%t err=%v", ok, err)
	}
	// The observation cannot write a canonical file record or activate Push.
	var source meta.Source
	if err := f.server.DB.Where("id = ?", f.source.ID).Take(&source).Error; err != nil ||
		source.Status != meta.SourceStatusPaused || source.Revision != 7 {
		t.Fatalf("private observation changed Source: %+v err=%v", source, err)
	}
	var items int64
	if err := f.server.DB.Model(&meta.SourceItem{}).
		Where("source_id = ?", f.source.ID).Count(&items).Error; err != nil || items != 0 {
		t.Fatalf("private observation committed SourceItems: %d err=%v", items, err)
	}
	var saved meta.ContentBlob
	if err := f.server.DB.Where("sha256 = ?", f.stage.ContentSHA256).Take(&saved).Error; err != nil ||
		saved.RefCount != 1 || saved.Size != int64(len(f.body)) {
		t.Fatalf("observation altered CAS refcount: %+v err=%v", saved, err)
	}
	for _, key := range []string{f.stageKey, f.casKey} {
		path := filepath.Join(f.local.FilesystemRoot(), filepath.FromSlash(key))
		bad := append([]byte(nil), f.body...)
		bad[len(bad)/2] ^= 0x80
		if err := os.WriteFile(path, bad, 0o600); err != nil {
			t.Fatal(err)
		}
		if ok, err := f.observe(); ok || err == nil {
			t.Fatalf("same-size corruption of %q was accepted: ok=%t err=%v", key, ok, err)
		}
		if err := os.WriteFile(path, f.body, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if ok, err := f.observe(); err != nil || !ok {
		t.Fatalf("corrected physical bytes still rejected: ok=%t err=%v", ok, err)
	}
	if err := f.local.DeleteStaging(context.Background(), f.stageKey); err != nil {
		t.Fatalf("read pair leaked stage lock: %v", err)
	}
	if err := f.local.Delete(context.Background(), f.casKey); err != nil {
		t.Fatalf("read pair leaked CAS lock: %v", err)
	}
}

func TestLocalPushExistingCASPrecommitRejectsForeignAndInvalidStageMetadata(t *testing.T) {
	f := makeLocalPushExistingCASTestFixture(t)
	f.ctx.Set(localSourceExecutorContextKey, localSourceExecutorProof{
		DeviceID: uuid.NewString(), RootID: f.proof.RootID,
		SourceRevision: f.proof.SourceRevision,
	})
	called := false
	reader := func(context.Context, string, string, int64) (bool, error) {
		called = true
		return true, nil
	}
	if ok, err := f.server.observeBoundLocalPushExistingCASWithReader(
		f.ctx, f.source.ID, 7, f.proof, f.stage.StageID, reader,
	); ok || !errors.Is(err, errLocalSourceExecutorTransactionUnauthorized) || called {
		t.Fatalf("foreign proof bypassed private scope: ok=%t err=%v called=%t", ok, err, called)
	}
	f.ctx.Set(localSourceExecutorContextKey, f.proof)
	foreignToken := "separately-enrolled-same-account-device"
	foreignDevice := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: f.device.OwnerID,
		Name: "Other computer", Platform: "windows",
		CredentialHash: deviceCredentialDigest(foreignToken),
	}
	if err := f.server.DB.Create(&foreignDevice).Error; err != nil {
		t.Fatal(err)
	}
	foreignProof := localSourceExecutorProof{
		DeviceID: foreignDevice.ID, RootID: f.proof.RootID,
		SourceRevision: f.proof.SourceRevision,
	}
	f.ctx.Set(localSourceExecutorContextKey, foreignProof)
	f.ctx.Request.Header.Set("X-XDrive-Device-Token", foreignToken)
	if ok, err := f.server.observeBoundLocalPushExistingCASWithReader(
		f.ctx, f.source.ID, 7, foreignProof, f.stage.StageID, reader,
	); ok || err == nil || called {
		t.Fatalf("same-account foreign Desktop reached physical reader: ok=%t err=%v called=%t", ok, err, called)
	}
	f.ctx.Set(localSourceExecutorContextKey, f.proof)
	f.ctx.Request.Header.Set("X-XDrive-Device-Token", "foreign-computer-token")
	if ok, err := f.server.observeBoundLocalPushExistingCASWithReader(
		f.ctx, f.source.ID, 7, f.proof, f.stage.StageID, reader,
	); ok || err == nil || called {
		t.Fatalf("foreign credential reached physical reader: ok=%t err=%v called=%t", ok, err, called)
	}
	f.ctx.Request.Header.Set("X-XDrive-Device-Token", "local-precommit-owning-device-test-secret")
	for _, status := range []string{localPushStageReserved, localPushStageFailed, localPushStageCanceled} {
		if err := f.server.DB.Model(&meta.LocalPushStaging{}).
			Where("source_id = ?", f.source.ID).Update("status", status).Error; err != nil {
			t.Fatal(err)
		}
		if ok, err := f.observe(); ok || err == nil {
			t.Fatalf("non-staged %q was admitted: ok=%t err=%v", status, ok, err)
		}
	}
	if err := f.server.DB.Model(&meta.LocalPushStaging{}).
		Where("source_id = ?", f.source.ID).Update("status", localPushStageReady).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.server.DB.Model(&meta.ContentBlob{}).
		Where("sha256 = ?", f.stage.ContentSHA256).
		Update("state", "failed").Error; err != nil {
		t.Fatal(err)
	}
	if ok, err := f.observe(); ok || err == nil {
		t.Fatalf("non-ready canonical blob accepted: ok=%t err=%v", ok, err)
	}
	if err := f.server.DB.Model(&meta.ContentBlob{}).
		Where("sha256 = ?", f.stage.ContentSHA256).
		Updates(map[string]any{"state": meta.ContentBlobStateReady, "ref_count": 0}).Error; err != nil {
		t.Fatal(err)
	}
	if ok, err := f.observe(); ok || err == nil {
		t.Fatalf("unreferenced canonical blob accepted: ok=%t err=%v", ok, err)
	}
	if err := f.server.DB.Model(&meta.ContentBlob{}).
		Where("sha256 = ?", f.stage.ContentSHA256).
		Update("ref_count", 1).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.server.DB.Model(&meta.LocalPushStaging{}).
		Where("source_id = ?", f.source.ID).
		Update("expires_at", time.Now().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	if ok, err := f.observe(); ok || err == nil {
		t.Fatalf("expired private Stage accepted: ok=%t err=%v", ok, err)
	}
}
