package localpushrunner

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
)

const uuid1 = "11111111-1111-4111-8111-111111111111"
const uuid2 = "22222222-2222-4222-8222-222222222222"
const uuid3 = "33333333-3333-4333-8333-333333333333"

func request() Scope {
	return Scope{Server: "https://server.test", Account: "alice", SessionID: "login-1",
		DeviceID: uuid1, RootID: uuid2,
		RootFingerprint: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		SourceID:        42, Revision: 3, TargetNodeID: 9, RelativePath: "dir/file.jpg",
		ContentSHA256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", Size: 1024}
}
func stage(s Scope) Staged {
	return Staged{StageID: uuid3, SourceID: s.SourceID, Revision: s.Revision, ContentSHA256: s.ContentSHA256, Size: s.Size}
}
func op(s Scope) Operation {
	return Operation{ID: uuid1, Generation: 1, SourceID: s.SourceID, Revision: s.Revision}
}
func proof(s Scope) CommitProof {
	return CommitProof{StageID: uuid3, OperationID: uuid1, Generation: 1, SourceID: s.SourceID, Revision: s.Revision, NodeID: 8, SourceItemID: 12, ContentSHA256: s.ContentSHA256, Size: s.Size, DurableSQL: true, PhysicalCAS: true, NativeOriginal: true}
}

type testDriver struct {
	mu        sync.Mutex
	steps     []string
	check     func(context.Context, Scope) error
	stage     func(context.Context, Scope) (Staged, error)
	prepare   func(context.Context, Scope, Staged) (Operation, error)
	commit    func(context.Context, Scope, Staged, Operation) error
	reconcile func(context.Context, Scope, Staged, Operation) (CommitProof, error)
}

func (d *testDriver) record(s string) { d.mu.Lock(); d.steps = append(d.steps, s); d.mu.Unlock() }
func (d *testDriver) Check(ctx context.Context, s Scope) error {
	d.record("check")
	if d.check != nil {
		return d.check(ctx, s)
	}
	return nil
}
func (d *testDriver) Stage(ctx context.Context, s Scope) (Staged, error) {
	d.record("stage")
	if d.stage != nil {
		return d.stage(ctx, s)
	}
	return stage(s), nil
}
func (d *testDriver) Prepare(ctx context.Context, s Scope, t Staged) (Operation, error) {
	d.record("prepare")
	if d.prepare != nil {
		return d.prepare(ctx, s, t)
	}
	return op(s), nil
}
func (d *testDriver) Commit(ctx context.Context, s Scope, t Staged, o Operation) error {
	d.record("commit")
	if d.commit != nil {
		return d.commit(ctx, s, t, o)
	}
	return nil
}
func (d *testDriver) Reconcile(ctx context.Context, s Scope, t Staged, o Operation) (CommitProof, error) {
	d.record("reconcile")
	if d.reconcile != nil {
		return d.reconcile(ctx, s, t, o)
	}
	return proof(s), nil
}
func (d *testDriver) stepsCopy() []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]string(nil), d.steps...)
}

func TestBoundedFirstLeafSuccessNeverSaysBackupComplete(t *testing.T) {
	s := request()
	d := &testDriver{}
	r := &Runner{}
	got, err := r.RunFirstLeaf(context.Background(), s, d)
	if err != nil || !got.Confirmed || got.Uncertain {
		t.Fatalf("%+v %v", got, err)
	}
	want := []string{"check", "stage", "check", "prepare", "commit", "reconcile"}
	actual := d.stepsCopy()
	if len(actual) != len(want) {
		t.Fatalf("steps %v", actual)
	}
	for i := range want {
		if want[i] != actual[i] {
			t.Fatalf("steps %v", actual)
		}
	}
	for _, v := range []any{s, stage(s), op(s), proof(s), got} {
		jsonBytes, err := json.Marshal(v)
		if err != nil || string(jsonBytes) != "{}" {
			t.Fatalf("leaked private JSON: %s %v", jsonBytes, err)
		}
	}
}
func TestFailClosedMismatchesNeverCommit(t *testing.T) {
	tests := []struct {
		name   string
		change func(*testDriver)
	}{
		{"stage-revision", func(d *testDriver) {
			d.stage = func(_ context.Context, s Scope) (Staged, error) { v := stage(s); v.Revision++; return v, nil }
		}},
		{"stage-sha", func(d *testDriver) {
			d.stage = func(_ context.Context, s Scope) (Staged, error) {
				v := stage(s)
				v.ContentSHA256 = "false"
				return v, nil
			}
		}},
		{"operation-generation", func(d *testDriver) {
			d.prepare = func(_ context.Context, s Scope, _ Staged) (Operation, error) {
				v := op(s)
				v.Generation = 0
				return v, nil
			}
		}},
		{"post-stage-owner-check", func(d *testDriver) {
			n := 0
			d.check = func(context.Context, Scope) error {
				n++
				if n == 2 {
					return errors.New("revoked")
				}
				return nil
			}
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			d := &testDriver{}
			test.change(d)
			got, err := (&Runner{}).RunFirstLeaf(context.Background(), request(), d)
			if err == nil || got.Confirmed {
				t.Fatalf("unsafe success: %+v %v", got, err)
			}
			for _, s := range d.stepsCopy() {
				if s == "commit" {
					t.Fatal("committed despite invalid preflight")
				}
			}
		})
	}
}
func TestCommitAmbiguityNoRetryOrFalseCancellation(t *testing.T) {
	for _, tc := range []struct {
		name          string
		commitErr     error
		readErr       error
		mismatch      bool
		shouldConfirm bool
	}{
		{"lost-ack-with-verified-commit", errors.New("lost response"), nil, false, true},
		{"success-ack-without-proof", nil, errors.New("missing SQL"), false, false},
		{"mismatched-provenance", nil, nil, true, false},
		{"commit-rejected-unknown-outcome", errors.New("unavailable"), errors.New("unknown"), false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			d := &testDriver{commit: func(context.Context, Scope, Staged, Operation) error { return tc.commitErr }}
			d.reconcile = func(_ context.Context, s Scope, _ Staged, _ Operation) (CommitProof, error) {
				v := proof(s)
				if tc.mismatch {
					v.PhysicalCAS = false
				}
				return v, tc.readErr
			}
			got, err := (&Runner{}).RunFirstLeaf(context.Background(), request(), d)
			if got.Confirmed != tc.shouldConfirm || got.Uncertain == tc.shouldConfirm {
				t.Fatalf("outcome %+v %v", got, err)
			}
			if !tc.shouldConfirm && !errors.Is(err, ErrUncertain) {
				t.Fatalf("missing uncertainty: %v", err)
			}
			if len(d.stepsCopy()) != 6 {
				t.Fatalf("unexpected auto retry: %v", d.stepsCopy())
			}
		})
	}
}
func TestCancellationAfterCommitStillReconcilesOnFreshContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	d := &testDriver{commit: func(context.Context, Scope, Staged, Operation) error { cancel(); return context.Canceled }}
	d.reconcile = func(readCtx context.Context, s Scope, _ Staged, _ Operation) (CommitProof, error) {
		if readCtx.Err() != nil {
			return CommitProof{}, errors.New("reconciliation inherited canceled context")
		}
		return proof(s), nil
	}
	got, err := (&Runner{}).RunFirstLeaf(ctx, request(), d)
	if err != nil || !got.Confirmed {
		t.Fatalf("lost committed file under cancellation: %+v %v", got, err)
	}
}
func TestCancellationBeforeCommitDoesNotInvokeWriter(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	d := &testDriver{stage: func(_ context.Context, s Scope) (Staged, error) { cancel(); return stage(s), nil }}
	got, err := (&Runner{}).RunFirstLeaf(ctx, request(), d)
	if !errors.Is(err, context.Canceled) || got.Confirmed {
		t.Fatalf("unsafe response: %+v %v", got, err)
	}
	for _, s := range d.stepsCopy() {
		if s == "commit" || s == "prepare" {
			t.Fatal("prepared/committed after cancellation")
		}
	}
}
func TestSourceSerialAndIndependentSourceAllowed(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	d := &testDriver{stage: func(_ context.Context, s Scope) (Staged, error) {
		if s.SourceID == 42 {
			close(entered)
			<-release
		}
		return stage(s), nil
	}}
	r := &Runner{}
	firstResult := make(chan error, 1)
	go func() { _, err := r.RunFirstLeaf(context.Background(), request(), d); firstResult <- err }()
	<-entered
	if _, err := r.RunFirstLeaf(context.Background(), request(), d); !errors.Is(err, ErrAlreadyRunning) {
		t.Fatalf("same-source duplicate admitted: %v", err)
	}
	different := request()
	different.SourceID = 43
	got, err := r.RunFirstLeaf(context.Background(), different, d)
	if err != nil || !got.Confirmed {
		t.Fatalf("different source stalled: %+v %v", got, err)
	}
	close(release)
	if err := <-firstResult; err != nil {
		t.Fatal(err)
	}
}
func TestDurablePrepareQuarantinesSecondAttempt(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r := &Runner{}
	d := &testDriver{prepare: func(_ context.Context, s Scope, _ Staged) (Operation, error) { cancel(); return op(s), nil }}
	got, err := r.RunFirstLeaf(ctx, request(), d)
	if !got.Uncertain || got.Confirmed || !errors.Is(err, ErrUncertain) ||
		!errors.Is(err, context.Canceled) {
		t.Fatalf("durably prepared cancellation did not remain uncertain: %+v %v", got, err)
	}
	if _, err = r.RunFirstLeaf(context.Background(), request(), &testDriver{}); !errors.Is(err, ErrQuarantined) {
		t.Fatalf("reused uncertain request key: %v", err)
	}
}
func TestLostPrepareReplyQuarantinesBeforeHTTPAck(t *testing.T) {
	r := &Runner{}
	d := &testDriver{prepare: func(context.Context, Scope, Staged) (Operation, error) {
		return Operation{}, errors.New("server may have persisted reservation")
	}}
	if got, err := r.RunFirstLeaf(context.Background(), request(), d); !got.Uncertain ||
		got.Confirmed || !errors.Is(err, ErrUncertain) {
		t.Fatalf("lost Prepare ACK misclassified as definite failure: %+v %v", got, err)
	}
	if _, err := r.RunFirstLeaf(context.Background(), request(), &testDriver{}); !errors.Is(err, ErrQuarantined) {
		t.Fatalf("new operation admitted after lost prepare ACK: %v", err)
	}
	for _, s := range d.stepsCopy() {
		if s == "commit" {
			t.Fatal("commit ran without verified prepare")
		}
	}
}

func TestPreparedOperationMismatchNeverCommitsOrUnquarantines(t *testing.T) {
	r := &Runner{}
	d := &testDriver{prepare: func(_ context.Context, s Scope, _ Staged) (Operation, error) {
		prepared := op(s)
		prepared.Generation = 0
		return prepared, nil
	}}
	got, err := r.RunFirstLeaf(context.Background(), request(), d)
	if !got.Uncertain || got.Confirmed || !errors.Is(err, ErrUncertain) ||
		!errors.Is(err, ErrDenied) {
		t.Fatalf("invalid returned Operation treated as safe retry: %+v %v", got, err)
	}
	for _, step := range d.stepsCopy() {
		if step == "commit" || step == "reconcile" {
			t.Fatalf("invalid Operation reached unsafe step: %v", d.stepsCopy())
		}
	}
	if _, err := r.RunFirstLeaf(context.Background(), request(), &testDriver{}); !errors.Is(err, ErrQuarantined) {
		t.Fatalf("new generation admitted after invalid Prepare: %v", err)
	}
}

func TestPrepareCanceledAfterReservationReportsUncertainWithoutCommit(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r := &Runner{}
	d := &testDriver{prepare: func(_ context.Context, s Scope, _ Staged) (Operation, error) {
		cancel()
		return op(s), nil
	}}
	got, err := r.RunFirstLeaf(ctx, request(), d)
	if !got.Uncertain || got.Confirmed || !errors.Is(err, ErrUncertain) ||
		!errors.Is(err, context.Canceled) {
		t.Fatalf("cancel after durable Prepare was treated as definite failure: %+v %v", got, err)
	}
	for _, step := range d.stepsCopy() {
		if step == "commit" || step == "reconcile" {
			t.Fatalf("canceled prepared Operation reached unsafe step: %v", d.stepsCopy())
		}
	}
	if _, err := r.RunFirstLeaf(context.Background(), request(), &testDriver{}); !errors.Is(err, ErrQuarantined) {
		t.Fatalf("new generation admitted after Prepare cancellation: %v", err)
	}
}

func TestStageAdmissionUnknownQuarantinesBeforeOperationPrepare(t *testing.T) {
	r := &Runner{}
	upstream := errors.New("staging response lost after OS reservation")
	d := &testDriver{stage: func(context.Context, Scope) (Staged, error) {
		return Staged{}, errors.Join(ErrStageAdmissionUncertain, upstream)
	}}
	got, err := r.RunFirstLeaf(context.Background(), request(), d)
	if !got.Uncertain || got.Confirmed || !errors.Is(err, ErrUncertain) ||
		!errors.Is(err, ErrStageAdmissionUncertain) || !errors.Is(err, upstream) {
		t.Fatalf("durable Stage ambiguity was treated as a safe failure: %+v %v", got, err)
	}
	for _, step := range d.stepsCopy() {
		if step == "prepare" || step == "commit" || step == "reconcile" {
			t.Fatalf("unacknowledged Stage reached an unsafe step: %v", d.stepsCopy())
		}
	}
	if _, err := r.RunFirstLeaf(context.Background(), request(), &testDriver{}); !errors.Is(err, ErrQuarantined) {
		t.Fatalf("new Stage admitted after lost original Stage ACK: %v", err)
	}
}

func TestStagePreAdmissionFailureDoesNotPretendItWasDurable(t *testing.T) {
	r := &Runner{}
	upstream := errors.New("pre-admission Root unavailable")
	d := &testDriver{stage: func(context.Context, Scope) (Staged, error) {
		return Staged{}, upstream
	}}
	got, err := r.RunFirstLeaf(context.Background(), request(), d)
	if got.Uncertain || got.Confirmed || !errors.Is(err, upstream) || errors.Is(err, ErrUncertain) {
		t.Fatalf("definite pre-admission refusal was misclassified: %+v %v", got, err)
	}
	retry, err := r.RunFirstLeaf(context.Background(), request(), &testDriver{})
	if err != nil || !retry.Confirmed {
		t.Fatalf("definite pre-admission refusal permanently fenced retry: %+v %v", retry, err)
	}
}

func TestStagedOriginalCancellationAndBadReceiptStayQuarantined(t *testing.T) {
	for _, tc := range []string{"cancel-after-stage", "invalid-staged-receipt", "post-stage-revocation"} {
		t.Run(tc, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			r := &Runner{}
			d := &testDriver{}
			switch tc {
			case "cancel-after-stage":
				d.stage = func(_ context.Context, s Scope) (Staged, error) {
					cancel()
					return stage(s), nil
				}
			case "invalid-staged-receipt":
				d.stage = func(_ context.Context, s Scope) (Staged, error) {
					v := stage(s)
					v.ContentSHA256 = "different"
					return v, nil
				}
			case "post-stage-revocation":
				checks := 0
				d.check = func(context.Context, Scope) error {
					checks++
					if checks > 1 {
						return ErrDenied
					}
					return nil
				}
			}
			got, err := r.RunFirstLeaf(ctx, request(), d)
			if !got.Uncertain || got.Confirmed || !errors.Is(err, ErrUncertain) {
				t.Fatalf("%s lost durable Stage ambiguity: %+v %v", tc, got, err)
			}
			for _, step := range d.stepsCopy() {
				if step == "prepare" || step == "commit" || step == "reconcile" {
					t.Fatalf("%s advanced beyond uncertain Stage: %v", tc, d.stepsCopy())
				}
			}
			if _, err := r.RunFirstLeaf(context.Background(), request(), &testDriver{}); !errors.Is(err, ErrQuarantined) {
				t.Fatalf("%s admitted another native Stage: %v", tc, err)
			}
		})
	}
}

func TestRequestBoundsAndIdentity(t *testing.T) {
	s := request()
	for _, bad := range []func(*Scope){func(v *Scope) { v.SourceID = 0 }, func(v *Scope) { v.Revision = 0 }, func(v *Scope) { v.RootFingerprint = "not-a-hash" }, func(v *Scope) { v.Size = MaxFirstLeafBytes + 1 }, func(v *Scope) { v.ContentSHA256 = "BAD" }, func(v *Scope) { v.DeviceID = "invalid" }, func(v *Scope) { v.RelativePath = "" }, func(v *Scope) { v.RelativePath = "../escape" }, func(v *Scope) { v.RelativePath = "C:\\private" }, func(v *Scope) { v.Server = "host\nspoof" }} {
		t.Run("invalid", func(t *testing.T) {
			x := s
			bad(&x)
			d := &testDriver{}
			_, err := (&Runner{}).RunFirstLeaf(context.Background(), x, d)
			if !errors.Is(err, ErrInvalidRequest) || len(d.stepsCopy()) != 0 {
				t.Fatalf("invalid request invoked driver %v", err)
			}
		})
	}
}
