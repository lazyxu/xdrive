package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/localpushrunner"
)

func TestG2c2d1OriginalPhysicalCommitWinsWithoutTerminalRequest(t *testing.T) {
	d, evidence := localPushPrivateReservationTerminalFixture(t)
	calls := 0
	got, err := classifyLocalPushPriorFirstLeafPrivate(
		context.Background(), evidence,
		func(context.Context) (localpushrunner.FirstLeafResult, error) {
			return localpushrunner.FirstLeafResult{Confirmed: true}, nil
		},
		func(context.Context) (localPushPrivateFirstLeafReservationTerminal, error) {
			calls++
			return localPushPrivateFirstLeafReservationTerminal{}, errors.New("unexpected SQL terminal")
		},
	)
	if err != nil || calls != 0 || got.state != localPushPriorPhysicalCommitObserved ||
		got.operationID != evidence.prepared.operationID ||
		got.generation != evidence.prepared.generation {
		t.Fatalf("physical COMMIT was not preferred: %+v %v calls=%d", got, err, calls)
	}
	if _, err := os.Lstat(evidence.claim); err != nil {
		t.Fatalf("physical observation retired the original Stage claim: %v", err)
	}
	key, err := loadLocalPushOperationRequestKey(d.configDir, d.requestScope)
	if err != nil || key != evidence.key {
		t.Fatal("physical observation changed the original OS secret")
	}
	if _, err := loadLocalPushPreparedReceipt(d.configDir, d.requestScope, key); err != nil {
		t.Fatal("physical observation discarded the original prepared UUID")
	}
	wire, err := json.Marshal(got)
	if err != nil || string(wire) != "{}" {
		t.Fatalf("private outcome reached JSON: %s %v", wire, err)
	}
}

func TestG2c2d1ReservationTerminalCannotBecomePhysicalCancel(t *testing.T) {
	_, evidence := localPushPrivateReservationTerminalFixture(t)
	for _, tc := range []struct {
		state    string
		expected string
	}{
		{"aborted", localPushPriorAbortedUnresolved},
		{"expired", localPushPriorExpiredUnresolved},
	} {
		t.Run(tc.state, func(t *testing.T) {
			var order []string
			got, err := classifyLocalPushPriorFirstLeafPrivate(
				context.Background(), evidence,
				func(context.Context) (localpushrunner.FirstLeafResult, error) {
					order = append(order, "physical")
					return localpushrunner.FirstLeafResult{Uncertain: true},
						localpushrunner.ErrUncertain
				},
				func(context.Context) (localPushPrivateFirstLeafReservationTerminal, error) {
					order = append(order, "reservation")
					return localPushPrivateFirstLeafReservationTerminal{
						operationID: evidence.prepared.operationID,
						generation:  evidence.prepared.generation,
						state:       tc.state,
						recordedAt:  time.Now().UTC(),
					}, nil
				},
			)
			if err != nil || got.state != tc.expected || len(order) != 2 ||
				order[0] != "physical" || order[1] != "reservation" ||
				got.operationID != evidence.prepared.operationID {
				t.Fatalf("reservation misclassified physical bytes: %+v %v order=%v", got, err, order)
			}
			if strings.Contains(got.state, "file_cancelled") ||
				strings.Contains(got.state, "backup_complete") {
				t.Fatal("reservation forged a durable file outcome")
			}
		})
	}
}

func TestG2c2d1AuthorityFailureNeverFallsBackToReservation(t *testing.T) {
	_, evidence := localPushPrivateReservationTerminalFixture(t)
	for _, tc := range []struct {
		name   string
		result localpushrunner.FirstLeafResult
		err    error
	}{
		{"access-denied", localpushrunner.FirstLeafResult{}, errLocalPushDriverDenied},
		{"network-error", localpushrunner.FirstLeafResult{}, errors.New("disconnect")},
		{"false-positive", localpushrunner.FirstLeafResult{Confirmed: true}, errors.New("unverified")},
		{"contradictory", localpushrunner.FirstLeafResult{Confirmed: true, Uncertain: true}, localpushrunner.ErrUncertain},
		{"no-evidence", localpushrunner.FirstLeafResult{}, nil},
		{"missing-error", localpushrunner.FirstLeafResult{Uncertain: true}, nil},
		{"missing-uncertain", localpushrunner.FirstLeafResult{}, localpushrunner.ErrUncertain},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			got, err := classifyLocalPushPriorFirstLeafPrivate(context.Background(), evidence,
				func(context.Context) (localpushrunner.FirstLeafResult, error) {
					return tc.result, tc.err
				},
				func(context.Context) (localPushPrivateFirstLeafReservationTerminal, error) {
					calls++
					return localPushPrivateFirstLeafReservationTerminal{}, nil
				},
			)
			if !errors.Is(err, errLocalPushDriverDenied) ||
				got != (localPushPriorFirstLeafOutcome{}) || calls != 0 {
				t.Fatalf("untrusted physical result fell back to terminal: %+v %v calls=%d", got, err, calls)
			}
		})
	}
}

func TestG2c2d1ForeignOrUnavailableReservationKeepsOutcomeUnknown(t *testing.T) {
	_, evidence := localPushPrivateReservationTerminalFixture(t)
	base := localPushPrivateFirstLeafReservationTerminal{
		operationID: evidence.prepared.operationID,
		generation:  evidence.prepared.generation,
		state:       "aborted",
		recordedAt:  time.Now().UTC(),
	}
	invalid := []localPushPrivateFirstLeafReservationTerminal{
		{operationID: uuid.NewString(), generation: base.generation, state: base.state, recordedAt: base.recordedAt},
		{operationID: base.operationID, generation: base.generation + 1, state: base.state, recordedAt: base.recordedAt},
		{operationID: base.operationID, generation: base.generation, state: "reserved", recordedAt: base.recordedAt},
		{operationID: base.operationID, generation: base.generation, state: "committed", recordedAt: base.recordedAt},
		{operationID: base.operationID, generation: base.generation, state: base.state},
		{operationID: base.operationID, generation: base.generation, state: base.state,
			recordedAt: base.recordedAt.In(time.FixedZone("untrusted-utc", 0))},
	}
	for _, receipt := range invalid {
		got, err := classifyLocalPushPriorFirstLeafPrivate(context.Background(), evidence,
			func(context.Context) (localpushrunner.FirstLeafResult, error) {
				return localpushrunner.FirstLeafResult{Uncertain: true}, localpushrunner.ErrUncertain
			},
			func(context.Context) (localPushPrivateFirstLeafReservationTerminal, error) {
				return receipt, nil
			},
		)
		if !errors.Is(err, localpushrunner.ErrUncertain) ||
			got != (localPushPriorFirstLeafOutcome{}) {
			t.Fatalf("foreign reservation was trusted: %+v %v", got, err)
		}
	}
	got, err := classifyLocalPushPriorFirstLeafPrivate(context.Background(), evidence,
		func(context.Context) (localpushrunner.FirstLeafResult, error) {
			return localpushrunner.FirstLeafResult{Uncertain: true}, localpushrunner.ErrUncertain
		},
		func(context.Context) (localPushPrivateFirstLeafReservationTerminal, error) {
			return base, errors.New("lost terminal ACK")
		},
	)
	if !errors.Is(err, localpushrunner.ErrUncertain) || got != (localPushPriorFirstLeafOutcome{}) {
		t.Fatalf("lost ACK became a physical cancel: %+v %v", got, err)
	}
}

func TestG2c2d1CancellationBeforeAndAfterNetworkNeverConfirms(t *testing.T) {
	_, evidence := localPushPrivateReservationTerminalFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	calls := 0
	got, err := classifyLocalPushPriorFirstLeafPrivate(ctx, evidence,
		func(context.Context) (localpushrunner.FirstLeafResult, error) {
			calls++
			return localpushrunner.FirstLeafResult{Confirmed: true}, nil
		},
		func(context.Context) (localPushPrivateFirstLeafReservationTerminal, error) {
			calls++
			return localPushPrivateFirstLeafReservationTerminal{}, nil
		},
	)
	if err == nil || got != (localPushPriorFirstLeafOutcome{}) || calls != 0 {
		t.Fatalf("canceled caller reached private callbacks: %+v %v %d", got, err, calls)
	}
	ctx, cancel = context.WithCancel(context.Background())
	got, err = classifyLocalPushPriorFirstLeafPrivate(ctx, evidence,
		func(context.Context) (localpushrunner.FirstLeafResult, error) {
			cancel()
			return localpushrunner.FirstLeafResult{Confirmed: true}, nil
		},
		func(context.Context) (localPushPrivateFirstLeafReservationTerminal, error) {
			calls++
			return localPushPrivateFirstLeafReservationTerminal{}, nil
		},
	)
	if err == nil || got != (localPushPriorFirstLeafOutcome{}) || calls != 0 {
		t.Fatalf("late cancellation falsely confirmed physical work: %+v %v %d", got, err, calls)
	}
	ctx, cancel = context.WithCancel(context.Background())
	got, err = classifyLocalPushPriorFirstLeafPrivate(ctx, evidence,
		func(context.Context) (localpushrunner.FirstLeafResult, error) {
			return localpushrunner.FirstLeafResult{Uncertain: true}, localpushrunner.ErrUncertain
		},
		func(context.Context) (localPushPrivateFirstLeafReservationTerminal, error) {
			cancel()
			return localPushPrivateFirstLeafReservationTerminal{
				operationID: evidence.prepared.operationID,
				generation:  evidence.prepared.generation,
				state:       "expired", recordedAt: time.Now().UTC(),
			}, nil
		},
	)
	if err == nil || got != (localPushPriorFirstLeafOutcome{}) {
		t.Fatalf("canceled terminal reply confirmed original work: %+v %v", got, err)
	}
}

func TestG2c2d1RecheckEntireOriginalStageIdentity(t *testing.T) {
	d, evidence := localPushPrivateReservationTerminalFixture(t)
	if !localPushSamePriorFirstLeafEvidence(evidence, evidence) {
		t.Fatal("identical persistent original was not recognized")
	}
	other := evidence
	other.prepared.generation++
	if localPushSamePriorFirstLeafEvidence(evidence, other) {
		t.Fatal("new generation replaced original")
	}
	other = evidence
	other.hint.Stage.StageID = uuid.NewString()
	if localPushSamePriorFirstLeafEvidence(evidence, other) {
		t.Fatal("different Stage replaced original")
	}
	other = evidence
	other.hint.RelativePath = "replaced.jpg"
	if localPushSamePriorFirstLeafEvidence(evidence, other) {
		t.Fatal("different native original replaced Stage")
	}
	if d.localPushPriorEvidenceUnchanged(context.Background(), evidence) != nil {
		t.Fatal("unchanged original evidence was destroyed")
	}
	if _, err := os.Lstat(evidence.claim); err != nil {
		t.Fatal("outcome classification deleted original Stage claim")
	}
}

func TestG2c2d1NoPublicExecutorAndNoCredentialRetirement(t *testing.T) {
	b, err := os.ReadFile("device_backup_local_prior_outcome_g2c2d1.go")
	if err != nil {
		t.Fatal(err)
	}
	src := string(b)
	for _, unsafe := range []string{
		"StageVerifiedNativeOriginalBytes(", "mintLocalPushOperationRequestKey(",
		"PrepareLocalPushOperation(", "BindLocalPushOperationStage(",
		"CommitLocalPushFirstLeafWithOperation(", "os.Remove(",
		"secretstore.Delete(", "DeleteLocalSource(", "BeginSourceRun(",
	} {
		if strings.Contains(src, unsafe) {
			t.Fatalf("original status handler added forbidden mutation %q", unsafe)
		}
	}
	for _, gate := range []string{
		"localFolderGrantMu.TryLock()", "readPriorFirstLeafOriginalEvidence(",
		"d.recoverPreviousFirstLeafReadOnly(", "d.inspectPreviousFirstLeafReservationTerminalPrivate(",
	} {
		if !strings.Contains(src, gate) {
			t.Fatalf("original status handler bypassed owning Agent gate %q", gate)
		}
	}
	for _, path := range []string{"desktop_ipc.go", "desktop_ipc_device_backup_config.go"} {
		ipc, err := os.ReadFile(filepath.Clean(path))
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(ipc), "inspectLocalPushPriorFirstLeafOutcomePrivate") {
			t.Fatal("private terminal observer escaped into Desktop IPC")
		}
	}
}
