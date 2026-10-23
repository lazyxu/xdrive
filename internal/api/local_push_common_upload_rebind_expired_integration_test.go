package api

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

func TestLocalPushCommonExpiredGenericSessionRebindKeepsOriginalOperation(t *testing.T) {
	f := makeLocalOperationFixture(t)
	if err := f.primary.AutoMigrate(
		&meta.LocalPushStaging{}, &meta.UploadSession{}, &meta.File{},
		&meta.LocalPushOperationTerminalReceipt{}, &meta.LocalPushOperationStageBinding{},
		&meta.LocalPushFirstLeafOperationCommit{}, &meta.LocalPushNativeTerminalChallenge{},
		&meta.LocalPushCASPrepareIntent{}, &meta.LocalPushQuotaHold{},
		&meta.LocalPushCommonUploadOperation{},
	); err != nil {
		t.Fatal(err)
	}
	a := &Server{DB: f.primary, MaxUploadBytes: 128 << 20}
	b := &Server{DB: f.replica, MaxUploadBytes: 128 << 20}
	req := localPushCommonAdmitRequest{
		OperationID: uuid.NewString(), ResumeKey: "lp2_" + strings.Repeat("c", 64),
		ContentSHA256: strings.Repeat("d", 64), Size: 9,
		ParentID: f.source.TargetNodeID, Name: "original-resume.bin",
	}
	original, err := a.admitBoundLocalPushCommonUpload(
		f.owningRequest(), f.source.ID, f.source.Revision, req)
	if err != nil || original.State != meta.LocalPushCommonUploadReserved {
		t.Fatalf("original durable admission unavailable: %+v %v", original, err)
	}
	makeSession := func() meta.UploadSession {
		return meta.UploadSession{
			ID: uuid.NewString(), OwnerID: f.owner.ID,
			ParentID: req.ParentID, Name: req.Name,
			ConflictPolicy: meta.UploadConflictPolicyFail,
			TotalSize:      req.Size, ChunkSize: 8 << 20, ChunkCount: 1,
			SHA256: req.ContentSHA256, ResumeKey: req.ResumeKey,
			Status: meta.UploadStatusActive, ExpiresAt: time.Now().Add(time.Hour),
		}
	}
	old := makeSession()
	newSession := makeSession()
	if err := f.primary.Create(&old).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.primary.Create(&newSession).Error; err != nil {
		t.Fatal(err)
	}
	oldBind := localPushCommonBindRequest{
		OperationID: req.OperationID, ResumeKey: req.ResumeKey, UploadSessionID: old.ID,
	}
	freshBind := oldBind
	freshBind.UploadSessionID = newSession.ID
	first, err := a.bindBoundLocalPushCommonUpload(
		f.owningRequest(), f.source.ID, f.source.Revision, oldBind)
	if err != nil || first.UploadSessionID == nil || *first.UploadSessionID != old.ID {
		t.Fatalf("initial original binding: %+v %v", first, err)
	}
	// An old still-active Session can finalize. Creating a second Session
	// with the same resume key MUST NOT steal the committed-bound identity.
	if _, err := b.bindBoundLocalPushCommonUpload(
		f.owningRequest(), f.source.ID, f.source.Revision, freshBind); err == nil {
		t.Fatal("active original Session was replaced")
	}
	if err := f.primary.Model(&meta.UploadSession{}).Where("id = ?", old.ID).
		Update("expires_at", time.Now().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	second, err := b.bindBoundLocalPushCommonUpload(
		f.owningRequest(), f.source.ID, f.source.Revision, freshBind)
	if err != nil || second.State != meta.LocalPushCommonUploadBound ||
		second.OperationID != first.OperationID ||
		second.UploadSessionID == nil || *second.UploadSessionID != newSession.ID {
		t.Fatalf("expired Session was not safely rebound to SAME Operation: %+v %v", second, err)
	}
	if _, err := a.bindBoundLocalPushCommonUpload(
		f.owningRequest(), f.source.ID, f.source.Revision, oldBind); err == nil {
		t.Fatal("old expired Session obtained its original binding again")
	}
	unchanged, err := a.bindBoundLocalPushCommonUpload(
		f.owningRequest(), f.source.ID, f.source.Revision, freshBind)
	if err != nil || unchanged.UploadSessionID == nil ||
		*unchanged.UploadSessionID != newSession.ID {
		t.Fatalf("new Session binding not idempotent: %+v %v", unchanged, err)
	}
	node := meta.Node{
		OwnerID: f.owner.ID, ParentID: f.source.TargetNodeID,
		Name: req.Name, Type: meta.NodeTypeFile, Revision: 1,
	}
	if err := f.primary.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.primary.Create(&meta.File{
		NodeID: node.ID, Size: req.Size, SHA256: req.ContentSHA256,
		StorageKey: ".xdrive-blobs/sha256/non-production-rebind",
	}).Error; err != nil {
		t.Fatal(err)
	}
	err = f.primary.Transaction(func(tx *gorm.DB) error {
		return persistLocalPushCommonUploadFinalizedTx(
			tx, old, node.ID, req.ContentSHA256, req.Size, time.Now().UTC())
	})
	if err == nil {
		t.Fatal("expired, unbound original Session finalized after rebind")
	}
	if err := f.primary.Transaction(func(tx *gorm.DB) error {
		return persistLocalPushCommonUploadFinalizedTx(
			tx, newSession, node.ID, req.ContentSHA256, req.Size, time.Now().UTC())
	}); err != nil {
		t.Fatalf("new generic Session failed SQL COMMIT: %v", err)
	}
	got, err := b.readBoundLocalPushCommonUploadOriginal(f.owningRequest(),
		f.source.ID, f.source.Revision,
		localPushCommonReceiptSelector{OperationID: req.OperationID, ResumeKey: req.ResumeKey})
	if err != nil || !got.Committed || got.NodeID != node.ID ||
		got.OperationID != req.OperationID || got.Size != req.Size ||
		got.BackupComplete || got.CurrentCASVerified || got.RetirementSafe {
		t.Fatalf("rebind invented whole backup result: %+v %v", got, err)
	}
	var count int64
	if err := f.primary.Model(&meta.LocalPushCommonUploadOperation{}).
		Where("operation_id = ?", req.OperationID).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("original operation duplicated after Session rotation: %d %v", count, err)
	}
}
