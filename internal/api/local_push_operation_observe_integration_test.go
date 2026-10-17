package api

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestLocalPushOperationObserveTwoPoolLostResponseAndGenerations(t *testing.T) {
	f := makeLocalOperationFixture(t)
	a, b := &Server{DB: f.primary}, &Server{DB: f.replica}
	first, err := a.reserveBoundLocalPushOperationIntent(f.owningRequest(), f.source.ID, f.source.Revision)
	if err != nil {
		t.Fatal(err)
	}
	observed, err := b.observeBoundLocalPushOperationIntent(f.owningRequest(), f.source.ID, f.source.Revision, first.ID, first.Generation)
	if err != nil || observed.state != meta.LocalPushOperationIntentReserved || observed.generation != 1 {
		t.Fatalf("lost-response observation did not find current reserved operation: %+v err=%v", observed, err)
	}
	encoded, err := json.Marshal(observed)
	if err != nil || string(encoded) != "{}" {
		t.Fatalf("private observation leaked into JSON: %s err=%v", encoded, err)
	}
	if err := b.abortBoundLocalPushOperationIntent(f.owningRequest(), f.source.ID, f.source.Revision, first.ID, first.Generation); err != nil {
		t.Fatal(err)
	}
	observed, err = a.observeBoundLocalPushOperationIntent(f.owningRequest(), f.source.ID, f.source.Revision, first.ID, first.Generation)
	if err != nil || observed.state != meta.LocalPushOperationIntentAborted {
		t.Fatalf("missing durable abort observation: %+v err=%v", observed, err)
	}
	second, err := b.reserveBoundLocalPushOperationIntent(f.owningRequest(), f.source.ID, f.source.Revision)
	if err != nil || second.Generation != 2 {
		t.Fatalf("second generation failed: %+v err=%v", second, err)
	}
	if _, err := a.observeBoundLocalPushOperationIntent(f.owningRequest(), f.source.ID, f.source.Revision, first.ID, first.Generation); err == nil {
		t.Fatal("superseded generation exposed an obsolete operation")
	}
	// Move BOTH timestamps using one PostgreSQL transaction clock. Changing
	// only expires_at would put it before issued_at and correctly trigger the
	// production fail-closed invariant instead of testing a valid expired lease.
	expired := f.primary.Exec(`
		UPDATE xd_local_push_operation_intents
		SET issued_at = CURRENT_TIMESTAMP - INTERVAL '31 seconds',
		    expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second'
		WHERE id = ?
	`, second.ID)
	if expired.Error != nil || expired.RowsAffected != 1 {
		t.Fatalf("could not construct a valid expired reservation: rows=%d err=%v", expired.RowsAffected, expired.Error)
	}
	observed, err = a.observeBoundLocalPushOperationIntent(f.owningRequest(), f.source.ID, f.source.Revision, second.ID, second.Generation)
	if err != nil || observed.state != localPushOperationIntentObservedExpired || observed.generation != 2 {
		t.Fatalf("expired reservation was not safely observed: %+v err=%v", observed, err)
	}
	third, err := a.reserveBoundLocalPushOperationIntent(f.owningRequest(), f.source.ID, f.source.Revision)
	if err != nil || third.Generation != 3 {
		t.Fatalf("expired generation could not be safely superseded: %+v err=%v", third, err)
	}
	if _, err := b.observeBoundLocalPushOperationIntent(f.owningRequest(), f.source.ID, f.source.Revision, second.ID, second.Generation); err == nil {
		t.Fatal("old expired generation was accepted after replacement")
	}
	var nodes, items, runs int64
	if err := f.primary.Model(&meta.Node{}).Count(&nodes).Error; err != nil || nodes != 1 {
		t.Fatalf("observation modified cloud Nodes: %d err=%v", nodes, err)
	}
	if err := f.primary.Model(&meta.SourceItem{}).Count(&items).Error; err != nil || items != 0 {
		t.Fatalf("observation wrote SourceItems: %d err=%v", items, err)
	}
	if err := f.primary.Model(&meta.SyncRun{}).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("observation started SourceRuns: %d err=%v", runs, err)
	}
}

func TestLocalPushOperationObserveRequiresCurrentOwningScope(t *testing.T) {
	for _, scenario := range []string{
		"forged-token", "foreign-owner", "wrong-root", "wrong-device", "revoked-device",
		"rotated-session", "new-source-revision", "changed-target", "cancelled", "wrong-id",
		"wrong-generation", "malformed-id", "invalid-state", "invalid-clock",
	} {
		t.Run(scenario, func(t *testing.T) {
			f := makeLocalOperationFixture(t)
			s := &Server{DB: f.primary}
			row, err := s.reserveBoundLocalPushOperationIntent(f.owningRequest(), f.source.ID, f.source.Revision)
			if err != nil {
				t.Fatal(err)
			}
			c := f.owningRequest()
			id, generation := row.ID, row.Generation
			switch scenario {
			case "forged-token":
				c.Request.Header.Set("X-XDrive-Device-Token", "forged-token")
			case "foreign-owner":
				c.Set("userID", f.owner.ID+1)
			case "wrong-root":
				c.Request.Header.Set("X-XDrive-Local-Root-Fingerprint", strings.Repeat("a", 64))
				if f.fingerprint == strings.Repeat("a", 64) {
					c.Request.Header.Set("X-XDrive-Local-Root-Fingerprint", strings.Repeat("b", 64))
				}
			case "wrong-device":
				c.Set(localSourceExecutorContextKey, localSourceExecutorProof{
					DeviceID: uuid.NewString(), RootID: f.rootID, SourceRevision: f.source.Revision,
				})
			case "revoked-device":
				now := time.Now().UTC()
				if err := f.primary.Model(&meta.ClientDevice{}).Where("id = ?", f.device.ID).Update("revoked_at", &now).Error; err != nil {
					t.Fatal(err)
				}
			case "rotated-session":
				if err := f.primary.Model(&meta.User{}).Where("id = ?", f.owner.ID).
					Update("session_version", f.owner.SessionVersion+1).Error; err != nil {
					t.Fatal(err)
				}
			case "new-source-revision":
				if err := f.primary.Model(&meta.Source{}).Where("id = ?", f.source.ID).
					Update("revision", f.source.Revision+1).Error; err != nil {
					t.Fatal(err)
				}
			case "changed-target":
				if err := f.primary.Model(&meta.Source{}).Where("id = ?", f.source.ID).
					Update("target_node_id", nil).Error; err != nil {
					t.Fatal(err)
				}
			case "cancelled":
				ctx, cancel := context.WithCancel(c.Request.Context())
				cancel()
				c.Request = c.Request.WithContext(ctx)
			case "wrong-id":
				id = uuid.NewString()
			case "wrong-generation":
				generation++
			case "malformed-id":
				id = "not-a-uuid"
			case "invalid-clock":
				if err := f.primary.Model(&meta.LocalPushOperationIntent{}).Where("id = ?", row.ID).
					Update("issued_at", time.Now().UTC().Add(time.Minute)).Error; err != nil {
					t.Fatal(err)
				}
			case "invalid-state":
				if err := f.primary.Model(&meta.LocalPushOperationIntent{}).Where("id = ?", row.ID).
					Update("state", "unknown-state").Error; err != nil {
					t.Fatal(err)
				}
			}
			if got, err := (&Server{DB: f.replica}).observeBoundLocalPushOperationIntent(c, f.source.ID, f.source.Revision, id, generation); err == nil || got != (localPushOperationIntentObservation{}) {
				t.Fatalf("%s observed foreign or invalid operation: %+v err=%v", scenario, got, err)
			}
		})
	}
}

func TestLocalPushOperationObserveFailsClosedWithoutInputs(t *testing.T) {
	if observed, err := (&Server{}).observeBoundLocalPushOperationIntent(nil, 1, 1, uuid.NewString(), 1); err == nil || observed != (localPushOperationIntentObservation{}) {
		t.Fatal("nil Server/Context gained private observation")
	}
	if observed, err := (&Server{}).observeBoundLocalPushOperationIntent(nil, 0, 0, "", 0); err == nil || observed != (localPushOperationIntentObservation{}) {
		t.Fatal("invalid input gained private observation")
	}
}
