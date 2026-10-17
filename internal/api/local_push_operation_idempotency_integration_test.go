package api

import (
	"bytes"
	"encoding/json"
	"sync"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestLocalPushKeyedAdmissionTwoPoolLostReplyAndABA(t *testing.T) {
	f := makeLocalOperationFixture(t)
	a, b := &Server{DB: f.primary}, &Server{DB: f.replica}
	// Deterministic bytes are test fixtures. A real native Agent must create
	// a NEW OS-CSPRNG request key for each distinct operation.
	key := bytes.Repeat([]byte{0x41}, localPushOperationRequestKeySize)
	first, err := a.reserveBoundLocalPushOperationIntentWithKey(f.owningRequest(), f.source.ID, f.source.Revision, key)
	if err != nil || first.Generation != 1 || first.ID == "" {
		t.Fatalf("initial keyed admission failed: %+v err=%v", first, err)
	}
	digest, ok := localPushOperationRequestKeyDigest(key)
	if !ok || first.RequestKeyDigest == nil || *first.RequestKeyDigest != digest {
		t.Fatalf("missing private domain-separated request digest: %+v", first)
	}
	wire, err := json.Marshal(first)
	if err != nil || string(wire) != "{}" {
		t.Fatalf("private request key/intent leaked: %s err=%v", wire, err)
	}
	if !f.primary.Migrator().HasIndex(&meta.LocalPushOperationIntent{}, "idx_xd_local_push_op_request") {
		t.Fatal("unique per-Source request digest index absent")
	}
	replay, err := b.reserveBoundLocalPushOperationIntentWithKey(f.owningRequest(), f.source.ID, f.source.Revision, key)
	if err != nil || replay.ID != first.ID || replay.Generation != first.Generation {
		t.Fatalf("lost-response request was not replayed: %+v err=%v", replay, err)
	}

	// Concurrent retries on two separate PostgreSQL pools must agree on one
	// operation UUID; a replay must never mint a fresh generation.
	type result struct {
		id         string
		generation uint64
		err        error
	}
	var wg sync.WaitGroup
	results := make(chan result, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			server := a
			if i%2 != 0 {
				server = b
			}
			row, err := server.reserveBoundLocalPushOperationIntentWithKey(f.owningRequest(), f.source.ID, f.source.Revision, key)
			results <- result{id: row.ID, generation: row.Generation, err: err}
		}(i)
	}
	wg.Wait()
	close(results)
	for got := range results {
		if got.err != nil || got.id != first.ID || got.generation != first.Generation {
			t.Fatalf("parallel replay yielded another operation: %+v", got)
		}
	}

	nextKey := bytes.Repeat([]byte{0x42}, localPushOperationRequestKeySize)
	if _, err := b.reserveBoundLocalPushOperationIntentWithKey(f.owningRequest(), f.source.ID, f.source.Revision, nextKey); err == nil {
		t.Fatal("different request key preempted live operation")
	}
	if err := b.abortBoundLocalPushOperationIntent(f.owningRequest(), first.SourceID, first.SourceRevision, first.ID, first.Generation); err != nil {
		t.Fatal(err)
	}
	if _, err := a.reserveBoundLocalPushOperationIntentWithKey(f.owningRequest(), f.source.ID, f.source.Revision, key); err == nil {
		t.Fatal("aborted historical request key was reauthorized")
	}
	second, err := b.reserveBoundLocalPushOperationIntentWithKey(f.owningRequest(), f.source.ID, f.source.Revision, nextKey)
	if err != nil || second.Generation != 2 || second.ID == first.ID {
		t.Fatalf("fresh post-abort key did not advance generation: %+v err=%v", second, err)
	}
	if _, err := a.reserveBoundLocalPushOperationIntentWithKey(f.owningRequest(), f.source.ID, f.source.Revision, key); err == nil {
		t.Fatal("stale key bypassed newer operation generation")
	}

	// Use one DB transaction clock and preserve the exact 30-second duration:
	// setting only expires_at before issued_at is an invalid fixture.
	expired := f.primary.Exec("UPDATE xd_local_push_operation_intents SET issued_at = CURRENT_TIMESTAMP - INTERVAL '31 seconds', expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = ?", second.ID)
	if expired.Error != nil || expired.RowsAffected != 1 {
		t.Fatalf("could not build a valid elapsed operation: rows=%d err=%v", expired.RowsAffected, expired.Error)
	}
	if _, err := b.reserveBoundLocalPushOperationIntentWithKey(f.owningRequest(), f.source.ID, f.source.Revision, nextKey); err == nil {
		t.Fatal("expired request key was resurrected")
	}
	third, err := a.reserveBoundLocalPushOperationIntentWithKey(f.owningRequest(), f.source.ID, f.source.Revision,
		bytes.Repeat([]byte{0x43}, localPushOperationRequestKeySize))
	if err != nil || third.Generation != 3 || third.ID == second.ID {
		t.Fatalf("fresh key after expiry did not advance generation: %+v err=%v", third, err)
	}
	var rows, nodes, items, runs int64
	if err := f.primary.Model(&meta.LocalPushOperationIntent{}).Count(&rows).Error; err != nil || rows != 3 {
		t.Fatalf("duplicate or missing intent rows: %d err=%v", rows, err)
	}
	if err := f.primary.Model(&meta.Node{}).Count(&nodes).Error; err != nil || nodes != 1 {
		t.Fatalf("idempotency touched cloud Node: %d err=%v", nodes, err)
	}
	if err := f.primary.Model(&meta.SourceItem{}).Count(&items).Error; err != nil || items != 0 {
		t.Fatalf("idempotency touched SourceItem: %d err=%v", items, err)
	}
	if err := f.primary.Model(&meta.SyncRun{}).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("idempotency invented SourceRun: %d err=%v", runs, err)
	}
}

func TestLocalPushKeyedAdmissionRejectsInvalidAndChangedScope(t *testing.T) {
	f := makeLocalOperationFixture(t)
	a, b := &Server{DB: f.primary}, &Server{DB: f.replica}
	for _, key := range [][]byte{
		nil, {}, bytes.Repeat([]byte{0x42}, 31),
		bytes.Repeat([]byte{0x42}, 33), make([]byte, localPushOperationRequestKeySize),
	} {
		if _, err := a.reserveBoundLocalPushOperationIntentWithKey(f.owningRequest(), f.source.ID, f.source.Revision, key); err == nil {
			t.Fatalf("invalid key admitted: len=%d", len(key))
		}
	}
	var count int64
	if err := f.replica.Model(&meta.LocalPushOperationIntent{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("invalid keys created operations: count=%d err=%v", count, err)
	}
	key := bytes.Repeat([]byte{0x41}, localPushOperationRequestKeySize)
	first, err := a.reserveBoundLocalPushOperationIntentWithKey(f.owningRequest(), f.source.ID, f.source.Revision, key)
	if err != nil {
		t.Fatal(err)
	}
	wrong := f.owningRequest()
	wrong.Request.Header.Set("X-XDrive-Device-Token", "forged-device-token")
	if _, err := b.reserveBoundLocalPushOperationIntentWithKey(wrong, f.source.ID, f.source.Revision, key); err == nil {
		t.Fatal("device credential bypassed by replay key")
	}
	foreign := f.owningRequest()
	foreign.Set("userID", f.owner.ID+1)
	if _, err := b.reserveBoundLocalPushOperationIntentWithKey(foreign, f.source.ID, f.source.Revision, key); err == nil {
		t.Fatal("foreign owner bypassed by replay key")
	}
	if err := f.primary.Model(&meta.User{}).Where("id = ?", f.owner.ID).
		Update("session_version", f.owner.SessionVersion+1).Error; err != nil {
		t.Fatal(err)
	}
	if got, err := b.reserveBoundLocalPushOperationIntentWithKey(f.owningRequest(), f.source.ID, f.source.Revision, key); err == nil || got.ID != "" {
		t.Fatalf("rotated account session replayed existing operation: %+v err=%v", got, err)
	}
	if first.RequestKeyDigest == nil || *first.RequestKeyDigest == string(key) {
		t.Fatal("raw keyed request was persisted")
	}
}
