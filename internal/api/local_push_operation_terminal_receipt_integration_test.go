package api

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestLocalPushTerminalReceiptTwoPoolAbortRestartAndReplay(t *testing.T) {
	f := makeLocalOperationFixture(t)
	a, b := &Server{DB: f.primary}, &Server{DB: f.replica}
	key := bytes.Repeat([]byte{0x41}, localPushOperationRequestKeySize)
	first, err := a.reserveBoundLocalPushOperationIntentWithKey(
		f.owningRequest(), f.source.ID, f.source.Revision, key)
	if err != nil {
		t.Fatal(err)
	}
	if receipt, err := b.recordBoundLocalPushReservationTerminal(
		f.owningRequest(), f.source.ID, f.source.Revision, key,
		first.ID, first.Generation); err == nil || receipt != (localPushPrivateReservationTerminal{}) {
		t.Fatalf("live lease gained terminal proof: %+v %v", receipt, err)
	}
	if err := b.abortBoundLocalPushOperationIntent(
		f.owningRequest(), f.source.ID, f.source.Revision, first.ID, first.Generation); err != nil {
		t.Fatal(err)
	}
	got, err := b.recordBoundLocalPushReservationTerminal(
		f.owningRequest(), f.source.ID, f.source.Revision, key,
		first.ID, first.Generation)
	if err != nil || got.operationID != first.ID ||
		got.generation != first.Generation ||
		got.state != meta.LocalPushTerminalReservationAborted ||
		got.recordedAt.IsZero() || got.recordedAt.Location() != time.UTC {
		t.Fatalf("aborted reservation did not persist: %+v %v", got, err)
	}
	wire, err := json.Marshal(got)
	if err != nil || string(wire) != "{}" {
		t.Fatalf("private reservation terminal exposed fields: %s %v", wire, err)
	}
	var saved meta.LocalPushOperationTerminalReceipt
	if err := f.primary.Where("operation_id = ?", first.ID).Take(&saved).Error; err != nil ||
		saved.SourceID != first.SourceID || saved.Generation != first.Generation ||
		saved.State != meta.LocalPushTerminalReservationAborted ||
		saved.RequestKeyDigest == "" || saved.RequestKeyDigest == string(key) {
		t.Fatalf("terminal receipt not persisted privately: %+v %v", saved, err)
	}
	wire, err = json.Marshal(saved)
	if err != nil || string(wire) != "{}" {
		t.Fatalf("private database receipt escaped into JSON: %s %v", wire, err)
	}
	replayed, err := a.recordBoundLocalPushReservationTerminal(
		f.owningRequest(), f.source.ID, f.source.Revision, key,
		first.ID, first.Generation)
	if err != nil || replayed != got {
		t.Fatalf("restarted replay changed immutable receipt: %+v %+v %v", got, replayed, err)
	}
	second, err := a.reserveBoundLocalPushOperationIntentWithKey(
		f.owningRequest(), f.source.ID, f.source.Revision,
		bytes.Repeat([]byte{0x42}, localPushOperationRequestKeySize))
	if err != nil || second.Generation != first.Generation+1 {
		t.Fatalf("post-abort generation failed: %+v %v", second, err)
	}
	if stale, err := b.recordBoundLocalPushReservationTerminal(
		f.owningRequest(), f.source.ID, f.source.Revision, key,
		first.ID, first.Generation); err == nil || stale != (localPushPrivateReservationTerminal{}) {
		t.Fatalf("superseded generation reused terminal proof: %+v %v", stale, err)
	}
	var count int64
	if err := f.primary.Model(&meta.LocalPushOperationTerminalReceipt{}).
		Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("replay duplicated or deleted terminal evidence: %d %v", count, err)
	}
}

func TestLocalPushTerminalReceiptExpiryIsSQLClockOnly(t *testing.T) {
	f := makeLocalOperationFixture(t)
	a, b := &Server{DB: f.primary}, &Server{DB: f.replica}
	key := bytes.Repeat([]byte{0x53}, localPushOperationRequestKeySize)
	row, err := a.reserveBoundLocalPushOperationIntentWithKey(
		f.owningRequest(), f.source.ID, f.source.Revision, key)
	if err != nil {
		t.Fatal(err)
	}
	expired := f.primary.Exec(
		"UPDATE xd_local_push_operation_intents SET issued_at = CURRENT_TIMESTAMP - INTERVAL '31 seconds', expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = ?",
		row.ID)
	if expired.Error != nil || expired.RowsAffected != 1 {
		t.Fatalf("could not create valid elapsed reservation: %+v", expired)
	}
	got, err := b.recordBoundLocalPushReservationTerminal(
		f.owningRequest(), f.source.ID, f.source.Revision, key,
		row.ID, row.Generation)
	if err != nil || got.state != meta.LocalPushTerminalReservationExpired {
		t.Fatalf("expired reservation was not recorded: %+v %v", got, err)
	}
	again, err := a.recordBoundLocalPushReservationTerminal(
		f.owningRequest(), f.source.ID, f.source.Revision, key,
		row.ID, row.Generation)
	if err != nil || again != got {
		t.Fatalf("expiry proof drifted across replica/restart: %+v %+v %v", got, again, err)
	}
	var nodes, items, runs int64
	if err := f.primary.Model(&meta.Node{}).Count(&nodes).Error; err != nil || nodes != 1 {
		t.Fatalf("terminal evidence touched Nodes: %d %v", nodes, err)
	}
	if err := f.primary.Model(&meta.SourceItem{}).Count(&items).Error; err != nil || items != 0 {
		t.Fatalf("terminal evidence touched SourceItems: %d %v", items, err)
	}
	if err := f.primary.Model(&meta.SyncRun{}).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("terminal evidence invented SourceRun: %d %v", runs, err)
	}
}

func TestLocalPushTerminalReceiptDeniesChangedScopeAndBadClocks(t *testing.T) {
	for _, scenario := range []string{
		"wrong-key", "wrong-id", "wrong-generation", "foreign-owner",
		"forged-token", "changed-root", "revoked", "rotated-session",
		"revised-source", "changed-target", "cancelled", "invalid-clock",
	} {
		t.Run(scenario, func(t *testing.T) {
			f := makeLocalOperationFixture(t)
			s := &Server{DB: f.primary}
			key := bytes.Repeat([]byte{0x41}, localPushOperationRequestKeySize)
			row, err := s.reserveBoundLocalPushOperationIntentWithKey(
				f.owningRequest(), f.source.ID, f.source.Revision, key)
			if err != nil {
				t.Fatal(err)
			}
			if err := s.abortBoundLocalPushOperationIntent(
				f.owningRequest(), f.source.ID, f.source.Revision, row.ID, row.Generation); err != nil {
				t.Fatal(err)
			}
			c := f.owningRequest()
			id, generation := row.ID, row.Generation
			switch scenario {
			case "wrong-key":
				key = bytes.Repeat([]byte{0x42}, localPushOperationRequestKeySize)
			case "wrong-id":
				id = uuid.NewString()
			case "wrong-generation":
				generation++
			case "foreign-owner":
				c.Set("userID", f.owner.ID+1)
			case "forged-token":
				c.Request.Header.Set("X-XDrive-Device-Token", "forged")
			case "changed-root":
				c.Request.Header.Set("X-XDrive-Local-Root-Fingerprint", strings.Repeat("a", 64))
				if f.fingerprint == strings.Repeat("a", 64) {
					c.Request.Header.Set("X-XDrive-Local-Root-Fingerprint", strings.Repeat("b", 64))
				}
			case "revoked":
				now := time.Now().UTC()
				if err := f.primary.Model(&meta.ClientDevice{}).Where("id = ?", f.device.ID).
					Update("revoked_at", &now).Error; err != nil {
					t.Fatal(err)
				}
			case "rotated-session":
				if err := f.primary.Model(&meta.User{}).Where("id = ?", f.owner.ID).
					Update("session_version", f.owner.SessionVersion+1).Error; err != nil {
					t.Fatal(err)
				}
			case "revised-source":
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
				defer cancel()
				c.Request = c.Request.WithContext(ctx)
			case "invalid-clock":
				if err := f.primary.Model(&meta.LocalPushOperationIntent{}).
					Where("id = ?", row.ID).
					Update("issued_at", time.Now().UTC().Add(time.Hour)).Error; err != nil {
					t.Fatal(err)
				}
			}
			got, err := (&Server{DB: f.replica}).recordBoundLocalPushReservationTerminal(
				c, f.source.ID, f.source.Revision, key, id, generation)
			if err == nil || got != (localPushPrivateReservationTerminal{}) {
				t.Fatalf("%s gained unsafe terminal evidence: %+v %v", scenario, got, err)
			}
			var count int64
			if err := f.primary.Model(&meta.LocalPushOperationTerminalReceipt{}).
				Count(&count).Error; err != nil || count != 0 {
				t.Fatalf("%s wrote unauthorized terminal receipt: %d %v", scenario, count, err)
			}
		})
	}
}

func TestLocalPushTerminalReceiptConcurrentTwoPoolReplay(t *testing.T) {
	f := makeLocalOperationFixture(t)
	a, b := &Server{DB: f.primary}, &Server{DB: f.replica}
	key := bytes.Repeat([]byte{0x45}, localPushOperationRequestKeySize)
	row, err := a.reserveBoundLocalPushOperationIntentWithKey(
		f.owningRequest(), f.source.ID, f.source.Revision, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.abortBoundLocalPushOperationIntent(
		f.owningRequest(), f.source.ID, f.source.Revision, row.ID, row.Generation); err != nil {
		t.Fatal(err)
	}
	type reply struct {
		receipt localPushPrivateReservationTerminal
		err     error
	}
	replies := make(chan reply, 8)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			server := a
			if i%2 != 0 {
				server = b
			}
			got, err := server.recordBoundLocalPushReservationTerminal(
				f.owningRequest(), f.source.ID, f.source.Revision, key,
				row.ID, row.Generation)
			replies <- reply{receipt: got, err: err}
		}(i)
	}
	wg.Wait()
	close(replies)
	var first localPushPrivateReservationTerminal
	for got := range replies {
		if got.err != nil || got.receipt.state != meta.LocalPushTerminalReservationAborted {
			t.Fatalf("parallel receipt failed: %+v", got)
		}
		if first.operationID == "" {
			first = got.receipt
		} else if got.receipt != first {
			t.Fatalf("terminal replay changed persisted proof: %+v %+v", first, got.receipt)
		}
	}
	var count int64
	if err := f.primary.Model(&meta.LocalPushOperationTerminalReceipt{}).
		Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("parallel terminal inserts=%d: %v", count, err)
	}
}

// The existing private first-leaf writer COMMIT and the reservation-terminal
// path must serialize on the SAME operation UPDATE lock. A real SQL COMMIT
// must defeat a later abort AND a later synthetic lease-expiry receipt;
// otherwise an owning Agent could observe mutually contradictory durable
// outcomes after losing the initial HTTP response.
func TestLocalPushCommittedFirstLeafRejectsLaterAbortAndExpiredTerminal(t *testing.T) {
	f, key, operation := makeLocalPushBoundFirstLeafFixture(t)
	committed, ok, err := f.server.commitBoundLocalPushFirstLeafWithCurrentOperation(
		f.ctx, f.source.ID, f.source.Revision, f.proof,
		f.stage.StageID, localPushFirstLeafFixtureName,
		key, operation.ID, operation.Generation)
	if err != nil || !ok || committed.NodeID == 0 || committed.SourceItemID == 0 {
		t.Fatalf("physical first-leaf SQL COMMIT prerequisite failed: %+v %t %v", committed, ok, err)
	}
	if err := f.server.abortBoundLocalPushOperationIntent(
		f.ctx, f.source.ID, f.source.Revision, operation.ID, operation.Generation); err == nil {
		t.Fatal("already committed first leaf was subsequently aborted")
	}
	var reserved meta.LocalPushOperationIntent
	if err := f.server.DB.Where("id = ?", operation.ID).Take(&reserved).Error; err != nil ||
		reserved.State != meta.LocalPushOperationIntentReserved || reserved.AbortedAt != nil {
		t.Fatalf("post-COMMIT abort changed operation: %+v %v", reserved, err)
	}
	// Simulate lease expiration AFTER a real SQL commit. Expiry is not proof
	// that the commit did not happen, even when its HTTP response was lost.
	expired := f.server.DB.Exec(
		"UPDATE xd_local_push_operation_intents SET issued_at = CURRENT_TIMESTAMP - INTERVAL '31 seconds', expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = ?",
		operation.ID)
	if expired.Error != nil || expired.RowsAffected != 1 {
		t.Fatalf("unable to create post-COMMIT expired lease: %+v", expired)
	}
	terminal, err := f.server.recordBoundLocalPushReservationTerminal(
		f.ctx, f.source.ID, f.source.Revision, key,
		operation.ID, operation.Generation)
	if err == nil || terminal != (localPushPrivateReservationTerminal{}) {
		t.Fatalf("post-COMMIT expiry fabricated terminal receipt: %+v %v", terminal, err)
	}
	var commitCount, terminalCount, runCount int64
	if err := f.server.DB.Model(&meta.LocalPushFirstLeafOperationCommit{}).
		Where("operation_id = ?", operation.ID).Count(&commitCount).Error; err != nil || commitCount != 1 {
		t.Fatalf("immutable first-leaf COMMIT missing: %d %v", commitCount, err)
	}
	if err := f.server.DB.Model(&meta.LocalPushOperationTerminalReceipt{}).
		Where("operation_id = ?", operation.ID).Count(&terminalCount).Error; err != nil || terminalCount != 0 {
		t.Fatalf("conflicting terminal evidence persisted: %d %v", terminalCount, err)
	}
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runCount).Error; err != nil || runCount != 0 {
		t.Fatalf("SQL exclusion invented backup completion: %d %v", runCount, err)
	}
	var item meta.SourceItem
	if err := f.server.DB.Where("id = ?", committed.SourceItemID).Take(&item).Error; err != nil ||
		item.State != meta.SourceItemStatePending || item.LastSyncedAt != nil {
		t.Fatalf("first-leaf remains PENDING, never synced: %+v %v", item, err)
	}
}

// Old/missing schema must NOT silently downgrade the read of immutable
// commit evidence to a zero count. Without the table we cannot prove
// that no SQL COMMIT happened, so both negative outcome paths fail closed.
func TestLocalPushMissingCommitTableRejectsAbortAndTerminal(t *testing.T) {
	f := makeLocalOperationFixture(t)
	s := &Server{DB: f.primary}
	key := bytes.Repeat([]byte{0x66}, localPushOperationRequestKeySize)
	operation, err := s.reserveBoundLocalPushOperationIntentWithKey(
		f.owningRequest(), f.source.ID, f.source.Revision, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.primary.Migrator().DropTable(&meta.LocalPushFirstLeafOperationCommit{}); err != nil {
		t.Fatal(err)
	}
	if err := s.abortBoundLocalPushOperationIntent(
		f.owningRequest(), f.source.ID, f.source.Revision,
		operation.ID, operation.Generation); err == nil {
		t.Fatal("missing commit migration permitted abort")
	}
	expired := f.primary.Exec(
		"UPDATE xd_local_push_operation_intents SET issued_at = CURRENT_TIMESTAMP - INTERVAL '31 seconds', expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = ?",
		operation.ID)
	if expired.Error != nil || expired.RowsAffected != 1 {
		t.Fatalf("failed to expire private operation: %+v", expired)
	}
	got, err := s.recordBoundLocalPushReservationTerminal(
		f.owningRequest(), f.source.ID, f.source.Revision, key,
		operation.ID, operation.Generation)
	if err == nil || got != (localPushPrivateReservationTerminal{}) {
		t.Fatalf("missing commit table permitted false expiry: %+v %v", got, err)
	}
	var intent meta.LocalPushOperationIntent
	if err := f.primary.Where("id = ?", operation.ID).Take(&intent).Error; err != nil ||
		intent.State != meta.LocalPushOperationIntentReserved || intent.AbortedAt != nil {
		t.Fatalf("missing schema mutated operation: %+v %v", intent, err)
	}
	var terminals int64
	if err := f.primary.Model(&meta.LocalPushOperationTerminalReceipt{}).
		Count(&terminals).Error; err != nil || terminals != 0 {
		t.Fatalf("missing schema inserted terminal evidence: %d %v", terminals, err)
	}
}
