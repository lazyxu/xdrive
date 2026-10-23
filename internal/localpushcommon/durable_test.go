package localpushcommon

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
)

type fakeDurableTransport struct {
	events    []string
	plans     map[string]client.LocalPushCommonUploadInput
	states    map[string]string
	ids       map[string]uint64
	failAt    int
	lostACKAt int
	uploaded  int
}

func (f *fakeDurableTransport) init() {
	if f.plans == nil {
		f.plans = make(map[string]client.LocalPushCommonUploadInput)
		f.states = make(map[string]string)
		f.ids = make(map[string]uint64)
	}
}
func (f *fakeDurableTransport) AdmitLocalPushCommonUpload(_ context.Context, source, revision uint64,
	_ client.LocalBoundSourceProof, in client.LocalPushCommonUploadInput,
) (client.LocalPushCommonUploadStatus, error) {
	f.init()
	f.events = append(f.events, "admit")
	if prior, ok := f.plans[in.OperationID]; ok {
		if prior.ResumeKey != in.ResumeKey || prior.SHA256 != in.SHA256 ||
			prior.Size != in.Size {
			return client.LocalPushCommonUploadStatus{}, ErrUncertain
		}
	} else {
		f.plans[in.OperationID] = in
		f.states[in.OperationID] = "reserved"
		f.ids[in.OperationID] = uint64(100 + len(f.plans))
	}
	return client.LocalPushCommonUploadStatus{
		SourceID: source, Revision: revision, OperationID: in.OperationID,
		State: f.states[in.OperationID],
	}, nil
}
func (f *fakeDurableTransport) BindLocalPushCommonUpload(_ context.Context, source, revision uint64,
	_ client.LocalBoundSourceProof, operationID, key, sessionID string,
) (client.LocalPushCommonUploadStatus, error) {
	f.events = append(f.events, "bind")
	plan, exists := f.plans[operationID]
	if !exists || plan.ResumeKey != key || sessionID == "" {
		return client.LocalPushCommonUploadStatus{}, ErrUncertain
	}
	f.states[operationID] = "bound"
	return client.LocalPushCommonUploadStatus{
		SourceID: source, Revision: revision, OperationID: operationID, State: "bound",
	}, nil
}
func (f *fakeDurableTransport) ReadLocalPushCommonUploadReceipt(_ context.Context, source, revision uint64,
	_ client.LocalBoundSourceProof, operationID, key string,
) (client.LocalPushCommonUploadReceipt, error) {
	f.events = append(f.events, "read")
	plan, ok := f.plans[operationID]
	if !ok || plan.ResumeKey != key {
		return client.LocalPushCommonUploadReceipt{}, ErrUncertain
	}
	got := client.LocalPushCommonUploadReceipt{
		SourceID: source, Revision: revision, OperationID: operationID,
		State: f.states[operationID],
	}
	if got.State == "committed" {
		got.Committed = true
		got.NodeID = f.ids[operationID]
		got.NodeRevision = 1
		if plan.NodeID != nil {
			got.NodeID = *plan.NodeID
			got.NodeRevision = plan.ExpectedRevision + 1
		}
		got.ContentSHA256 = plan.SHA256
		got.Size = plan.Size
	}
	return got, nil
}
func (f *fakeDurableTransport) UploadStreamResumableVerifiedBoundResult(
	ctx context.Context, in client.UploadInit, _ client.UploadStreamOpen,
	gate func(context.Context, client.UploadSession) error,
	_ client.UploadProgress,
) (client.UploadResult, error) {
	f.events = append(f.events, "start")
	var operationID string
	for id, item := range f.plans {
		if item.ResumeKey == in.ResumeKey {
			operationID = id
			break
		}
	}
	if operationID == "" {
		return client.UploadResult{}, ErrUncertain
	}
	session := client.UploadSession{ID: uuid.NewString(), Status: "active",
		ResumeKey: in.ResumeKey, SHA256: in.SHA256, Size: in.Size}
	if err := gate(ctx, session); err != nil {
		return client.UploadResult{}, err
	}
	f.uploaded++
	f.events = append(f.events, "ordinary-finalize")
	if f.failAt == f.uploaded {
		return client.UploadResult{}, errors.New("no authoritative result")
	}
	f.states[operationID] = "committed"
	if f.lostACKAt == f.uploaded {
		return client.UploadResult{}, errors.New("response lost after committed SQL")
	}
	plan := f.plans[operationID]
	nodeID := f.ids[operationID]
	revision := uint64(1)
	if plan.NodeID != nil {
		nodeID = *plan.NodeID
		revision = plan.ExpectedRevision + 1
	}
	return client.UploadResult{
		Node: client.Node{ID: nodeID, Type: "file", Size: in.Size,
			SHA256: in.SHA256, Revision: revision},
		SHA256: in.SHA256,
	}, nil
}

func durableProof(p Plan) client.LocalBoundSourceProof {
	return client.LocalBoundSourceProof{
		DeviceID: p.DeviceID, DeviceToken: "native-owning-agent-only",
		RootID: p.RootID, RootFingerprint: p.RootFingerprint,
	}
}
func durableOpener(context.Context, int64) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader("fixture")), nil
}

func TestDurableCommonUploadBindsBeforeOrdinaryFinalizeAndReadsOriginal(t *testing.T) {
	p := fixturePlan()
	f := &fakeDurableTransport{}
	original, err := UploadDurableOne(context.Background(), f, durableProof(p),
		Task{Plan: p, Open: durableOpener}, nil)
	if err != nil || !matchesDurableReceipt(p, original) {
		t.Fatalf("original committed result not verified: %+v %v", original, err)
	}
	if got := strings.Join(f.events, ","); got !=
		"admit,read,start,bind,ordinary-finalize,read" {
		t.Fatalf("wrong protocol order: %s", got)
	}
	// Restart/replay sees the original immutable committed result, without a
	// second generic upload or any original local file re-open.
	before := f.uploaded
	again, err := UploadDurableOne(context.Background(), f, durableProof(p), Task{Plan: p}, nil)
	if err != nil || again != original || f.uploaded != before {
		t.Fatalf("committed original was re-uploaded: %+v %v attempts=%d", again, err, f.uploaded)
	}
}

func TestDurableCommonUploadLostFinalizeACKUsesOnlyOriginalSQLReceipt(t *testing.T) {
	p := fixturePlan()
	f := &fakeDurableTransport{lostACKAt: 1}
	got, err := UploadDurableOne(context.Background(), f, durableProof(p),
		Task{Plan: p, Open: durableOpener}, nil)
	if err != nil || !matchesDurableReceipt(p, got) || f.uploaded != 1 {
		t.Fatalf("lost ACK duplicated original operation: %+v %v", got, err)
	}
}

func TestDurableCommonUploadUncertainStopsSecondFile(t *testing.T) {
	a := fixturePlan()
	b := fixturePlan()
	b.OperationID = uuid.NewString()
	b.RelativePath = "nested/second.txt"
	b.Target.Name = "second.txt"
	b.ContentSHA256 = strings.Repeat("d", 64)
	f := &fakeDurableTransport{failAt: 1}
	out, err := UploadDurableSerial(context.Background(), f, durableProof(a),
		[]Task{{Plan: a, Open: durableOpener}, {Plan: b, Open: durableOpener}})
	if !errors.Is(err, ErrUncertain) || len(out) != 0 || f.uploaded != 1 ||
		len(f.plans) != 1 {
		t.Fatalf("uncertain file A incorrectly admitted B: receipts=%d operations=%d calls=%d err=%v",
			len(out), len(f.plans), f.uploaded, err)
	}
}

func TestDurableCommonUploadCanTransportTwoDifferentCommittedFiles(t *testing.T) {
	a := fixturePlan()
	b := fixturePlan()
	b.OperationID = uuid.NewString()
	b.RelativePath = "nested/second.txt"
	b.Target.Name = "second.txt"
	b.ContentSHA256 = strings.Repeat("d", 64)
	f := &fakeDurableTransport{lostACKAt: 1}
	out, err := UploadDurableSerial(context.Background(), f, durableProof(a),
		[]Task{{Plan: a, Open: durableOpener}, {Plan: b, Open: durableOpener}})
	if err != nil || len(out) != 2 || f.uploaded != 2 ||
		!matchesDurableReceipt(a, out[0]) || !matchesDurableReceipt(b, out[1]) {
		t.Fatalf("common transport failed two independent files: %+v %v", out, err)
	}
}

func TestDurableCommonUploadScopeAndDuplicateValidationBeforeNetwork(t *testing.T) {
	a := fixturePlan()
	proof := durableProof(a)
	f := &fakeDurableTransport{}
	proof.RootID = uuid.NewString()
	if _, err := UploadDurableOne(context.Background(), f, proof,
		Task{Plan: a, Open: durableOpener}, nil); !errors.Is(err, ErrInvalidPlan) {
		t.Fatalf("wrong local Root was admitted: %v", err)
	}
	if len(f.events) != 0 {
		t.Fatal("untrusted Root reached Server")
	}
	_, err := UploadDurableSerial(context.Background(), f, durableProof(a),
		[]Task{{Plan: a, Open: durableOpener}, {Plan: a, Open: durableOpener}})
	if !errors.Is(err, ErrInvalidPlan) || len(f.events) != 0 {
		t.Fatalf("duplicate file operation touched network: %v %v", err, f.events)
	}
}
