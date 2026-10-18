package api

import (
	"bytes"
	"context"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// This real two-pool fixture exercises the exact operation UPDATE lock.
// The callback intentionally performs NO file/CAS/SourceRun writes. A future
// writer must preserve this linearization with its actual SQL commit and a
// separate, independently verified native-held original-byte witness.
func TestLocalPushWriterFenceBlocksConcurrentAbortUntilTransactionEnds(t *testing.T) {
	f := makeLocalOperationFixture(t)
	a, b := &Server{DB: f.primary}, &Server{DB: f.replica}
	key := bytes.Repeat([]byte{0x76}, localPushOperationRequestKeySize)
	row, err := a.reserveBoundLocalPushOperationIntentWithKey(
		f.owningRequest(), f.source.ID, f.source.Revision, key)
	if err != nil {
		t.Fatal(err)
	}
	held := make(chan struct{})
	release := make(chan struct{})
	finished := make(chan error, 1)
	go func() {
		finished <- f.primary.Transaction(func(tx *gorm.DB) error {
			if err := a.validateCurrentLocalPushWriterFenceTx(
				tx, f.owningRequest(), f.source.ID, f.source.Revision,
				key, row.ID, row.Generation); err != nil {
				return err
			}
			close(held)
			<-release
			// Recheck the exact original generation and DB clock while the
			// Owner/Device/Source/Root/operation locks are still retained.
			return a.validateCurrentLocalPushWriterFenceTx(
				tx, f.owningRequest(), f.source.ID, f.source.Revision,
				key, row.ID, row.Generation)
		})
	}()
	select {
	case <-held:
	case err := <-finished:
		t.Fatalf("could not obtain first held operation fence: %v", err)
	case <-time.After(10 * time.Second):
		close(release)
		t.Fatal("transaction never acquired owning operation lock")
	}
	// An independent Server attempting abort must not invalidate the
	// operation while the current writer transaction still holds the lock.
	ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer cancel()
	c := f.owningRequest()
	c.Request = c.Request.WithContext(ctx)
	if err := b.abortBoundLocalPushOperationIntent(
		c, f.source.ID, f.source.Revision, row.ID, row.Generation); err == nil {
		close(release)
		t.Fatal("abort crossed operation lock before writer transaction ended")
	}
	close(release)
	select {
	case err := <-finished:
		if err != nil {
			t.Fatalf("held operation fence changed before transaction release: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("operation transaction did not release locks")
	}
	var last meta.LocalPushOperationIntent
	if err := f.replica.Where("id = ?", row.ID).Take(&last).Error; err != nil ||
		last.State != meta.LocalPushOperationIntentReserved || last.AbortedAt != nil {
		t.Fatalf("timed-out concurrent abort changed durable state: %+v %v", last, err)
	}
	if err := b.abortBoundLocalPushOperationIntent(
		f.owningRequest(), f.source.ID, f.source.Revision, row.ID, row.Generation); err != nil {
		t.Fatalf("current owning abort failed after SQL fence release: %v", err)
	}
	if err := a.DB.Transaction(func(tx *gorm.DB) error {
		return a.validateCurrentLocalPushWriterFenceTx(
			tx, f.owningRequest(), f.source.ID, f.source.Revision,
			key, row.ID, row.Generation)
	}); err == nil {
		t.Fatal("committed abort did not fence later operation admission")
	}
	var runs int64
	if err := f.primary.Model(&meta.SyncRun{}).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("fence fixture fabricated a SourceRun: %d %v", runs, err)
	}
}
