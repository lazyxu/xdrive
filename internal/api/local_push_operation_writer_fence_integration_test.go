package api

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

func TestLocalPushWriterFenceAllowsOnlyCurrentLivePreparedKey(t *testing.T) {
	f := makeLocalOperationFixture(t)
	a, b := &Server{DB: f.primary}, &Server{DB: f.replica}
	key := bytes.Repeat([]byte{0x41}, localPushOperationRequestKeySize)
	row, err := a.reserveBoundLocalPushOperationIntentWithKey(
		f.owningRequest(), f.source.ID, f.source.Revision, key)
	if err != nil {
		t.Fatal(err)
	}
	check := func(s *Server) error {
		return s.DB.Transaction(func(tx *gorm.DB) error {
			if err := s.validateCurrentLocalPushWriterFenceTx(
				tx, f.owningRequest(), f.source.ID, f.source.Revision,
				key, row.ID, row.Generation); err != nil {
				return err
			}
			// A future SQL writer must recheck the CURRENT DB clock while
			// retaining the same transaction and operation UPDATE lock.
			return s.validateCurrentLocalPushWriterFenceTx(
				tx, f.owningRequest(), f.source.ID, f.source.Revision,
				key, row.ID, row.Generation)
		})
	}
	if err := check(a); err != nil {
		t.Fatalf("current owned reservation rejected: %v", err)
	}
	// A plain connection would release FOR UPDATE before a future canonical
	// commit and therefore must NEVER be mistaken for a held transaction.
	if err := a.validateCurrentLocalPushWriterFenceTx(
		f.primary, f.owningRequest(), f.source.ID, f.source.Revision,
		key, row.ID, row.Generation); err == nil {
		t.Fatal("non-transactional GORM DB passed the held operation fence")
	}
	if err := check(b); err != nil {
		t.Fatalf("current reservation changed across Server pools: %v", err)
	}
	wire, err := json.Marshal(row)
	if err != nil || string(wire) != "{}" {
		t.Fatalf("private operation escaped as an execution token: %s %v", wire, err)
	}
	if err := b.abortBoundLocalPushOperationIntent(
		f.owningRequest(), f.source.ID, f.source.Revision,
		row.ID, row.Generation); err != nil {
		t.Fatal(err)
	}
	if err := check(a); err == nil {
		t.Fatal("aborted reservation admitted a SQL writer")
	}
	if receipt, err := a.recordBoundLocalPushReservationTerminal(
		f.owningRequest(), f.source.ID, f.source.Revision,
		key, row.ID, row.Generation); err != nil ||
		receipt.state != meta.LocalPushTerminalReservationAborted {
		t.Fatalf("failed to persist historical terminal evidence: %+v %v", receipt, err)
	}
	if err := check(b); err == nil {
		t.Fatal("terminal receipt admitted a SQL writer")
	}
	newKey := bytes.Repeat([]byte{0x42}, localPushOperationRequestKeySize)
	newer, err := b.reserveBoundLocalPushOperationIntentWithKey(
		f.owningRequest(), f.source.ID, f.source.Revision, newKey)
	if err != nil || newer.Generation != row.Generation+1 {
		t.Fatalf("new independent reservation missing: %+v %v", newer, err)
	}
	if err := check(a); err == nil {
		t.Fatal("older UUID/generation wrote after a newer reservation")
	}
	for _, obj := range []struct {
		name     string
		table    any
		expected int64
	}{
		{"nodes", &meta.Node{}, 1},
		{"items", &meta.SourceItem{}, 0},
		{"runs", &meta.SyncRun{}, 0},
	} {
		var count int64
		if err := f.replica.Model(obj.table).Count(&count).Error; err != nil ||
			count != obj.expected {
			t.Fatalf("writer fence unexpectedly modified %s: %d %v", obj.name, count, err)
		}
	}
}

func TestLocalPushWriterFenceFailsClosedOnScopeAndSchemaDrift(t *testing.T) {
	for _, scenario := range []string{
		"wrong-key", "missing-key", "wrong-id", "wrong-generation",
		"foreign-owner", "forged-device", "wrong-root", "revoked-device",
		"rotated-session", "revised-source", "changed-target", "cancelled",
		"expired-sql-clock", "future-issue", "superseded", "terminal-present",
		"missing-terminal-migration", "unkeyed-reservation",
	} {
		t.Run(scenario, func(t *testing.T) {
			f := makeLocalOperationFixture(t)
			a, b := &Server{DB: f.primary}, &Server{DB: f.replica}
			key := bytes.Repeat([]byte{0x57}, localPushOperationRequestKeySize)
			var row meta.LocalPushOperationIntent
			var err error
			if scenario == "unkeyed-reservation" {
				row, err = a.reserveBoundLocalPushOperationIntent(
					f.owningRequest(), f.source.ID, f.source.Revision)
			} else {
				row, err = a.reserveBoundLocalPushOperationIntentWithKey(
					f.owningRequest(), f.source.ID, f.source.Revision, key)
			}
			if err != nil {
				t.Fatal(err)
			}
			c := f.owningRequest()
			id, generation := row.ID, row.Generation
			switch scenario {
			case "wrong-key":
				key = bytes.Repeat([]byte{0x58}, localPushOperationRequestKeySize)
			case "missing-key":
				key = nil
			case "wrong-id":
				id = uuid.NewString()
			case "wrong-generation":
				generation++
			case "foreign-owner":
				c.Set("userID", f.owner.ID+1)
			case "forged-device":
				c.Request.Header.Set("X-XDrive-Device-Token", "forged-device")
			case "wrong-root":
				bad := strings.Repeat("f", 64)
				if f.fingerprint == bad {
					bad = strings.Repeat("e", 64)
				}
				c.Request.Header.Set("X-XDrive-Local-Root-Fingerprint", bad)
			case "revoked-device":
				now := time.Now().UTC()
				if err := f.primary.Model(&meta.ClientDevice{}).
					Where("id = ?", f.device.ID).Update("revoked_at", &now).Error; err != nil {
					t.Fatal(err)
				}
			case "rotated-session":
				if err := f.primary.Model(&meta.User{}).
					Where("id = ?", f.owner.ID).
					Update("session_version", f.owner.SessionVersion+1).Error; err != nil {
					t.Fatal(err)
				}
			case "revised-source":
				if err := f.primary.Model(&meta.Source{}).
					Where("id = ?", f.source.ID).
					Update("revision", f.source.Revision+1).Error; err != nil {
					t.Fatal(err)
				}
			case "changed-target":
				if err := f.primary.Model(&meta.Source{}).
					Where("id = ?", f.source.ID).
					Update("target_node_id", nil).Error; err != nil {
					t.Fatal(err)
				}
			case "cancelled":
				ctx, cancel := context.WithCancel(c.Request.Context())
				cancel()
				defer cancel()
				c.Request = c.Request.WithContext(ctx)
			case "expired-sql-clock":
				if err := f.primary.Exec(
					"UPDATE xd_local_push_operation_intents SET issued_at = CURRENT_TIMESTAMP - INTERVAL '31 seconds', expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = ?",
					row.ID).Error; err != nil {
					t.Fatal(err)
				}
			case "future-issue":
				if err := f.primary.Model(&meta.LocalPushOperationIntent{}).
					Where("id = ?", row.ID).
					Update("issued_at", time.Now().UTC().Add(time.Minute)).Error; err != nil {
					t.Fatal(err)
				}
			case "superseded":
				if err := a.abortBoundLocalPushOperationIntent(
					f.owningRequest(), f.source.ID, f.source.Revision,
					row.ID, row.Generation); err != nil {
					t.Fatal(err)
				}
				if _, err := b.reserveBoundLocalPushOperationIntentWithKey(
					f.owningRequest(), f.source.ID, f.source.Revision,
					bytes.Repeat([]byte{0x59}, localPushOperationRequestKeySize)); err != nil {
					t.Fatal(err)
				}
			case "terminal-present":
				digest, ok := localPushOperationRequestKeyDigest(key)
				if !ok {
					t.Fatal("valid original test key missing")
				}
				if err := f.primary.Create(&meta.LocalPushOperationTerminalReceipt{
					OperationID: row.ID, SourceID: row.SourceID, Generation: row.Generation,
					RequestKeyDigest: digest, State: meta.LocalPushTerminalReservationExpired,
					RecordedAt: time.Now().UTC(),
				}).Error; err != nil {
					t.Fatal(err)
				}
			case "missing-terminal-migration":
				if err := f.primary.Exec("DROP TABLE xd_local_push_operation_terminal_receipts").Error; err != nil {
					t.Fatal(err)
				}
			}
			err = b.DB.Transaction(func(tx *gorm.DB) error {
				return b.validateCurrentLocalPushWriterFenceTx(
					tx, c, f.source.ID, f.source.Revision, key, id, generation)
			})
			if err == nil {
				t.Fatalf("%s bypassed current operation writer interlock", scenario)
			}
		})
	}
}

func TestLocalPushWriterFenceRequiresSQLClockRecheckBeforeCommit(t *testing.T) {
	f := makeLocalOperationFixture(t)
	s := &Server{DB: f.primary}
	key := bytes.Repeat([]byte{0x61}, localPushOperationRequestKeySize)
	row, err := s.reserveBoundLocalPushOperationIntentWithKey(
		f.owningRequest(), f.source.ID, f.source.Revision, key)
	if err != nil {
		t.Fatal(err)
	}
	expiredDuringTransaction := false
	err = f.primary.Transaction(func(tx *gorm.DB) error {
		if err := s.validateCurrentLocalPushWriterFenceTx(
			tx, f.owningRequest(), f.source.ID, f.source.Revision,
			key, row.ID, row.Generation); err != nil {
			return err
		}
		// Simulate a lease elapsed before a future canonical SQL COMMIT.
		// Clock is clock_timestamp(), not fixed transaction CURRENT_TIMESTAMP.
		if err := tx.Exec(
			"UPDATE xd_local_push_operation_intents SET issued_at = clock_timestamp() - INTERVAL '31 seconds', expires_at = clock_timestamp() - INTERVAL '1 second' WHERE id = ?",
			row.ID).Error; err != nil {
			return err
		}
		if err := s.validateCurrentLocalPushWriterFenceTx(
			tx, f.owningRequest(), f.source.ID, f.source.Revision,
			key, row.ID, row.Generation); err == nil {
			t.Fatal("once-valid reservation still admitted expired precommit")
		}
		expiredDuringTransaction = true
		return nil
	})
	if err != nil || !expiredDuringTransaction {
		t.Fatalf("second DB-clock fence not tested: %v", err)
	}
}
