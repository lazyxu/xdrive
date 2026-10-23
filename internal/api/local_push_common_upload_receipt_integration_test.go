package api

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func TestLocalPushCommonOriginalSQLReceiptScopedAndImmutable(t *testing.T) {
	f := makeLocalOperationFixture(t)
	if err := f.primary.AutoMigrate(&meta.LocalPushCommonUploadOperation{}); err != nil {
		t.Fatal(err)
	}
	session := uuid.NewString()
	row := meta.LocalPushCommonUploadOperation{
		OperationID:     uuid.NewString(),
		OwnerID:         f.owner.ID,
		OwnerSession:    f.owner.SessionVersion,
		DeviceID:        f.device.ID,
		RootID:          f.rootID,
		RootFingerprint: f.fingerprint,
		SourceID:        f.source.ID,
		SourceRevision:  f.source.Revision,
		SourceTargetID:  *f.source.TargetNodeID,
		ResumeKey:       "lp2_" + strings.Repeat("a", 64),
		UploadSessionID: &session,
		TargetParentID:  f.source.TargetNodeID,
		TargetName:      "item.txt",
		ContentSHA256:   strings.Repeat("b", 64),
		TotalSize:       13,
		State:           meta.LocalPushCommonUploadBound,
	}
	if err := f.primary.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	selector := localPushCommonReceiptSelector{
		OperationID: row.OperationID, ResumeKey: row.ResumeKey,
	}
	s := &Server{DB: f.replica}
	ctx := f.owningRequest()
	pending, err := s.readBoundLocalPushCommonUploadOriginal(ctx, f.source.ID, f.source.Revision, selector)
	if err != nil || pending.State != meta.LocalPushCommonUploadBound ||
		pending.Committed || pending.NodeID != 0 || pending.BackupComplete ||
		pending.RetirementSafe || pending.CurrentCASVerified {
		t.Fatalf("uncommitted original operation was promoted: %+v %v", pending, err)
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	nodeID := uint64(101)
	if err := f.primary.Model(&meta.LocalPushCommonUploadOperation{}).
		Where("operation_id = ?", row.OperationID).
		Updates(map[string]any{
			"state":                meta.LocalPushCommonUploadCommitted,
			"result_node_id":       nodeID,
			"result_node_revision": uint64(1),
			"committed_at":         now,
		}).Error; err != nil {
		t.Fatal(err)
	}
	first, err := s.readBoundLocalPushCommonUploadOriginal(ctx, f.source.ID, f.source.Revision, selector)
	if err != nil || !first.Committed || first.State != meta.LocalPushCommonUploadCommitted ||
		first.NodeID != nodeID || first.NodeRevision != 1 ||
		first.ContentSHA256 != row.ContentSHA256 || first.Size != row.TotalSize ||
		first.BackupComplete || first.RetirementSafe || first.CurrentCASVerified {
		t.Fatalf("immutable original row not replayed: %+v %v", first, err)
	}
	second, err := s.readBoundLocalPushCommonUploadOriginal(ctx, f.source.ID, f.source.Revision, selector)
	if err != nil || second != first {
		t.Fatalf("original operation read was not idempotent: %+v %+v %v", first, second, err)
	}
	// Unlike the generic /uploads reply, readback does not load a mutable
	// current Node or a short-lived UploadSession at all.
	var oldCount int64
	if err := f.replica.Model(&meta.LocalPushCommonUploadOperation{}).
		Where("operation_id = ?", row.OperationID).Count(&oldCount).Error; err != nil || oldCount != 1 {
		t.Fatalf("original row vanished: %d %v", oldCount, err)
	}
	for _, candidate := range []localPushCommonReceiptSelector{
		{OperationID: uuid.NewString(), ResumeKey: selector.ResumeKey},
		{OperationID: selector.OperationID, ResumeKey: "lp2_" + strings.Repeat("c", 64)},
		{OperationID: selector.OperationID, ResumeKey: "lp2_" + strings.Repeat("A", 64)},
		{OperationID: selector.OperationID, ResumeKey: ""},
	} {
		if _, err := s.readBoundLocalPushCommonUploadOriginal(ctx, f.source.ID, f.source.Revision, candidate); err == nil {
			t.Fatal("foreign or malformed original-operation selector accepted")
		}
	}
	// Each scope mutation is rolled back after verification so the committed
	// record and original data remain intact for a later authorized read.
	stop := errors.New("rollback hostile fixture")
	for name, mutate := range map[string]func(*gorm.DB) error{
		"device revoked": func(tx *gorm.DB) error {
			return tx.Model(&meta.ClientDevice{}).Where("id = ?", f.device.ID).
				Update("revoked_at", now).Error
		},
		"Root switched": func(tx *gorm.DB) error {
			return tx.Model(&meta.LocalSourceBinding{}).Where("source_id = ?", f.source.ID).
				Update("root_fingerprint", strings.Repeat("c", 64)).Error
		},
		"source revision changed": func(tx *gorm.DB) error {
			return tx.Model(&meta.Source{}).Where("id = ?", f.source.ID).
				Update("revision", f.source.Revision+1).Error
		},
		"owner session changed": func(tx *gorm.DB) error {
			return tx.Model(&meta.User{}).Where("id = ?", f.owner.ID).
				Update("session_version", f.owner.SessionVersion+1).Error
		},
	} {
		t.Run(name, func(t *testing.T) {
			err := f.primary.Transaction(func(tx *gorm.DB) error {
				if err := mutate(tx); err != nil {
					return err
				}
				// Read on the same connection, so the hostile transaction's
				// changes are visible without committing them.
				withTx := &Server{DB: tx}
				if _, err := withTx.readBoundLocalPushCommonUploadOriginal(
					f.owningRequest(), f.source.ID, f.source.Revision, selector,
				); err == nil {
					t.Fatal("revoked or changed scope read original terminal")
				}
				return stop
			})
			if !errors.Is(err, stop) {
				t.Fatalf("scope mutation test did not roll back: %v", err)
			}
		})
	}
}

func TestLocalPushCommonReceiptDoesNotBlockOriginalFinalizerLock(t *testing.T) {
	f := makeLocalOperationFixture(t)
	if err := f.primary.AutoMigrate(&meta.LocalPushCommonUploadOperation{}); err != nil {
		t.Fatal(err)
	}
	sessionID := uuid.NewString()
	row := meta.LocalPushCommonUploadOperation{
		OperationID: uuid.NewString(), OwnerID: f.owner.ID,
		OwnerSession: f.owner.SessionVersion, DeviceID: f.device.ID,
		RootID: f.rootID, RootFingerprint: f.fingerprint,
		SourceID: f.source.ID, SourceRevision: f.source.Revision,
		SourceTargetID:  *f.source.TargetNodeID,
		ResumeKey:       "lp2_" + strings.Repeat("a", 64),
		UploadSessionID: &sessionID,
		TargetParentID:  f.source.TargetNodeID,
		TargetName:      "original.bin",
		ContentSHA256:   strings.Repeat("b", 64), TotalSize: 9,
		State: meta.LocalPushCommonUploadBound,
	}
	if err := f.primary.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	// Mimic an unfinished ordinary Finalize: it owns the original Operation
	// UPDATE row lock but has not published a committed terminal yet.
	writer := f.primary.Begin()
	if writer.Error != nil {
		t.Fatal(writer.Error)
	}
	defer writer.Rollback()
	var held meta.LocalPushCommonUploadOperation
	if err := writer.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("operation_id = ?", row.OperationID).Take(&held).Error; err != nil {
		t.Fatal(err)
	}
	readCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	request := f.owningRequest()
	request.Request = request.Request.WithContext(readCtx)
	out, err := (&Server{DB: f.replica}).readBoundLocalPushCommonUploadOriginal(
		request, f.source.ID, f.source.Revision,
		localPushCommonReceiptSelector{
			OperationID: row.OperationID, ResumeKey: row.ResumeKey,
		},
	)
	if err != nil || out.Committed || out.State != meta.LocalPushCommonUploadBound {
		t.Fatalf("read waited on an uncommitted finalizer or forged COMMIT: %+v %v", out, err)
	}
}
