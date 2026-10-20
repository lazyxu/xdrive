package api

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
)

func makeLocalOperationFixture(t *testing.T) localDirectoryChallengeDBFixture {
	t.Helper()
	f := makeLocalDirectoryChallengeDBFixture(t)
	if err := f.primary.AutoMigrate(&meta.LocalPushOperationIntent{}, &meta.LocalPushOperationTerminalReceipt{},
		&meta.LocalPushFirstLeafOperationCommit{}, &meta.LocalPushFileTerminal{}); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := f.replica.Model(&meta.LocalPushOperationIntent{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("migration granted private backup admission: count=%d err=%v", count, err)
	}
	return f
}

func TestLocalPushOperationIntentTwoPoolAdmissionAndAbort(t *testing.T) {
	f := makeLocalOperationFixture(t)
	a, b := &Server{DB: f.primary}, &Server{DB: f.replica}
	var admitted atomic.Int32
	var denied atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			s := a
			if i%2 == 1 {
				s = b
			}
			row, err := s.reserveBoundLocalPushOperationIntent(f.owningRequest(), f.source.ID, f.source.Revision)
			if err == nil && row.ID != "" && row.Generation == 1 {
				admitted.Add(1)
			} else if errors.Is(err, errLocalPushOperationIntentDenied) {
				denied.Add(1)
			}
		}(i)
	}
	wg.Wait()
	if admitted.Load() != 1 || denied.Load() != 15 {
		t.Fatalf("concurrent private reservation not exclusive: admitted=%d denied=%d", admitted.Load(), denied.Load())
	}
	var first meta.LocalPushOperationIntent
	if err := f.replica.Where("source_id = ?", f.source.ID).Take(&first).Error; err != nil ||
		first.OwnerID != f.owner.ID || first.OwnerSession != f.owner.SessionVersion ||
		first.SourceRevision != f.source.Revision || first.TargetNodeID != *f.source.TargetNodeID ||
		first.DeviceID != f.device.ID || first.RootID != f.rootID ||
		first.RootFingerprint != f.fingerprint || first.Generation != 1 ||
		first.State != meta.LocalPushOperationIntentReserved || first.AbortedAt != nil ||
		!first.ExpiresAt.After(first.IssuedAt) {
		t.Fatalf("incorrect owning durable reservation: %+v err=%v", first, err)
	}
	payload, err := json.Marshal(first)
	if err != nil || string(payload) != "{}" {
		t.Fatalf("private admission leaked through JSON: %s err=%v", payload, err)
	}
	if err := b.abortBoundLocalPushOperationIntent(f.owningRequest(), first.SourceID, first.SourceRevision, first.ID, 1); err != nil {
		t.Fatalf("owning private abort failed: %v", err)
	}
	if err := a.abortBoundLocalPushOperationIntent(f.owningRequest(), first.SourceID, first.SourceRevision, first.ID, 1); err != nil {
		t.Fatalf("exact abort replay should be idempotent: %v", err)
	}
	second, err := b.reserveBoundLocalPushOperationIntent(f.owningRequest(), f.source.ID, f.source.Revision)
	if err != nil || second.Generation != 2 || second.ID == first.ID {
		t.Fatalf("new generation after abort unavailable: %+v err=%v", second, err)
	}
	if err := a.abortBoundLocalPushOperationIntent(f.owningRequest(), first.SourceID, first.SourceRevision, first.ID, 1); err == nil {
		t.Fatal("obsolete generation aborted a newer private operation")
	}
	var count int64
	if err := f.primary.Model(&meta.LocalPushOperationIntent{}).Count(&count).Error; err != nil || count != 2 {
		t.Fatalf("durable generation history missing: %d err=%v", count, err)
	}
	var nodes, items, runs int64
	if err := f.replica.Model(&meta.Node{}).Count(&nodes).Error; err != nil || nodes != 1 {
		t.Fatalf("reservation wrote cloud Node: %d err=%v", nodes, err)
	}
	if err := f.replica.Model(&meta.SourceItem{}).Count(&items).Error; err != nil || items != 0 {
		t.Fatalf("reservation created SourceItem: %d err=%v", items, err)
	}
	if err := f.replica.Model(&meta.SyncRun{}).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("reservation invented SourceRun: %d err=%v", runs, err)
	}
}

func TestLocalPushOperationIntentRejectsForeignRevokedAndChangedScope(t *testing.T) {
	for _, scenario := range []string{
		"forged-token", "wrong-owner", "wrong-root", "wrong-device", "revoked", "revision",
		"target", "active", "cancelled",
	} {
		t.Run(scenario, func(t *testing.T) {
			f := makeLocalOperationFixture(t)
			c := f.owningRequest()
			switch scenario {
			case "forged-token":
				c.Request.Header.Set("X-XDrive-Device-Token", "bad-device-token")
			case "wrong-owner":
				c.Set("userID", f.owner.ID+1)
			case "wrong-root":
				c.Request.Header.Set("X-XDrive-Local-Root-Fingerprint", strings.Repeat("b", 64))
			case "wrong-device":
				c.Set(localSourceExecutorContextKey, localSourceExecutorProof{
					DeviceID: uuid.NewString(), RootID: f.rootID, SourceRevision: f.source.Revision,
				})
			case "revoked":
				now := time.Now().UTC()
				if err := f.primary.Model(&meta.ClientDevice{}).Where("id = ?", f.device.ID).Update("revoked_at", &now).Error; err != nil {
					t.Fatal(err)
				}
			case "revision":
				if err := f.primary.Model(&meta.Source{}).Where("id = ?", f.source.ID).Update("revision", f.source.Revision+1).Error; err != nil {
					t.Fatal(err)
				}
			case "target":
				if err := f.primary.Model(&meta.Source{}).Where("id = ?", f.source.ID).Update("target_node_id", nil).Error; err != nil {
					t.Fatal(err)
				}
			case "active":
				if err := f.primary.Model(&meta.Source{}).Where("id = ?", f.source.ID).Update("status", meta.SourceStatusActive).Error; err != nil {
					t.Fatal(err)
				}
			case "cancelled":
				ctx, cancel := context.WithCancel(c.Request.Context())
				cancel()
				c.Request = c.Request.WithContext(ctx)
			}
			if _, err := (&Server{DB: f.replica}).reserveBoundLocalPushOperationIntent(c, f.source.ID, f.source.Revision); err == nil {
				t.Fatalf("%s gained private backup admission", scenario)
			}
			var count int64
			if err := f.primary.Model(&meta.LocalPushOperationIntent{}).Count(&count).Error; err != nil || count != 0 {
				t.Fatalf("%s left unauthorized private intent: %d err=%v", scenario, count, err)
			}
		})
	}
}

func TestLocalPushOperationIntentAbortFencedByCredentialGenerationAndExpiry(t *testing.T) {
	f := makeLocalOperationFixture(t)
	s := &Server{DB: f.primary}
	row, err := s.reserveBoundLocalPushOperationIntent(f.owningRequest(), f.source.ID, f.source.Revision)
	if err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []string{"wrong-token", "wrong-id", "wrong-generation", "wrong-root"} {
		c := f.owningRequest()
		id, generation := row.ID, row.Generation
		switch scenario {
		case "wrong-token":
			c.Request.Header.Set("X-XDrive-Device-Token", "forged-token")
		case "wrong-id":
			id = uuid.NewString()
		case "wrong-generation":
			generation++
		case "wrong-root":
			c.Request.Header.Set("X-XDrive-Local-Root-Fingerprint", strings.Repeat("0", 64))
		}
		if err := (&Server{DB: f.replica}).abortBoundLocalPushOperationIntent(c, f.source.ID, f.source.Revision, id, generation); err == nil {
			t.Fatalf("%s aborted someone else's admission", scenario)
		}
	}
	var current meta.LocalPushOperationIntent
	if err := f.primary.Where("id = ?", row.ID).Take(&current).Error; err != nil ||
		current.State != meta.LocalPushOperationIntentReserved || current.AbortedAt != nil {
		t.Fatalf("unauthorized abort changed reservation: %+v err=%v", current, err)
	}
	if err := f.primary.Model(&meta.LocalPushOperationIntent{}).Where("id = ?", row.ID).
		Update("expires_at", time.Now().UTC().Add(-time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.abortBoundLocalPushOperationIntent(f.owningRequest(), f.source.ID, f.source.Revision, row.ID, row.Generation); err == nil {
		t.Fatal("expired operation permitted abort as though still live")
	}
	newRow, err := (&Server{DB: f.replica}).reserveBoundLocalPushOperationIntent(f.owningRequest(), f.source.ID, f.source.Revision)
	if err != nil || newRow.Generation != 2 {
		t.Fatalf("expired generation did not permit a fresh fenced reservation: %+v err=%v", newRow, err)
	}
	if err := s.abortBoundLocalPushOperationIntent(f.owningRequest(), f.source.ID, f.source.Revision, row.ID, row.Generation); err == nil {
		t.Fatal("old generation escaped into current abort")
	}
}

func TestLocalPushOperationIntentFailsClosedWithoutTrustedInputs(t *testing.T) {
	if _, err := (&Server{}).reserveBoundLocalPushOperationIntent(nil, 1, 1); err == nil {
		t.Fatal("nil server/context reserved a local operation")
	}
	if err := (&Server{}).abortBoundLocalPushOperationIntent(nil, 1, 1, uuid.NewString(), 1); err == nil {
		t.Fatal("nil server/context aborted a local operation")
	}
}
