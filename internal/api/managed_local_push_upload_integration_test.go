package api

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestManagedLocalPushUploadRequiresDurableDeviceOperation(t *testing.T) {
	db, _, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(
		&meta.ClientDevice{}, &meta.LocalSourceBinding{},
		&meta.LocalPushCommonUploadOperation{}, &meta.UploadSession{},
	); err != nil {
		t.Fatal(err)
	}
	managed := createFilePropertiesDir(t, db, owner.ID, root.ID, "verified-local-backup")
	ordinary := createFilePropertiesDir(t, db, owner.ID, root.ID, "ordinary")
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID,
		Name: "Desktop", Platform: "windows",
		CredentialHash: strings.Repeat("a", 64),
		CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID: owner.ID, Name: "photos",
		Kind: meta.SourceKindLocalFolder, Direction: meta.SourceDirectionPush,
		SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeSync,
		Status: meta.SourceStatusPaused, Revision: 1, TargetNodeID: &managed.ID,
		TargetManaged: true, LocalCreatorDeviceID: &device.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	rootID := uuid.NewString()
	fingerprint := strings.Repeat("b", 64)
	binding := meta.LocalSourceBinding{
		SourceID: source.ID, OwnerID: owner.ID,
		DeviceID: device.ID, RootID: rootID, RootFingerprint: fingerprint,
		CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	if err := db.Create(&binding).Error; err != nil {
		t.Fatal(err)
	}
	resumeKey := "lp2_" + strings.Repeat("c", 64)
	sha := strings.Repeat("d", 64)
	op := meta.LocalPushCommonUploadOperation{
		OperationID: uuid.NewString(), OwnerID: owner.ID,
		OwnerSession: owner.SessionVersion, DeviceID: device.ID,
		RootID: rootID, RootFingerprint: fingerprint,
		SourceID: source.ID, SourceRevision: source.Revision,
		SourceTargetID: managed.ID, ResumeKey: resumeKey,
		TargetParentID: &managed.ID, TargetName: "image.jpg",
		ContentSHA256: sha, TotalSize: 32,
		State: meta.LocalPushCommonUploadReserved,
	}
	if err := db.Create(&op).Error; err != nil {
		t.Fatal(err)
	}
	req := uploadInitRequest{
		ParentID: &managed.ID, Name: op.TargetName,
		Size: op.TotalSize, SHA256: sha,
		ResumeKey: resumeKey, ConflictPolicy: meta.UploadConflictPolicyFail,
	}
	ctx := context.Background()
	allow := func(input uploadInitRequest, nodeID uint64, accepted bool) {
		t.Helper()
		err := requireOrdinaryOrAdmittedLocalPushTargetTx(ctx, db, owner.ID, nodeID, input)
		if accepted && err != nil {
			t.Fatalf("authenticated local Push operation was blocked: %v", err)
		}
		if !accepted && !errors.Is(err, errManagedSourceWriteDenied) {
			t.Fatalf("managed target admitted an unauthorized request: err=%v req=%+v", err, input)
		}
	}
	allow(req, managed.ID, true)
	allow(req, ordinary.ID, true) // Ordinary Files destinations are independent.

	badKey := req
	badKey.ResumeKey = "lp2_" + strings.Repeat("e", 64)
	allow(badKey, managed.ID, false)
	badName := req
	badName.Name = "other.jpg"
	allow(badName, managed.ID, false)
	badHash := req
	badHash.SHA256 = strings.Repeat("e", 64)
	allow(badHash, managed.ID, false)
	badParent := req
	badParent.ParentID = &ordinary.ID
	// A forged lp2 selector does not grant writes to an unrelated managed
	// root, even when an ordinary Owner directory can still be written.
	allow(badParent, managed.ID, false)
	noPrefix := req
	noPrefix.ResumeKey = ""
	allow(noPrefix, managed.ID, false)

	session := meta.UploadSession{
		ID: uuid.NewString(), OwnerID: owner.ID, ParentID: &managed.ID,
		Name: op.TargetName, RequestedName: op.TargetName,
		ConflictPolicy: meta.UploadConflictPolicyFail,
		ResumeKey: resumeKey, TotalSize: op.TotalSize,
		SHA256: sha, ChunkSize: 4 << 20, ChunkCount: 1,
		Status: meta.UploadStatusActive, ExpiresAt: time.Now().UTC().Add(time.Hour),
	}
	if err := db.Create(&session).Error; err != nil {
		t.Fatal(err)
	}
	if err := requireOrdinaryOrBoundLocalPushFinalizeTx(
		ctx, db, session, managed.ID); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("unbound upload could finalize into protected directory: %v", err)
	}

	if err := db.Model(&meta.LocalPushCommonUploadOperation{}).
		Where("operation_id = ?", op.OperationID).
		Updates(map[string]any{
			"state": meta.LocalPushCommonUploadBound,
			"upload_session_id": session.ID,
		}).Error; err != nil {
		t.Fatal(err)
	}
	if err := requireOrdinaryOrBoundLocalPushFinalizeTx(
		ctx, db, session, managed.ID); err != nil {
		t.Fatalf("device-bound upload was rejected: %v", err)
	}
	guest := session
	shareID := uint64(77)
	guest.ShareID = &shareID
	if err := requireOrdinaryOrBoundLocalPushFinalizeTx(
		ctx, db, guest, managed.ID); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("guest share escalated to local Push: %v", err)
	}
	staleSession := session
	staleSession.ID = uuid.NewString()
	if err := requireOrdinaryOrBoundLocalPushFinalizeTx(
		ctx, db, staleSession, managed.ID); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("different upload session claimed private binding: %v", err)
	}

	revoked := time.Now().UTC()
	if err := db.Model(&meta.ClientDevice{}).Where("id = ?", device.ID).
		Update("revoked_at", revoked).Error; err != nil {
		t.Fatal(err)
	}
	allow(req, managed.ID, false)
	if err := requireOrdinaryOrBoundLocalPushFinalizeTx(
		ctx, db, session, managed.ID); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("revoked device kept managed finalize authority: %v", err)
	}
}
