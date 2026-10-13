package api

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
)

func TestLocalQuarantinedSameDirectoryDestinationRequiresLiveCloudLayout(t *testing.T) {
	db, server, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(
		&meta.ClientDevice{}, &meta.LocalSourceBinding{}, &meta.SourceItemAlias{},
		&meta.FileVersion{}, &meta.ContentBlob{}, &meta.LocalSourceItemEvidence{},
		&meta.LocalSourceCommitIntent{}, &meta.SyncRun{},
	); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	secret := "local-same-dir-owning-agent-test-long-secret"
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "Owner A",
		Platform: "linux", CredentialHash: deviceCredentialDigest(secret),
		CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	rootID := uuid.NewString()
	fingerprint := strings.Repeat("a", 64)
	target := createFilePropertiesDir(t, db, owner.ID, root.ID, "Local backups")
	directory := createFilePropertiesDir(t, db, owner.ID, target.ID, "photos")
	node := createFilePropertiesFile(t, db, owner.ID, directory.ID, "one.jpg", 3)
	source := meta.Source{
		OwnerID: owner.ID, Name: "Same-parent test", Kind: meta.SourceKindLocalFolder,
		Direction: meta.SourceDirectionPush, Status: meta.SourceStatusPaused,
		Revision: 7, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, TargetNodeID: &target.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.LocalSourceBinding{
		SourceID: source.ID, OwnerID: owner.ID, DeviceID: device.ID,
		RootID: rootID, RootFingerprint: fingerprint,
		CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	pathKey := func(relative string) string {
		sum := sha256.Sum256([]byte("xdrive-local-path-v1\x00" + rootID + "\x00file\x00" + relative))
		return hex.EncodeToString(sum[:])
	}
	casSHABytes := sha256.Sum256([]byte("abc"))
	casSHA := hex.EncodeToString(casSHABytes[:])
	casKey, err := storage.ContentAddressedKey(casSHA)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.File{}).Where("node_id = ?", node.ID).
		Updates(map[string]any{"sha256": casSHA, "storage_key": casKey}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.FileVersion{
		NodeID: node.ID, Revision: node.Revision,
		SHA256: casSHA, StorageKey: casKey, Size: 3, CreatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.ContentBlob{
		SHA256: casSHA, StorageKey: casKey, Size: 3,
		State: meta.ContentBlobStateReady, RefCount: 1,
		CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	item := meta.SourceItem{
		SourceID: source.ID, ExternalID: pathKey("photos/one.jpg"),
		NodeID: &node.ID, NodeRevision: node.Revision,
		Kind: meta.SourceItemKindFile, State: meta.SourceItemStateSynced,
		Path: "photos/one.jpg", Size: 3, SHA256: casSHA, LastSeenAt: now,
	}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}
	evidence := meta.LocalSourceItemEvidence{
		SourceID: source.ID, SourceRevision: source.Revision, SourceItemID: item.ID,
		DeviceID: device.ID, RootID: rootID, RootFingerprint: fingerprint,
		PreviousSnapshotSHA256: strings.Repeat("1", 64),
		CurrentSnapshotSHA256:  strings.Repeat("2", 64),
		PreviousPathKey:        item.ExternalID, CurrentPathKey: pathKey("photos/two.jpg"),
		NativeIdentityKey: strings.Repeat("3", 64),
		CreatedAt:         now, UpdatedAt: now,
	}
	if err := db.Create(&evidence).Error; err != nil {
		t.Fatal(err)
	}
	intent := meta.LocalSourceCommitIntent{
		SourceID: source.ID, SourceRevision: source.Revision, EvidenceID: evidence.ID,
		SourceItemID: item.ID, DeviceID: device.ID, RootID: rootID,
		RootFingerprint:        fingerprint,
		PreviousSnapshotSHA256: evidence.PreviousSnapshotSHA256,
		CurrentSnapshotSHA256:  evidence.CurrentSnapshotSHA256,
		PreviousPathKey:        evidence.PreviousPathKey,
		CurrentPathKey:         evidence.CurrentPathKey,
		NativeIdentityKey:      evidence.NativeIdentityKey,
		State:                  meta.LocalSourceCommitIntentStateQuarantined,
		CreatedAt:              now, UpdatedAt: now,
	}
	if err := db.Create(&intent).Error; err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/private/local-same-parent-precommit", nil)
	c.Request.Header.Set("X-XDrive-Device-ID", device.ID)
	c.Request.Header.Set("X-XDrive-Device-Token", secret)
	c.Request.Header.Set("X-XDrive-Local-Root-ID", rootID)
	c.Request.Header.Set("X-XDrive-Local-Root-Fingerprint", fingerprint)
	c.Set("userID", owner.ID)
	proof := localSourceExecutorProof{
		DeviceID: device.ID, RootID: rootID, SourceRevision: source.Revision,
	}
	c.Set(localSourceExecutorContextKey, proof)
	metadata := localEvidenceCloudMetadataRequest{
		PreviousSnapshotSHA256: evidence.PreviousSnapshotSHA256,
		CurrentSnapshotSHA256:  evidence.CurrentSnapshotSHA256,
		Items: []localEvidenceCloudMetadataItem{
			{EvidenceID: evidence.ID, SHA256: casSHA, Size: 3},
		},
	}
	current := []localQuarantinedCurrentPathClaim{
		{EvidenceID: evidence.ID, CurrentRelativePath: "photos/two.jpg"},
	}
	inspect := func(claims []localQuarantinedCurrentPathClaim) error {
		t.Helper()
		return db.Transaction(func(tx *gorm.DB) error {
			snapshot, err := server.checkLocalQuarantinedSameDirectoryTargetTx(
				tx, c, source.ID, source.Revision, proof, metadata, claims)
			if err != nil {
				return err
			}
			if snapshot.revision != source.Revision || len(snapshot.objects) != 1 ||
				snapshot.objects[0].SHA256 != casSHA {
				return errLocalEvidenceConflict
			}
			return nil
		})
	}
	if err := inspect(current); err != nil {
		t.Fatalf("same-directory owning Agent cloud layout rejected: %v", err)
	}
	// An occupied name cannot be silently overwritten, even when case differs.
	sibling := meta.Node{
		OwnerID: owner.ID, ParentID: &directory.ID, Name: "TWO.jpg",
		Type: meta.NodeTypeFile, Revision: 1,
	}
	if err := db.Create(&sibling).Error; err != nil {
		t.Fatal(err)
	}
	if err := inspect(current); !errors.Is(err, errLocalEvidenceConflict) {
		t.Fatalf("destination sibling collision admitted: %v", err)
	}
	if err := db.Delete(&sibling).Error; err != nil {
		t.Fatal(err)
	}
	// The cloud Node, unlike the persisted advisory path key, may have
	// been moved or renamed by an independent authorized operation.
	if err := db.Model(&meta.Node{}).Where("id = ?", node.ID).
		Update("name", "drift.jpg").Error; err != nil {
		t.Fatal(err)
	}
	if err := inspect(current); !errors.Is(err, errLocalEvidenceConflict) {
		t.Fatalf("stale SourceItem path accepted after cloud Node rename: %v", err)
	}
	if err := db.Model(&meta.Node{}).Where("id = ?", node.ID).
		Update("name", "one.jpg").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.Node{}).Where("id = ?", directory.ID).
		Update("parent_id", root.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := inspect(current); !errors.Is(err, errLocalEvidenceConflict) {
		t.Fatalf("file moved outside target was accepted: %v", err)
	}
	if err := db.Model(&meta.Node{}).Where("id = ?", directory.ID).
		Update("parent_id", target.ID).Error; err != nil {
		t.Fatal(err)
	}
	// Rebind BOTH stored rows to a different, well-formed CURRENT path to
	// test the same-parent restriction rather than just hash mismatch.
	crossPathKey := pathKey("other/two.jpg")
	for _, model := range []any{&meta.LocalSourceItemEvidence{}, &meta.LocalSourceCommitIntent{}} {
		if err := db.Model(model).Where("source_id = ?", source.ID).
			Update("current_path_key", crossPathKey).Error; err != nil {
			t.Fatal(err)
		}
	}
	cross := []localQuarantinedCurrentPathClaim{
		{EvidenceID: evidence.ID, CurrentRelativePath: "other/two.jpg"},
	}
	if err := inspect(cross); !errors.Is(err, errLocalEvidenceConflict) {
		t.Fatalf("cross-directory move admitted to same-parent precommit: %v", err)
	}
	for _, model := range []any{&meta.LocalSourceItemEvidence{}, &meta.LocalSourceCommitIntent{}} {
		if err := db.Model(model).Where("source_id = ?", source.ID).
			Update("current_path_key", evidence.CurrentPathKey).Error; err != nil {
			t.Fatal(err)
		}
	}
	// Same account is not enough: an absent proof, forged credential, or
	// revoked owning device must not pass even this read-only precommit.
	c.Set(localSourceExecutorContextKey, localSourceExecutorProof{})
	if err := inspect(current); !errors.Is(err, errLocalSourceExecutorTransactionUnauthorized) {
		t.Fatalf("owner-only path check gained device authority: %v", err)
	}
	c.Set(localSourceExecutorContextKey, proof)
	c.Request.Header.Set("X-XDrive-Device-Token", "foreign-token")
	if err := inspect(current); !errors.Is(err, errLocalSourceExecutorTransactionUnauthorized) {
		t.Fatalf("forged owning credential admitted: %v", err)
	}
	c.Request.Header.Set("X-XDrive-Device-Token", secret)
	if err := db.Model(&meta.ClientDevice{}).Where("id = ?", device.ID).
		Update("revoked_at", now).Error; err != nil {
		t.Fatal(err)
	}
	if err := inspect(current); !errors.Is(err, errLocalSourceExecutorTransactionUnauthorized) {
		t.Fatalf("revoked Agent admitted to future identity operation: %v", err)
	}
	// Every call above was read-only. No SourceItem, Node, alias or CAS
	// reference can be changed by a successful precommit inspection.
	var unchanged meta.SourceItem
	if err := db.Where("id = ?", item.ID).Take(&unchanged).Error; err != nil ||
		unchanged.Path != item.Path || unchanged.ExternalID != item.ExternalID ||
		unchanged.NodeRevision != item.NodeRevision {
		t.Fatalf("precommit mutated authoritative SourceItem: %+v %v", unchanged, err)
	}
	var cloud meta.Node
	if err := db.Where("id = ?", node.ID).Take(&cloud).Error; err != nil ||
		cloud.Name != "one.jpg" || cloud.Revision != node.Revision {
		t.Fatalf("precommit changed cloud Node: %+v %v", cloud, err)
	}
	var blob meta.ContentBlob
	if err := db.Where("sha256 = ?", casSHA).Take(&blob).Error; err != nil ||
		blob.RefCount != 1 || blob.State != meta.ContentBlobStateReady {
		t.Fatalf("precommit changed CAS reference: %+v %v", blob, err)
	}
	for _, model := range []any{&meta.SourceItemAlias{}, &meta.SyncRun{}} {
		var count int64
		if err := db.Model(model).Where("source_id = ?", source.ID).
			Count(&count).Error; err != nil || count != 0 {
			t.Fatalf("precommit wrote aliases or source runs: count=%d err=%v", count, err)
		}
	}
}
