package api

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

func TestLocalPushCommonUploadAdmitBindOriginalReceiptTwoPools(t *testing.T) {
	f := makeLocalOperationFixture(t)
	if err := f.primary.AutoMigrate(
		&meta.LocalPushStaging{}, &meta.UploadSession{},
		&meta.LocalPushOperationTerminalReceipt{},
		&meta.LocalPushOperationStageBinding{},
		&meta.LocalPushFirstLeafOperationCommit{},
		&meta.LocalPushNativeTerminalChallenge{},
		&meta.LocalPushCASPrepareIntent{},
		&meta.LocalPushQuotaHold{}, &meta.File{},
		&meta.LocalPushCommonUploadOperation{},
	); err != nil {
		t.Fatal(err)
	}
	a := &Server{DB: f.primary, MaxUploadBytes: 64 << 20}
	b := &Server{DB: f.replica, MaxUploadBytes: 64 << 20}
	hash := strings.Repeat("c", 64)
	req := localPushCommonAdmitRequest{
		OperationID:   uuid.NewString(),
		ResumeKey:     "lp2_" + strings.Repeat("d", 64),
		ContentSHA256: hash,
		Size:          5,
		ParentID:      f.source.TargetNodeID,
		Name:          "first.txt",
	}
	ctx := f.owningRequest()
	original, err := a.admitBoundLocalPushCommonUpload(ctx, f.source.ID, f.source.Revision, req)
	if err != nil || original.State != meta.LocalPushCommonUploadReserved ||
		original.OperationID != req.OperationID || original.OwnerID != f.owner.ID ||
		original.DeviceID != f.device.ID || original.RootID != f.rootID ||
		original.SourceTargetID != *f.source.TargetNodeID {
		t.Fatalf("owning private admission: %+v %v", original, err)
	}
	same, err := b.admitBoundLocalPushCommonUpload(
		f.owningRequest(), f.source.ID, f.source.Revision, req)
	if err != nil || same.OperationID != original.OperationID ||
		same.ResumeKey != original.ResumeKey {
		t.Fatalf("lost admission ACK minted a new operation: %+v %v", same, err)
	}
	foreign := req
	foreign.Size++
	if _, err := a.admitBoundLocalPushCommonUpload(
		f.owningRequest(), f.source.ID, f.source.Revision, foreign); err == nil {
		t.Fatal("same Operation ID accepted changed source bytes")
	}
	foreign = req
	wrongParent := *f.source.TargetNodeID + 1234
	foreign.ParentID = &wrongParent
	if _, err := a.admitBoundLocalPushCommonUpload(
		f.owningRequest(), f.source.ID, f.source.Revision, foreign); err == nil {
		t.Fatal("Source target escaped its owning Root")
	}
	sessionID := uuid.NewString()
	session := meta.UploadSession{
		ID: sessionID, OwnerID: f.owner.ID,
		ParentID: req.ParentID, Name: req.Name,
		ConflictPolicy: meta.UploadConflictPolicyFail,
		TotalSize:      req.Size, ChunkSize: 8 << 20,
		ChunkCount: 1, SHA256: req.ContentSHA256,
		ResumeKey: req.ResumeKey,
		Status:    meta.UploadStatusActive,
		ExpiresAt: time.Now().Add(time.Hour),
	}
	if err := f.primary.Create(&session).Error; err != nil {
		t.Fatal(err)
	}
	bind := localPushCommonBindRequest{
		OperationID:     req.OperationID,
		ResumeKey:       req.ResumeKey,
		UploadSessionID: sessionID,
	}
	bound, err := b.bindBoundLocalPushCommonUpload(
		f.owningRequest(), f.source.ID, f.source.Revision, bind)
	if err != nil || bound.State != meta.LocalPushCommonUploadBound ||
		bound.UploadSessionID == nil || *bound.UploadSessionID != sessionID {
		t.Fatalf("owning common session binding failed: %+v %v", bound, err)
	}
	again, err := a.bindBoundLocalPushCommonUpload(
		f.owningRequest(), f.source.ID, f.source.Revision, bind)
	if err != nil || again.UploadSessionID == nil || *again.UploadSessionID != sessionID {
		t.Fatalf("lost bind ACK changed original session: %+v %v", again, err)
	}
	wrongBind := bind
	wrongBind.UploadSessionID = uuid.NewString()
	if _, err := a.bindBoundLocalPushCommonUpload(
		f.owningRequest(), f.source.ID, f.source.Revision, wrongBind); err == nil {
		t.Fatal("unknown ordinary Session was rebound to original Operation")
	}
	selector := localPushCommonReceiptSelector{
		OperationID: req.OperationID,
		ResumeKey:   req.ResumeKey,
	}
	pending, err := b.readBoundLocalPushCommonUploadOriginal(
		f.owningRequest(), f.source.ID, f.source.Revision, selector)
	if err != nil || pending.State != meta.LocalPushCommonUploadBound ||
		pending.Committed || pending.BackupComplete || pending.RetirementSafe {
		t.Fatalf("unfinalized generic Session claimed full backup: %+v %v", pending, err)
	}
	file := meta.Node{
		OwnerID: f.owner.ID, ParentID: f.source.TargetNodeID,
		Name: req.Name, Type: meta.NodeTypeFile, Revision: 1,
	}
	if err := f.primary.Create(&file).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.primary.Create(&meta.File{
		NodeID: file.ID, Size: req.Size, SHA256: req.ContentSHA256,
		StorageKey: ".xdrive-blobs/sha256/test-fixture",
	}).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if err := f.primary.Transaction(func(tx *gorm.DB) error {
		return persistLocalPushCommonUploadFinalizedTx(tx, session,
			file.ID, req.ContentSHA256, req.Size, now)
	}); err != nil {
		t.Fatalf("bound ordinary finalize failed to record original: %v", err)
	}
	first, err := a.readBoundLocalPushCommonUploadOriginal(
		f.owningRequest(), f.source.ID, f.source.Revision, selector)
	if err != nil || first.State != meta.LocalPushCommonUploadCommitted ||
		!first.Committed || first.NodeID != file.ID ||
		first.NodeRevision != 1 || first.ContentSHA256 != hash ||
		first.BackupComplete || first.RetirementSafe || first.CurrentCASVerified {
		t.Fatalf("immutable original SQL receipt missing: %+v %v", first, err)
	}
	// A later File version cannot rewrite the prior committed checkpoint.
	if err := f.primary.Model(&meta.Node{}).Where("id = ?", file.ID).
		Update("revision", 10).Error; err != nil {
		t.Fatal(err)
	}
	second, err := b.readBoundLocalPushCommonUploadOriginal(
		f.owningRequest(), f.source.ID, f.source.Revision, selector)
	if err != nil || second != first {
		t.Fatalf("original Node/version changed after later edit: %+v vs %+v (%v)",
			second, first, err)
	}
	// Even after the short-lived ordinary UploadSession is deleted, the
	// original Operation result survives for authenticated durable readback.
	if err := f.primary.Where("id = ?", session.ID).
		Delete(&meta.UploadSession{}).Error; err != nil {
		t.Fatal(err)
	}
	if result, err := b.readBoundLocalPushCommonUploadOriginal(
		f.owningRequest(), f.source.ID, f.source.Revision, selector); err != nil ||
		result != first {
		t.Fatalf("24h session cleanup destroyed original history: %+v %v", result, err)
	}
	deny := errors.New("rollback legacy admission simulation")
	err = f.primary.Transaction(func(tx *gorm.DB) error {
		legacy := meta.LocalPushOperationIntent{
			ID: uuid.NewString(), SourceID: f.source.ID, Generation: 1,
			OwnerID: f.owner.ID, OwnerSession: f.owner.SessionVersion,
			SourceRevision: f.source.Revision,
			TargetNodeID:   *f.source.TargetNodeID,
			DeviceID:       f.device.ID, RootID: f.rootID,
			RootFingerprint: f.fingerprint,
			State:           meta.LocalPushOperationIntentReserved,
			IssuedAt:        time.Now(), ExpiresAt: time.Now().Add(time.Minute),
		}
		if err := tx.Create(&legacy).Error; err != nil {
			return err
		}
		withTx := &Server{DB: tx, MaxUploadBytes: 64 << 20}
		next := req
		next.OperationID = uuid.NewString()
		next.ResumeKey = "lp2_" + strings.Repeat("e", 64)
		next.Name = "next.txt"
		if _, err := withTx.admitBoundLocalPushCommonUpload(
			f.owningRequest(), f.source.ID, f.source.Revision, next); err == nil {
			t.Fatal("known legacy Stage/Operation quarantine bypassed")
		}
		return deny
	})
	if !errors.Is(err, deny) {
		t.Fatalf("legacy safety fixture was not rolled back: %v", err)
	}
	// A historical CAS precommit marker must block v2 even if an earlier
	// Stage/Operation reservation was already cleaned separately.
	err = f.primary.Transaction(func(tx *gorm.DB) error {
		marker := meta.LocalPushCASPrepareIntent{
			StageID:  uuid.NewString(),
			SourceID: f.source.ID, OwnerID: f.owner.ID,
			SourceRevision: f.source.Revision, DeviceID: f.device.ID,
			RootID: f.rootID, RootFingerprint: f.fingerprint,
			TargetNodeID:          *f.source.TargetNodeID,
			CurrentSnapshotSHA256: strings.Repeat("d", 64),
			CurrentPathKey:        strings.Repeat("e", 64),
			ContentSHA256:         req.ContentSHA256, TotalSize: req.Size,
			StageExpiresAt: time.Now().Add(time.Hour),
			State:          meta.LocalPushCASPrepareIntentQuarantined,
		}
		if err := tx.Create(&marker).Error; err != nil {
			return err
		}
		next := req
		next.OperationID = uuid.NewString()
		next.ResumeKey = "lp2_" + strings.Repeat("f", 64)
		next.Name = "second.txt"
		if _, err := (&Server{DB: tx, MaxUploadBytes: 64 << 20}).
			admitBoundLocalPushCommonUpload(f.owningRequest(),
				f.source.ID, f.source.Revision, next); err == nil {
			t.Fatal("orphaned legacy CAS precommit marker authorized new v2 upload")
		}
		return deny
	})
	if !errors.Is(err, deny) {
		t.Fatalf("orphaned CAS marker fixture was not rolled back: %v", err)
	}
}

func TestLocalPushCommonUploadRejectsUnauthorizedPrivateAdmission(t *testing.T) {
	f := makeLocalOperationFixture(t)
	if err := f.primary.AutoMigrate(
		&meta.LocalPushStaging{}, &meta.UploadSession{},
		&meta.LocalPushOperationTerminalReceipt{},
		&meta.LocalPushOperationStageBinding{},
		&meta.LocalPushFirstLeafOperationCommit{},
		&meta.LocalPushNativeTerminalChallenge{},
		&meta.LocalPushCASPrepareIntent{},
		&meta.LocalPushQuotaHold{}, &meta.File{},
		&meta.LocalPushCommonUploadOperation{},
	); err != nil {
		t.Fatal(err)
	}
	s := &Server{DB: f.primary, MaxUploadBytes: 64 << 20}
	p := localPushCommonAdmitRequest{
		OperationID:   uuid.NewString(),
		ResumeKey:     "lp2_" + strings.Repeat("a", 64),
		ContentSHA256: strings.Repeat("b", 64),
		Size:          8, ParentID: f.source.TargetNodeID, Name: "safe.bin",
	}
	owner := f.owningRequest()
	owner.Set("userID", f.owner.ID+1)
	if _, err := s.admitBoundLocalPushCommonUpload(
		owner, f.source.ID, f.source.Revision, p); err == nil {
		t.Fatal("foreign Owner admitted local file operation")
	}
	revoked := f.owningRequest()
	now := time.Now()
	if err := f.primary.Model(&meta.ClientDevice{}).
		Where("id = ?", f.device.ID).Update("revoked_at", now).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.admitBoundLocalPushCommonUpload(
		revoked, f.source.ID, f.source.Revision, p); err == nil {
		t.Fatal("revoked device admitted local file operation")
	}
	var count int64
	if err := f.primary.Model(&meta.LocalPushCommonUploadOperation{}).
		Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("unauthorized file operations persisted: %d %v", count, err)
	}
}
