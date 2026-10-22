package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

func makeLocalPushNativeTerminalChallengeFixture(t *testing.T) (
	localPushExistingCASTestFixture, []byte, meta.LocalPushOperationIntent,
) {
	t.Helper()
	f, key, op, _ := makeLocalPushCommittedHistoricalOperationFixture(t)
	if err := f.server.DB.AutoMigrate(&meta.LocalPushNativeTerminalChallenge{}); err != nil {
		t.Fatal(err)
	}
	return f, key, op
}

func TestLocalPushOriginalNativeChallengeOneUseNeverAuthorizesBackup(t *testing.T) {
	f, key, op := makeLocalPushNativeTerminalChallengeFixture(t)
	issue := func() (localPushNativeTerminalChallengeTicket, error) {
		return f.server.issueBoundLocalPushNativeTerminalChallenge(
			f.ctx, f.source.ID, f.source.Revision, f.proof,
			f.stage.StageID, key, op.ID, op.Generation,
		)
	}
	ticket, err := issue()
	if err != nil || ticket.operationID != op.ID ||
		ticket.stageID != f.stage.StageID || ticket.generation != op.Generation ||
		ticket.nonce == ([32]byte{}) || ticket.expiresAt.IsZero() {
		t.Fatalf("fresh original SQL challenge not issued: %+v %v", ticket, err)
	}
	for _, item := range []any{ticket, meta.LocalPushNativeTerminalChallenge{}} {
		raw, err := json.Marshal(item)
		if err != nil || string(raw) != "{}" {
			t.Fatalf("SQL/native challenge leaked through JSON: %s %v", raw, err)
		}
	}
	var stored meta.LocalPushNativeTerminalChallenge
	if err := f.server.DB.Where("operation_id = ?", op.ID).Take(&stored).Error; err != nil ||
		stored.NonceSHA256 != localPushNativeTerminalChallengeDigest(ticket.nonce) ||
		stored.NonceSHA256 == string(ticket.nonce[:]) ||
		stored.State != meta.LocalPushNativeTerminalChallengeIssued ||
		stored.SourceID != f.source.ID || stored.StageID != f.stage.StageID ||
		stored.OwnerID != f.device.OwnerID || stored.OwnerSession == 0 ||
		stored.DeviceID != f.device.ID || stored.Generation != op.Generation ||
		stored.ConsumedAt != nil ||
		!stored.ExpiresAt.After(stored.IssuedAt) {
		t.Fatalf("challenge persisted unsafe data or provenance: %+v %v", stored, err)
	}
	if second, err := issue(); err == nil || second.nonce != ([32]byte{}) {
		t.Fatalf("lost challenge ACK reissued new nonce: %+v %v", second, err)
	}

	consume := func(nonce [32]byte) error {
		return f.server.DB.Transaction(func(tx *gorm.DB) error {
			return f.server.consumeBoundLocalPushNativeTerminalChallengeTx(
				tx, f.ctx, f.source.ID, f.source.Revision, f.proof,
				f.stage.StageID, key, op.ID, op.Generation, nonce)
		})
	}
	bad := ticket.nonce
	bad[0] ^= 0x01
	if err := consume(bad); err == nil {
		t.Fatal("forged response nonce consumed original challenge")
	}
	if err := consume([32]byte{}); err == nil {
		t.Fatal("zero nonce consumed original challenge")
	}
	rolledBack := errors.New("simulate Server SQL rollback before terminal")
	if err := f.server.DB.Transaction(func(tx *gorm.DB) error {
		if err := f.server.consumeBoundLocalPushNativeTerminalChallengeTx(
			tx, f.ctx, f.source.ID, f.source.Revision, f.proof,
			f.stage.StageID, key, op.ID, op.Generation, ticket.nonce,
		); err != nil {
			return err
		}
		return rolledBack
	}); !errors.Is(err, rolledBack) {
		t.Fatalf("read-only transaction rollback not exercised: %v", err)
	}
	if err := f.server.DB.Where("operation_id = ?", op.ID).
		Take(&stored).Error; err != nil ||
		stored.State != meta.LocalPushNativeTerminalChallengeIssued ||
		stored.ConsumedAt != nil {
		t.Fatalf("rolled-back challenge became spent: %+v %v", stored, err)
	}
	if err := consume(ticket.nonce); err != nil {
		t.Fatalf("original unspent nonce was not consumed atomically: %v", err)
	}
	if err := consume(ticket.nonce); err == nil {
		t.Fatal("consumed native challenge replayed twice")
	}
	if third, err := issue(); err == nil || third.nonce != ([32]byte{}) {
		t.Fatalf("consumed challenge was rotated: %+v %v", third, err)
	}
	if err := f.server.DB.Where("operation_id = ?", op.ID).Take(&stored).Error; err != nil ||
		stored.State != meta.LocalPushNativeTerminalChallengeConsumed ||
		stored.ConsumedAt == nil {
		t.Fatalf("one-use challenge not durable: %+v %v", stored, err)
	}
	var count, terminal, runs int64
	if err := f.server.DB.Model(&meta.LocalPushNativeTerminalChallenge{}).
		Where("source_id = ?", f.source.ID).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("challenge replay duplicated its SQL row: %d %v", count, err)
	}
	if err := f.server.DB.Model(&meta.LocalPushFileTerminal{}).
		Where("source_id = ?", f.source.ID).Count(&terminal).Error; err != nil || terminal != 0 {
		t.Fatalf("challenge forged OS physical-commit: %d %v", terminal, err)
	}
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("challenge started backup SourceRun: %d %v", runs, err)
	}
}

func TestLocalPushNativeChallengeIssueRejectsForeignOrChangedScope(t *testing.T) {
	for _, scenario := range []string{
		"wrong-key", "wrong-operation", "wrong-stage", "wrong-generation",
		"foreign-owner", "wrong-root", "device-revoked", "source-revision",
		"missing-original-commit", "reservation-terminal",
		"already-physical-terminal", "canceled-context",
	} {
		t.Run(scenario, func(t *testing.T) {
			f, key, op := makeLocalPushNativeTerminalChallengeFixture(t)
			stageID, operationID, generation := f.stage.StageID, op.ID, op.Generation
			switch scenario {
			case "wrong-key":
				key = bytes.Repeat([]byte{0xfa}, localPushOperationRequestKeySize)
			case "wrong-operation":
				operationID = uuid.NewString()
			case "wrong-stage":
				stageID = uuid.NewString()
			case "wrong-generation":
				generation++
			case "foreign-owner":
				f.ctx.Set("userID", f.device.OwnerID+1)
			case "wrong-root":
				f.ctx.Request.Header.Set("X-XDrive-Local-Root-Fingerprint", strings.Repeat("f", 64))
			case "device-revoked":
				if err := f.server.DB.Model(&meta.ClientDevice{}).
					Where("id = ?", f.device.ID).
					Update("revoked_at", time.Now().UTC()).Error; err != nil {
					t.Fatal(err)
				}
			case "source-revision":
				if err := f.server.DB.Model(&meta.Source{}).
					Where("id = ?", f.source.ID).
					Update("revision", f.source.Revision+1).Error; err != nil {
					t.Fatal(err)
				}
			case "missing-original-commit":
				if err := f.server.DB.
					Where("operation_id = ?", op.ID).
					Delete(&meta.LocalPushFirstLeafOperationCommit{}).Error; err != nil {
					t.Fatal(err)
				}
			case "reservation-terminal":
				if op.RequestKeyDigest == nil {
					t.Fatal("missing original key digest")
				}
				abort := meta.LocalPushOperationTerminalReceipt{
					OperationID: op.ID, SourceID: op.SourceID,
					Generation:       op.Generation,
					RequestKeyDigest: *op.RequestKeyDigest,
					State:            meta.LocalPushTerminalReservationExpired,
					RecordedAt:       time.Now().UTC(),
				}
				if err := f.server.DB.Create(&abort).Error; err != nil {
					t.Fatal(err)
				}
			case "already-physical-terminal":
				term := meta.LocalPushFileTerminal{
					OperationID: op.ID, StageID: f.stage.StageID,
					SourceID: f.source.ID, Generation: op.Generation,
					State:      meta.LocalPushFileTerminalPhysicalCommit,
					RecordedAt: time.Now().UTC(),
				}
				if err := f.server.DB.Create(&term).Error; err != nil {
					t.Fatal(err)
				}
			case "canceled-context":
				ctx, cancel := context.WithCancel(context.Background())
				f.ctx.Request = f.ctx.Request.WithContext(ctx)
				cancel()
			}
			result, err := f.server.issueBoundLocalPushNativeTerminalChallenge(
				f.ctx, f.source.ID, f.source.Revision, f.proof,
				stageID, key, operationID, generation)
			if err == nil || result.nonce != ([32]byte{}) {
				t.Fatalf("%s issued forged native challenge: %+v %v", scenario, result, err)
			}
			var count, runs int64
			if err := f.server.DB.Model(&meta.LocalPushNativeTerminalChallenge{}).
				Count(&count).Error; err != nil || count != 0 {
				t.Fatalf("%s minted challenge after denial: %d %v", scenario, count, err)
			}
			if err := f.server.DB.Model(&meta.SyncRun{}).
				Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
				t.Fatalf("%s started SourceRun: %d %v", scenario, runs, err)
			}
		})
	}
}

func TestLocalPushNativeChallengeConsumeRejectsExpiryAndRevocation(t *testing.T) {
	for _, scenario := range []string{"expired", "revoke-device", "root-changed", "wrong-key"} {
		t.Run(scenario, func(t *testing.T) {
			f, key, op := makeLocalPushNativeTerminalChallengeFixture(t)
			ticket, err := f.server.issueBoundLocalPushNativeTerminalChallenge(
				f.ctx, f.source.ID, f.source.Revision, f.proof,
				f.stage.StageID, key, op.ID, op.Generation)
			if err != nil {
				t.Fatal(err)
			}
			switch scenario {
			case "expired":
				if err := f.server.DB.Model(&meta.LocalPushNativeTerminalChallenge{}).
					Where("operation_id = ?", op.ID).
					Update("expires_at", time.Now().UTC().Add(-time.Minute)).Error; err != nil {
					t.Fatal(err)
				}
			case "revoke-device":
				if err := f.server.DB.Model(&meta.ClientDevice{}).
					Where("id = ?", f.device.ID).
					Update("revoked_at", time.Now().UTC()).Error; err != nil {
					t.Fatal(err)
				}
			case "root-changed":
				f.ctx.Request.Header.Set("X-XDrive-Local-Root-Fingerprint", strings.Repeat("e", 64))
			case "wrong-key":
				key = bytes.Repeat([]byte{0xf1}, localPushOperationRequestKeySize)
			}
			err = f.server.DB.Transaction(func(tx *gorm.DB) error {
				return f.server.consumeBoundLocalPushNativeTerminalChallengeTx(
					tx, f.ctx, f.source.ID, f.source.Revision, f.proof,
					f.stage.StageID, key, op.ID, op.Generation, ticket.nonce)
			})
			if err == nil {
				t.Fatalf("%s consumed a revoked/expired challenge", scenario)
			}
			var saved meta.LocalPushNativeTerminalChallenge
			if err := f.server.DB.Where("operation_id = ?", op.ID).
				Take(&saved).Error; err != nil ||
				saved.State != meta.LocalPushNativeTerminalChallengeIssued ||
				saved.ConsumedAt != nil {
				t.Fatalf("%s mutated denied challenge: %+v %v", scenario, saved, err)
			}
		})
	}
}

func TestOriginalNativeTerminalChallengeNeverExposesAnHTTPRoute(t *testing.T) {
	raw, err := os.ReadFile("router.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{
		"issueBoundLocalPushNativeTerminalChallenge",
		"consumeBoundLocalPushNativeTerminalChallengeTx",
	} {
		if strings.Contains(string(raw), method) {
			t.Fatalf("private native challenge method became an HTTP route: %s", method)
		}
	}
}
