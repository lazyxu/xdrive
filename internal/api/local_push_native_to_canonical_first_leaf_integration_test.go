//go:build linux || windows

package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushstage"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

// This tests an actual native original -> authenticated Gin/PostgreSQL
// temporary stage -> physical CAS -> canonical one-leaf SQL transaction.
// NONE of the internal CAS/SQL steps is a registered Server endpoint. A
// successful fixture is NOT a SourceRun, executable backup or permission to
// allow a user/another device to call the private first-file writer.
type localNativeCanonicalFixture struct {
	server       *Server
	store        *storage.Local
	nativeClient *client.Client
	configDir    string
	root         localpush.RootGrant
	nativeProof  client.LocalBoundSourceProof
	sqlProof     localSourceExecutorProof
	request      *gin.Context
	source       meta.Source
	device       meta.ClientDevice
	stage        localpushstage.LocalOriginalServerStage
	body         []byte
	stagePUTs    *atomic.Int32
}

func makeLocalNativeCanonicalFixture(t *testing.T) localNativeCanonicalFixture {
	t.Helper()
	db, app, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(
		&meta.ClientDevice{}, &meta.LocalSourceBinding{},
		&meta.LocalPushStaging{}, &meta.LocalPushCASPrepareIntent{},
		&meta.LocalPushQuotaHold{}, &meta.ContentBlob{}, &meta.FileVersion{},
		&meta.UploadSession{}, &meta.SyncRun{},
	); err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	app.Store = store
	app.Auth = auth.New("local-native-canonical-first-leaf-test", time.Hour)
	app.RefreshTTL = 24 * time.Hour
	gin.SetMode(gin.TestMode)
	jwt, err := app.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	token := "local-native-first-leaf-owning-device-only"
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "Native physical source",
		Platform: runtime.GOOS, CredentialHash: deviceCredentialDigest(token),
		CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	target := createFilePropertiesDir(t, db, owner.ID, root.ID, "Private real-byte target")
	source := meta.Source{
		OwnerID: owner.ID, Name: "Unrouted local Push fixture",
		Kind: meta.SourceKindLocalFolder, Direction: meta.SourceDirectionPush,
		SyncMode: meta.SourceSyncModeBackup, Status: meta.SourceStatusPaused,
		Revision: 7, TargetNodeID: &target.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	originalRoot := filepath.Join(t.TempDir(), "native-root")
	configDir := filepath.Join(t.TempDir(), "private-agent-config")
	if err := os.MkdirAll(originalRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	body := bytes.Repeat([]byte("physical-native-to-canonical-first-leaf-"), 6000)
	if err := os.WriteFile(filepath.Join(originalRoot, localPushFirstLeafFixtureName), body, 0o600); err != nil {
		t.Fatal(err)
	}
	router := app.Router()
	var puts atomic.Int32
	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPut && strings.HasSuffix(r.URL.Path, "/content") {
			puts.Add(1)
		}
		router.ServeHTTP(w, r)
	}))
	t.Cleanup(httpServer.Close)
	grant, err := localpush.PrepareRootGrant(
		httpServer.URL, "owner", source.ID, device.ID, originalRoot,
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := localpush.SaveRootGrant(configDir, grant); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.LocalSourceBinding{
		SourceID: source.ID, OwnerID: owner.ID, DeviceID: device.ID,
		RootID: grant.RootID, RootFingerprint: grant.Fingerprint,
		CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	journal, err := localpush.BeginInventoryJournal(configDir, grant)
	if err != nil {
		t.Fatal(err)
	}
	defer journal.Abort()
	stats, err := (localpush.InventoryScanner{
		IncludeNativeIdentity: true,
		BatchSize:             localpush.DefaultInventoryBatchSize,
	}).ScanInventory(context.Background(), grant, journal.Append)
	if err != nil || !stats.Complete {
		t.Fatalf("native CURRENT scan: %+v err=%v", stats, err)
	}
	if _, err := journal.Commit(stats); err != nil {
		t.Fatal(err)
	}
	nativeProof := client.LocalBoundSourceProof{
		DeviceID: device.ID, DeviceToken: token,
		RootID: grant.RootID, RootFingerprint: grant.Fingerprint,
	}
	cli := client.New(httpServer.URL, jwt)
	digest := sha256.Sum256(body)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	stage, err := localpushstage.StageVerifiedNativeOriginalBytes(
		cli, ctx, configDir, grant, source.Revision, nativeProof,
		localPushFirstLeafFixtureName, hex.EncodeToString(digest[:]),
	)
	if err != nil || stage.StageID == "" || stage.SHA256 != hex.EncodeToString(digest[:]) {
		t.Fatalf("real native -> Gin physical Stage failed: %+v err=%v", stage, err)
	}
	pathKey, err := localpush.LocalInventoryPathKey(grant, "file", localPushFirstLeafFixtureName)
	if err != nil || stage.CurrentPathKey != pathKey {
		t.Fatalf("native stage lost its exact Root/path identity: %+v err=%v", stage, err)
	}
	// Recreate exactly the owning-device context injected by the existing
	// local-source executor middleware, but do not register any write route.
	sqlProof := localSourceExecutorProof{
		DeviceID: device.ID, RootID: grant.RootID, SourceRevision: source.Revision,
	}
	request, _ := gin.CreateTestContext(httptest.NewRecorder())
	request.Request = httptest.NewRequest(http.MethodGet, "/__private-unrouted-native-canonical-commit", nil)
	request.Set("userID", owner.ID)
	request.Set(localSourceExecutorContextKey, sqlProof)
	request.Request.Header.Set("X-XDrive-Device-Token", token)
	request.Request.Header.Set("X-XDrive-Local-Root-Fingerprint", grant.Fingerprint)
	request.Request.Header.Set("X-XDrive-Local-Root-ID", grant.RootID)
	if err := db.Model(&meta.User{}).Where("id = ?", owner.ID).
		Update("quota_bytes", int64(len(body))*2).Error; err != nil {
		t.Fatal(err)
	}
	return localNativeCanonicalFixture{
		server: app, store: store, nativeClient: cli, configDir: configDir,
		root: grant, nativeProof: nativeProof, sqlProof: sqlProof,
		request: request, source: source, device: device,
		stage: stage, body: body, stagePUTs: &puts,
	}
}

func (f localNativeCanonicalFixture) nativePrecommit() (localpushstage.LocalNativePrecommitObservation, error) {
	return localpushstage.PreflightStagedNativeOriginalForCommit(
		f.nativeClient, context.Background(), f.configDir,
		f.root, f.source.Revision, f.nativeProof, f.stage,
		localPushFirstLeafFixtureName,
	)
}

func (f localNativeCanonicalFixture) prepareAndReserve(t *testing.T) {
	t.Helper()
	if created, err := f.server.quarantineBoundLocalPushCASPrepareIntent(
		f.request, f.source.ID, f.source.Revision, f.sqlProof, f.stage.StageID,
	); err != nil || !created {
		t.Fatalf("quarantine exact owned stage: created=%t err=%v", created, err)
	}
	if prepared, err := f.server.prepareQuarantinedBoundLocalPushNewCAS(
		f.request, f.source.ID, f.source.Revision, f.sqlProof, f.stage.StageID,
	); err != nil || !prepared {
		t.Fatalf("materialize actual native bytes into canonical CAS: prepared=%t err=%v", prepared, err)
	}
	if booked, err := f.server.reserveBoundLocalPushQuota(
		f.request, f.source.ID, f.source.Revision, f.sqlProof, f.stage.StageID,
	); err != nil || !booked {
		t.Fatalf("reserve owner quota after physical CAS recheck: booked=%t err=%v", booked, err)
	}
}

func TestLocalPushRealNativeToGinCASToFirstLeafPrivateSQLCommit(t *testing.T) {
	f := makeLocalNativeCanonicalFixture(t)
	observed, err := f.nativePrecommit()
	if err != nil || !observed.NativeMatched || !observed.PhysicalStageMatched ||
		observed.Authoritative || observed.CommitSupported {
		t.Fatalf("real native original and temporary Stage not rechecked: %+v err=%v", observed, err)
	}
	f.prepareAndReserve(t)
	first, admitted, err := f.server.commitBoundLocalPushFirstLeaf(
		f.request, f.source.ID, f.source.Revision, f.sqlProof, f.stage.StageID,
		localPushFirstLeafFixtureName,
	)
	if err != nil || !admitted || first.Replayed || first.NodeID == 0 || first.SourceItemID == 0 {
		t.Fatalf("real original -> Stage -> CAS -> SQL commit failed: %+v admitted=%t err=%v",
			first, admitted, err)
	}
	again, admitted, err := f.server.commitBoundLocalPushFirstLeaf(
		f.request, f.source.ID, f.source.Revision, f.sqlProof, f.stage.StageID,
		localPushFirstLeafFixtureName,
	)
	if err != nil || !admitted || !again.Replayed ||
		again.NodeID != first.NodeID || again.SourceItemID != first.SourceItemID {
		t.Fatalf("ambiguous first-leaf reply duplicated metadata: %+v err=%v", again, err)
	}
	receipt, err := f.server.readBoundLocalPushFirstLeafPhysicalReceipt(
		f.request, f.source.ID, f.source.Revision, f.sqlProof, f.stage.StageID,
		localPushFirstLeafFixtureName,
	)
	if err != nil || receipt.State != localPushFirstLeafPhysicalReceiptState ||
		receipt.NodeID != first.NodeID || receipt.SourceItemID != first.SourceItemID {
		t.Fatalf("real canonical CAS and SQL receipt not jointly observable: %+v err=%v", receipt, err)
	}
	var blob meta.ContentBlob
	if err := f.server.DB.Where("sha256 = ?", f.stage.SHA256).Take(&blob).Error; err != nil ||
		blob.State != meta.ContentBlobStateReady || blob.Size != int64(len(f.body)) ||
		blob.RefCount != 1 {
		t.Fatalf("canonical CAS lifetime not durably referenced: %+v err=%v", blob, err)
	}
	r, err := f.store.Open(context.Background(), blob.StorageKey)
	if err != nil {
		t.Fatal(err)
	}
	actual, readErr := io.ReadAll(r)
	closeErr := r.Close()
	if readErr != nil || closeErr != nil || !bytes.Equal(actual, f.body) {
		t.Fatalf("native original changed across physical CAS commit: read=%v close=%v", readErr, closeErr)
	}
	var item meta.SourceItem
	if err := f.server.DB.Where("id = ?", first.SourceItemID).Take(&item).Error; err != nil ||
		item.NodeID == nil || *item.NodeID != first.NodeID ||
		item.ExternalID != f.stage.CurrentPathKey || item.State != meta.SourceItemStatePending ||
		item.LastSyncedAt != nil || item.LastSyncedRunID != "" {
		t.Fatalf("SourceItem claimed a backup before a real SourceRun: %+v err=%v", item, err)
	}
	var hold meta.LocalPushQuotaHold
	if err := f.server.DB.Where("stage_id = ?", f.stage.StageID).Take(&hold).Error; err != nil ||
		hold.CommittedAt == nil || hold.ReleasedAt == nil ||
		hold.CommittedNodeID == nil || *hold.CommittedNodeID != first.NodeID ||
		hold.CommittedSourceItemID == nil || *hold.CommittedSourceItemID != first.SourceItemID {
		t.Fatalf("native first-leaf quota exchange not atomic: %+v err=%v", hold, err)
	}
	var fileVersion, runCount int64
	if err := f.server.DB.Model(&meta.FileVersion{}).
		Where("node_id = ?", first.NodeID).Count(&fileVersion).Error; err != nil || fileVersion != 0 {
		t.Fatalf("new leaf invented a previous FileVersion: %d err=%v", fileVersion, err)
	}
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runCount).Error; err != nil || runCount != 0 {
		t.Fatalf("unrouted private file commit fabricated SourceRun: %d err=%v", runCount, err)
	}
	var source meta.Source
	if err := f.server.DB.Where("id = ?", f.source.ID).Take(&source).Error; err != nil ||
		source.Status != meta.SourceStatusPaused {
		t.Fatalf("private CAS/SQL path activated local backup: %+v err=%v", source, err)
	}
	if f.stagePUTs.Load() != 1 {
		t.Fatalf("native bytes were uploaded more than once: HTTP PUT count=%d", f.stagePUTs.Load())
	}
}

func TestLocalPushRealNativeBeforeCASCommitRejectsChangedOriginal(t *testing.T) {
	f := makeLocalNativeCanonicalFixture(t)
	// Same file size but new physical bytes since CURRENT and Stage. The
	// new file must not be turned into the old SourceItem by an executor.
	changed := bytes.Repeat([]byte{0xa5}, len(f.body))
	if err := os.WriteFile(
		filepath.Join(f.root.Path, localPushFirstLeafFixtureName), changed, 0o600,
	); err != nil {
		t.Fatal(err)
	}
	positive, err := f.nativePrecommit()
	if err == nil || positive.NativeMatched || positive.PhysicalStageMatched {
		t.Fatalf("mutated original passed private precommit: %+v err=%v", positive, err)
	}
	var blobs, items int64
	if err := f.server.DB.Model(&meta.ContentBlob{}).Count(&blobs).Error; err != nil || blobs != 0 {
		t.Fatalf("failed native proof created canonical ContentBlob: %d err=%v", blobs, err)
	}
	if err := f.server.DB.Model(&meta.SourceItem{}).
		Where("source_id = ?", f.source.ID).Count(&items).Error; err != nil || items != 0 {
		t.Fatalf("failed native proof created SourceItem: %d err=%v", items, err)
	}
}

func TestLocalPushRealNativeBeforeCASCommitRejectsChangedServerStage(t *testing.T) {
	f := makeLocalNativeCanonicalFixture(t)
	key, err := localPushStageStoreKey(f.stage.StageID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.store.Put(context.Background(), key,
		bytes.NewReader(bytes.Repeat([]byte{0xb1}, len(f.body)))); err != nil {
		t.Fatal(err)
	}
	positive, err := f.nativePrecommit()
	if err == nil || positive.NativeMatched || positive.PhysicalStageMatched {
		t.Fatalf("corrupt temporary Stage passed physical precommit: %+v err=%v", positive, err)
	}
	var count int64
	if err := f.server.DB.Model(&meta.ContentBlob{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("corrupt Stage was made canonical: %d err=%v", count, err)
	}
}

func TestLocalPushRealNativeCASWriteRequiresOwningDeviceAfterPrecommit(t *testing.T) {
	f := makeLocalNativeCanonicalFixture(t)
	positive, err := f.nativePrecommit()
	if err != nil || !positive.NativeMatched {
		t.Fatalf("owning native precommit fixture not accepted: %+v err=%v", positive, err)
	}
	// A valid earlier native/temporary observation must NEVER be a bearer
	// that lets an old JWT, another Desktop, or a revoked device write CAS.
	f.request.Request.Header.Set("X-XDrive-Device-Token", "forged-remote-desktop")
	created, err := f.server.quarantineBoundLocalPushCASPrepareIntent(
		f.request, f.source.ID, f.source.Revision, f.sqlProof, f.stage.StageID,
	)
	if created || err == nil {
		t.Fatalf("earlier native precommit bypassed current Server device check: created=%t err=%v",
			created, err)
	}
	var count int64
	if err := f.server.DB.Model(&meta.LocalPushCASPrepareIntent{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("forged-credential quarantine wrote a durable intent: %d err=%v", count, err)
	}
}
