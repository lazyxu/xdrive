package api

import (
	"bytes"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Only a TEST fixture may insert a synthetic physical terminal in B1:
// no production Agent/Server code can mint a native quiescence witness yet.
// A private SQL row is not, by itself, a trusted physical outcome.
func testLocalPushFileTerminal(
	op meta.LocalPushOperationIntent, stageID string,
) meta.LocalPushFileTerminal {
	return meta.LocalPushFileTerminal{
		OperationID: op.ID, StageID: stageID, SourceID: op.SourceID,
		Generation: op.Generation, OwnerID: op.OwnerID,
		OwnerSession: op.OwnerSession, DeviceID: op.DeviceID,
		RootID: op.RootID, RootFingerprint: op.RootFingerprint,
		SourceRevision: op.SourceRevision, TargetNodeID: op.TargetNodeID,
		RequestKeyDigest:      *op.RequestKeyDigest,
		CurrentSnapshotSHA256: strings.Repeat("a", 64),
		CurrentPathKey:        strings.Repeat("b", 64),
		ContentSHA256:         strings.Repeat("c", 64),
		NativeWitnessSHA256:   strings.Repeat("d", 64),
		State:                 meta.LocalPushFileTerminalPhysicalCancelQuiesced,
		RecordedAt:            time.Now().UTC(),
	}
}

func TestLocalPushFileTerminalSQLReadRequiresExactOriginalAndCommit(t *testing.T) {
	f, key, op := makeLocalPushBoundFirstLeafFixture(t)
	physical, ok, err := f.server.commitBoundLocalPushFirstLeafWithCurrentOperation(
		f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
		localPushFirstLeafFixtureName, key, op.ID, op.Generation)
	if err != nil || !ok || physical.NodeID == 0 || physical.SourceItemID == 0 {
		t.Fatalf("source-exact first-leaf SQL prerequisite absent: %+v %t %v", physical, ok, err)
	}
	read := func(key []byte, operationID, stageID string) (meta.LocalPushFileTerminal, error) {
		var result meta.LocalPushFileTerminal
		err := f.server.DB.Transaction(func(tx *gorm.DB) error {
			var err error
			result, err = f.server.inspectBoundLocalPushFileTerminalTx(
				tx, f.ctx, f.source.ID, f.source.Revision,
				key, operationID, op.Generation, stageID)
			return err
		})
		return result, err
	}
	if terminal, err := read(key, op.ID, f.stage.StageID); err == nil ||
		terminal != (meta.LocalPushFileTerminal{}) {
		t.Fatalf("SQL COMMIT was falsely promoted into a physical terminal: %+v %v", terminal, err)
	}
	var committed meta.LocalPushFirstLeafOperationCommit
	if err := f.server.DB.Where("operation_id = ?", op.ID).
		Take(&committed).Error; err != nil {
		t.Fatal(err)
	}
	claim := testLocalPushFileTerminal(op, f.stage.StageID)
	claim.State = meta.LocalPushFileTerminalPhysicalCommit
	claim.CurrentSnapshotSHA256 = committed.CurrentSnapshotSHA256
	claim.CurrentPathKey = committed.CurrentPathKey
	claim.ContentSHA256 = committed.ContentSHA256
	claim.TotalSize = committed.TotalSize
	claim.NodeID = committed.NodeID
	claim.SourceItemID = committed.SourceItemID
	if err := f.server.DB.Create(&claim).Error; err != nil {
		t.Fatal(err)
	}
	if result, err := read(key, op.ID, f.stage.StageID); err != nil ||
		result.OperationID != claim.OperationID ||
		result.State != meta.LocalPushFileTerminalPhysicalCommit ||
		result.NodeID != committed.NodeID {
		t.Fatalf("private SQL correlation failed exact replay: %+v %v", result, err)
	}
	if raw, err := json.Marshal(claim); err != nil || string(raw) != "{}" {
		t.Fatalf("private terminal escaped through JSON: %s %v", raw, err)
	}
	badKey := append([]byte(nil), key...)
	badKey[0] ^= 0x01
	for _, input := range []struct {
		key   []byte
		id    string
		stage string
	}{
		{badKey, op.ID, f.stage.StageID},
		{key, uuid.NewString(), f.stage.StageID},
		{key, op.ID, uuid.NewString()},
	} {
		if result, err := read(input.key, input.id, input.stage); err == nil ||
			result != (meta.LocalPushFileTerminal{}) {
			t.Fatalf("foreign selector read file terminal: %+v %v", result, err)
		}
	}
	if err := f.server.DB.Model(&meta.LocalPushFileTerminal{}).
		Where("operation_id = ?", op.ID).
		Update("content_sha256", strings.Repeat("f", 64)).Error; err != nil {
		t.Fatal(err)
	}
	if result, err := read(key, op.ID, f.stage.StageID); err == nil ||
		result != (meta.LocalPushFileTerminal{}) {
		t.Fatalf("poisoned content correlation read as terminal: %+v %v", result, err)
	}
	var runs int64
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("read-only terminal created fake backup success: %d %v", runs, err)
	}
}

func TestLocalPushFileTerminalUniqueDecisionAndExistingWriterEmbargo(t *testing.T) {
	f, key, op := makeLocalPushBoundFirstLeafFixture(t)
	claim := testLocalPushFileTerminal(op, f.stage.StageID)
	if err := f.server.DB.Transaction(func(tx *gorm.DB) error {
		if err := f.server.validateCurrentLocalPushWriterFenceTx(
			tx, f.ctx, f.source.ID, f.source.Revision, key, op.ID, op.Generation,
		); err != nil {
			return err
		}
		return requireLocalPushFileTerminalVacantTx(tx, op.SourceID)
	}); err != nil {
		t.Fatalf("empty new schema unexpectedly blocked first-file writer: %v", err)
	}
	// Simulated future "cancel-quiesced" SQL decision only. The production
	// path never produces it before native quiescence is independently proven.
	if err := f.server.DB.Create(&claim).Error; err != nil {
		t.Fatal(err)
	}
	wrongOperation := claim
	wrongOperation.OperationID = uuid.NewString()
	if err := f.server.DB.Create(&wrongOperation).Error; err == nil {
		t.Fatal("same Stage/generation accepted competing file terminal")
	}
	wrongStage := claim
	wrongStage.StageID = uuid.NewString()
	wrongStage.OperationID = uuid.NewString()
	if err := f.server.DB.Create(&wrongStage).Error; err == nil {
		t.Fatal("same Source/generation accepted competing file terminal")
	}
	var terminals int64
	if err := f.server.DB.Model(&meta.LocalPushFileTerminal{}).
		Count(&terminals).Error; err != nil || terminals != 1 {
		t.Fatalf("immutable SQL terminal changed after conflict: %d %v", terminals, err)
	}
	if err := f.server.DB.Transaction(func(tx *gorm.DB) error {
		return f.server.validateCurrentLocalPushWriterFenceTx(
			tx, f.ctx, f.source.ID, f.source.Revision, key, op.ID, op.Generation)
	}); err == nil {
		t.Fatal("source with physical terminal reopened its first-file writer")
	}
	if duplicate, err := f.server.reserveBoundLocalPushOperationIntentWithKey(
		f.ctx, f.source.ID, f.source.Revision, key,
	); err == nil || duplicate.ID != "" {
		t.Fatalf("same-key reservation replay ignored a terminal: %+v %v", duplicate, err)
	}
	result, committed, err := f.server.commitBoundLocalPushFirstLeafWithCurrentOperation(
		f.ctx, f.source.ID, f.source.Revision, f.proof,
		f.stage.StageID, localPushFirstLeafFixtureName,
		key, op.ID, op.Generation)
	if err == nil || committed || result.NodeID != 0 || result.SourceItemID != 0 {
		t.Fatalf("terminal raced past existing real writer: %+v %t %v", result, committed, err)
	}
	var items, runs int64
	if err := f.server.DB.Model(&meta.SourceItem{}).Count(&items).Error; err != nil || items != 0 {
		t.Fatalf("denied writer created SourceItem: %d %v", items, err)
	}
	if err := f.server.DB.Model(&meta.SyncRun{}).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("denied writer created a backup Run: %d %v", runs, err)
	}
}

func TestLocalPushFileTerminalMissingSchemaFailsClosed(t *testing.T) {
	f := makeLocalOperationFixture(t)
	s := &Server{DB: f.primary}
	key := bytes.Repeat([]byte{0x62}, localPushOperationRequestKeySize)
	op, err := s.reserveBoundLocalPushOperationIntentWithKey(
		f.owningRequest(), f.source.ID, f.source.Revision, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.primary.Migrator().DropTable(&meta.LocalPushFileTerminal{}); err != nil {
		t.Fatal(err)
	}
	if err := f.primary.Transaction(func(tx *gorm.DB) error {
		return s.validateCurrentLocalPushWriterFenceTx(
			tx, f.owningRequest(), f.source.ID, f.source.Revision,
			key, op.ID, op.Generation)
	}); err == nil {
		t.Fatal("missing physical-terminal migration allowed a real writer")
	}
	if row, err := s.reserveBoundLocalPushOperationIntentWithKey(
		f.owningRequest(), f.source.ID, f.source.Revision, key,
	); err == nil || row.ID != "" {
		t.Fatalf("missing file terminal migration allowed same-key replay: %+v %v", row, err)
	}
	var intents, runs int64
	if err := f.primary.Model(&meta.LocalPushOperationIntent{}).Count(&intents).Error; err != nil || intents != 1 {
		t.Fatalf("failed schema changed Operation history: %d %v", intents, err)
	}
	if err := f.primary.Model(&meta.SyncRun{}).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("missing schema invented backup completion: %d %v", runs, err)
	}
}

// Two genuine PostgreSQL connection pools must serialize the future
// physical-terminal insert against an existing held writer-operation lock.
// Synthetic rows exist ONLY in this regression, never in a production API.
func TestLocalPushFileTerminalTwoPoolWriterLockOrder(t *testing.T) {
	f := makeLocalOperationFixture(t)
	s := &Server{DB: f.primary}
	key := bytes.Repeat([]byte{0x67}, localPushOperationRequestKeySize)
	op, err := s.reserveBoundLocalPushOperationIntentWithKey(
		f.owningRequest(), f.source.ID, f.source.Revision, key)
	if err != nil {
		t.Fatal(err)
	}
	held := make(chan struct{})
	release := make(chan struct{})
	writerResult := make(chan error, 1)
	go func() {
		writerResult <- f.primary.Transaction(func(tx *gorm.DB) error {
			if err := s.validateCurrentLocalPushWriterFenceTx(
				tx, f.owningRequest(), f.source.ID, f.source.Revision,
				key, op.ID, op.Generation); err != nil {
				return err
			}
			close(held)
			<-release
			return s.validateCurrentLocalPushWriterFenceTx(
				tx, f.owningRequest(), f.source.ID, f.source.Revision,
				key, op.ID, op.Generation)
		})
	}()
	select {
	case <-held:
	case err := <-writerResult:
		t.Fatalf("could not acquire real writer lock: %v", err)
	case <-time.After(10 * time.Second):
		close(release)
		t.Fatal("writer never acquired operation lock")
	}
	terminalResult := make(chan error, 1)
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		terminalResult <- f.replica.Transaction(func(tx *gorm.DB) error {
			var current meta.LocalPushOperationIntent
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("id = ?", op.ID).Take(&current).Error; err != nil {
				return err
			}
			claim := testLocalPushFileTerminal(current, uuid.NewString())
			return tx.Create(&claim).Error
		})
	}()
	select {
	case err := <-terminalResult:
		close(release)
		t.Fatalf("terminal passed a held writer operation lock: %v", err)
	case <-time.After(200 * time.Millisecond):
		// Expected: future decision cannot pass the original operation lock.
	}
	close(release)
	select {
	case err := <-writerResult:
		if err != nil {
			t.Fatalf("held writer lost original scope before SQL COMMIT: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("held writer never released SQL lock")
	}
	wg.Wait()
	select {
	case err := <-terminalResult:
		if err != nil {
			t.Fatalf("future SQL terminal could not linearize after writer: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("terminal insert did not complete after writer released")
	}
	if err := f.primary.Transaction(func(tx *gorm.DB) error {
		return s.validateCurrentLocalPushWriterFenceTx(
			tx, f.owningRequest(), f.source.ID, f.source.Revision,
			key, op.ID, op.Generation)
	}); err == nil {
		t.Fatal("writer reopened after separately committed file terminal")
	}
	var runs int64
	if err := f.primary.Model(&meta.SyncRun{}).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("SQL-only two-pool fixture fabricated a SourceRun: %d %v", runs, err)
	}
}

func TestLocalPushFileTerminalReadIsSQLTransactionOnly(t *testing.T) {
	f := makeLocalOperationFixture(t)
	if err := requireLocalPushFileTerminalVacantTx(f.primary, f.source.ID); err == nil {
		t.Fatal("plain DB query incorrectly accepted as retained physical terminal fence")
	}
}
