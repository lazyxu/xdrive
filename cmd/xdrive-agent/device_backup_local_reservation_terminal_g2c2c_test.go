package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushstage"
)

func localPushPrivateReservationTerminalFixture(t *testing.T) (
	*localPushFirstLeafDriver, localPushPrivateOriginalRecoveryEvidence,
) {
	t.Helper()
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")
	d, scope := localPushFirstLeafDriverFixture(t)
	secureLocalPushStageAdmissionTestConfig(t, d.configDir)
	ctx := context.Background()
	if err := reserveFreshLocalPushStageAdmission(
		ctx, d.configDir, d.requestScope, d.grant); err != nil {
		t.Fatal(err)
	}
	key, err := mintLocalPushOperationRequestKey(d.configDir, d.requestScope)
	if err != nil {
		t.Fatal(err)
	}
	prepared := client.LocalPushPreparedOperation{
		SourceID: scope.SourceID, Revision: scope.Revision,
		OperationID: uuid.NewString(), Generation: 1, State: "reserved",
	}
	if err := persistLocalPushPreparedReceipt(
		d.configDir, d.requestScope, key, prepared); err != nil {
		t.Fatal(err)
	}
	pathKey, err := localpush.LocalInventoryPathKey(d.grant, "file", scope.RelativePath)
	if err != nil {
		t.Fatal(err)
	}
	stage := localpushstage.LocalOriginalServerStage{
		SourceID: scope.SourceID, Revision: scope.Revision,
		StageID: uuid.NewString(), Size: scope.Size,
		SHA256:         scope.ContentSHA256,
		SnapshotSHA256: strings.Repeat("b", 64), CurrentPathKey: pathKey,
	}
	if err := localpushstage.SaveLocalOriginalRecoveryHint(
		ctx, d.configDir, d.grant, stage, scope.RelativePath); err != nil {
		t.Fatal(err)
	}
	evidence, err := d.readPriorFirstLeafOriginalEvidence(ctx, scope)
	if err != nil || evidence.claim == "" ||
		evidence.key != key || evidence.prepared.operationID != prepared.OperationID ||
		evidence.hint.Stage != stage {
		t.Fatalf("exact previous operation not recovered: %+v %v", evidence, err)
	}
	return d, evidence
}

func TestG2c2cTerminalRequiresUnchangedPrivateStageAndOperation(t *testing.T) {
	d, evidence := localPushPrivateReservationTerminalFixture(t)
	ctx := context.Background()
	if err := d.localPushPriorEvidenceUnchanged(ctx, evidence); err != nil {
		t.Fatalf("genuine old private claim rejected: %v", err)
	}
	if err := os.WriteFile(
		evidence.claim, []byte("tampered-reservation"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := d.localPushPriorEvidenceUnchanged(ctx, evidence); err == nil {
		t.Fatal("modified Stage claim authorized a historical terminal")
	}
	if err := os.WriteFile(
		evidence.claim, []byte(localPushStageAdmissionClaimContents), 0o600); err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(evidence.claim, 0o644); err != nil {
			t.Fatal(err)
		}
		if err := d.localPushPriorEvidenceUnchanged(ctx, evidence); err == nil {
			t.Fatal("world-readable Stage claim authorized a terminal")
		}
		if err := os.Chmod(evidence.claim, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := d.localPushPriorEvidenceUnchanged(ctx, evidence); err != nil {
		t.Fatalf("same untouched original claim no longer verified: %v", err)
	}
}

func TestG2c2cTerminalDeniedByAmbiguousHistoricalStage(t *testing.T) {
	d, evidence := localPushPrivateReservationTerminalFixture(t)
	ctx := context.Background()
	other := evidence.hint.Stage
	other.StageID = uuid.NewString()
	if err := localpushstage.SaveLocalOriginalRecoveryHint(
		ctx, d.configDir, d.grant, other, d.scope.RelativePath); err != nil {
		t.Fatal(err)
	}
	if _, err := d.readPriorFirstLeafOriginalEvidence(ctx, d.scope); err == nil {
		t.Fatal("multiple historical Stages admitted a guessed latest operation")
	}
	if _, err := d.inspectPreviousFirstLeafReservationTerminalPrivate(
		ctx, d.scope); err == nil {
		t.Fatal("ambiguous Stage allowed terminal materialization")
	}
	if err := d.localPushPriorEvidenceUnchanged(ctx, evidence); err == nil {
		t.Fatal("late competing Stage was hidden behind previously selected hint")
	}
	if _, err := os.Lstat(evidence.claim); err != nil {
		t.Fatalf("denied terminal removed original claim: %v", err)
	}
	key, err := loadLocalPushOperationRequestKey(d.configDir, d.requestScope)
	if err != nil || key != evidence.key {
		t.Fatal("terminal observer rotated or discarded original OS key")
	}
	if _, err := loadLocalPushPreparedReceipt(
		d.configDir, d.requestScope, key); err != nil {
		t.Fatal("terminal observer discarded prepared UUID/generation")
	}
}

func TestG2c2cTerminalCannotInferPhysicalCancelFromReservation(t *testing.T) {
	d, evidence := localPushPrivateReservationTerminalFixture(t)
	base := client.LocalPushTerminalProof{
		SourceID: d.scope.SourceID, Revision: d.scope.Revision,
		OperationID: evidence.prepared.operationID,
		Generation:  evidence.prepared.generation,
		State:       "aborted", RecordedAt: time.Now().UTC(),
	}
	for _, state := range []string{"aborted", "expired"} {
		receipt := base
		receipt.State = state
		if !localPushFirstLeafReservationTerminalMatches(
			receipt, d.scope, evidence.prepared) {
			t.Fatalf("exact SQL reservation terminal %q rejected", state)
		}
	}
	for _, mutate := range []func(*client.LocalPushTerminalProof){
		func(r *client.LocalPushTerminalProof) { r.SourceID++ },
		func(r *client.LocalPushTerminalProof) { r.Revision++ },
		func(r *client.LocalPushTerminalProof) { r.OperationID = uuid.NewString() },
		func(r *client.LocalPushTerminalProof) { r.Generation++ },
		func(r *client.LocalPushTerminalProof) { r.State = "reserved" },
		func(r *client.LocalPushTerminalProof) { r.State = "committed" },
		func(r *client.LocalPushTerminalProof) { r.RecordedAt = time.Time{} },
		func(r *client.LocalPushTerminalProof) {
			r.RecordedAt = r.RecordedAt.In(time.FixedZone("fake-utc", 0))
		},
	} {
		receipt := base
		mutate(&receipt)
		if localPushFirstLeafReservationTerminalMatches(
			receipt, d.scope, evidence.prepared) {
			t.Fatalf("untrusted terminal accepted: %+v", receipt)
		}
	}
	var result localPushPrivateFirstLeafReservationTerminal
	wire, err := json.Marshal(result)
	if err != nil || string(wire) != "{}" {
		t.Fatalf("terminal leaked into IPC JSON: %q %v", wire, err)
	}
}

func TestG2c2cTerminalRequiresNativeOriginalAndPreservesClaims(t *testing.T) {
	d, evidence := localPushPrivateReservationTerminalFixture(t)
	// This fixture intentionally has a persisted Stage but no matching
	// original native file/journal. No SQL terminal request is permitted.
	out, err := d.inspectPreviousFirstLeafReservationTerminalPrivate(
		context.Background(), d.scope)
	if !errors.Is(err, errLocalPushDriverDenied) ||
		out != (localPushPrivateFirstLeafReservationTerminal{}) {
		t.Fatalf("unheld native original produced a terminal: %+v %v", out, err)
	}
	if err := d.localPushPriorEvidenceUnchanged(
		context.Background(), evidence); err != nil {
		t.Fatalf("failed native proof erased old evidence: %v", err)
	}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := d.inspectPreviousFirstLeafReservationTerminalPrivate(
		cancelled, d.scope); err == nil {
		t.Fatal("canceled caller observed a terminal")
	}
	if _, err := os.Lstat(evidence.claim); err != nil {
		t.Fatal("uncertain terminal operation removed Stage claim")
	}
}

func TestG2c2cTerminalHasNoNewUploaderOrPublicIPC(t *testing.T) {
	terminal, err := os.ReadFile("device_backup_local_reservation_terminal_g2c2c.go")
	if err != nil {
		t.Fatal(err)
	}
	previous, err := os.ReadFile("device_backup_local_recovery_g2c2b.go")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(previous), "readPriorFirstLeafOriginalEvidence(") ||
		!strings.Contains(string(terminal), "d.readPriorFirstLeafOriginalEvidence(ctx, s)") ||
		!strings.Contains(string(terminal), "WithHeldCurrentOriginalReadCheckpoint(") ||
		!strings.Contains(string(terminal), "ReadLocalPushTerminalProof(") {
		t.Fatal("terminal observer bypassed original private/native/server boundary")
	}
	for _, forbidden := range []string{
		"StageVerifiedNativeOriginalBytes(", "mintLocalPushOperationRequestKey(",
		"PrepareLocalPushOperation(", "BindLocalPushOperationStage(",
		"CommitLocalPushFirstLeafWithOperation(", "os.Remove(",
		"DeleteLocalSource(", "ActivateSource(",
	} {
		if strings.Contains(string(terminal), forbidden) {
			t.Fatalf("reservation observer introduced a write method %s", forbidden)
		}
	}
	for _, file := range []string{
		"desktop_ipc.go", "desktop_ipc_device_backup_config.go",
	} {
		b, err := os.ReadFile(filepath.Clean(file))
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(b), "inspectLocalPushFirstLeafReservationTerminalPrivate") {
			t.Fatal("Agent-private terminal query exposed on Desktop IPC")
		}
	}
}
