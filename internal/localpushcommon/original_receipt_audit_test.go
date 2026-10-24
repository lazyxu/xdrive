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

type readOnlyOriginalProbe struct {
	calls int
	keys  []string
	read  func(int, string, string) (client.LocalPushCommonUploadReceipt, error)
}

func (p *readOnlyOriginalProbe) ReadLocalPushCommonUploadReceipt(
	_ context.Context, _, _ uint64, _ client.LocalBoundSourceProof,
	opID, key string,
) (client.LocalPushCommonUploadReceipt, error) {
	p.calls++
	p.keys = append(p.keys, opID+"/"+key)
	return p.read(p.calls, opID, key)
}

func committedOriginalTestReceipt(p Plan) client.LocalPushCommonUploadReceipt {
	result := client.LocalPushCommonUploadReceipt{
		SourceID: p.SourceID, Revision: p.SourceRevision,
		OperationID: p.OperationID, State: "committed", Committed: true,
		NodeID: 81, NodeRevision: 1, ContentSHA256: p.ContentSHA256, Size: p.Size,
	}
	if p.Target.NodeID != 0 {
		result.NodeID = p.Target.NodeID
		result.NodeRevision = p.Target.ExpectedRevision + 1
	}
	return result
}

func TestReadOnlyOriginalAuditProvesCommitWithoutAnyWriteInterface(t *testing.T) {
	p := fixturePlan()
	probe := &readOnlyOriginalProbe{read: func(_ int, opID, _ string) (client.LocalPushCommonUploadReceipt, error) {
		if opID != p.OperationID {
			t.Fatal("read another operation")
		}
		return committedOriginalTestReceipt(p), nil
	}}
	got, err := ReadVerifiedOriginalFileReceipts(context.Background(), probe,
		durableProof(p), p.SourceID, p.SourceRevision, []Plan{p})
	if err != nil || len(got) != 1 || got[0].Plan != p ||
		!matchesDurableReceipt(p, got[0].Receipt) || probe.calls != 1 {
		t.Fatalf("read-only original COMMIT audit failed closed: %+v %v calls=%d",
			got, err, probe.calls)
	}
	key, _ := p.ResumeKey()
	if !strings.HasSuffix(probe.keys[0], "/"+key) {
		t.Fatal("read-only inspection did not use the original resume key")
	}
}

func TestReadOnlyOriginalAuditLeavesPendingReservedAndBoundUncommitted(t *testing.T) {
	for _, state := range []string{"reserved", "bound"} {
		t.Run(state, func(t *testing.T) {
			p := fixturePlan()
			probe := &readOnlyOriginalProbe{read: func(_ int, _, _ string) (client.LocalPushCommonUploadReceipt, error) {
				return client.LocalPushCommonUploadReceipt{
					SourceID: p.SourceID, Revision: p.SourceRevision,
					OperationID: p.OperationID, State: state,
				}, nil
			}}
			got, err := ReadVerifiedOriginalFileReceipts(context.Background(), probe,
				durableProof(p), p.SourceID, p.SourceRevision, []Plan{p})
			if err != nil || len(got) != 1 || got[0].Receipt.Committed ||
				got[0].Receipt.State != state || probe.calls != 1 {
				t.Fatalf("pending original fabricated COMMIT: %+v %v", got, err)
			}
		})
	}
}

func TestReadOnlyOriginalAuditRejectsEntireMixedFileBeforeNetwork(t *testing.T) {
	p := fixturePlan()
	for name, mutate := range map[string]func(*Plan){
		"wrong_owner":         func(v *Plan) { v.OwnerSession = "other" },
		"foreign_path":        func(v *Plan) { v.RelativePath = "other/file.txt"; v.Target.Name = "file.txt" },
		"wrong_revision":      func(v *Plan) { v.SourceRevision++ },
		"wrong_scope":         func(v *Plan) { v.RootID = uuid.NewString() },
		"duplicate_operation": func(v *Plan) {},
	} {
		t.Run(name, func(t *testing.T) {
			bad := p
			mutate(&bad)
			probe := &readOnlyOriginalProbe{read: func(_ int, _, _ string) (client.LocalPushCommonUploadReceipt, error) {
				t.Fatal("invalid group contacted Server before validation")
				return client.LocalPushCommonUploadReceipt{}, nil
			}}
			got, err := ReadVerifiedOriginalFileReceipts(context.Background(), probe,
				durableProof(p), p.SourceID, p.SourceRevision, []Plan{p, bad})
			if !errors.Is(err, ErrUncertain) || len(got) != 0 || probe.calls != 0 {
				t.Fatalf("invalid group exposed partial or made network reads: %s %+v %v", name, got, err)
			}
		})
	}
}

func TestReadOnlyOriginalAuditFailsWholeGroupOnUntrustedReceipt(t *testing.T) {
	p := fixturePlan()
	second := p
	second.OperationID = uuid.NewString()
	// The two operations may represent successive revisions of the
	// SAME file; they still cannot be trusted if any result is unknown.
	second.Target = Target{NodeID: 81, ExpectedRevision: 1}
	variants := map[string]func(*client.LocalPushCommonUploadReceipt){
		"foreign_operation": func(r *client.LocalPushCommonUploadReceipt) { r.OperationID = uuid.NewString() },
		"foreign_source":    func(r *client.LocalPushCommonUploadReceipt) { r.SourceID++ },
		"forged_commit":     func(r *client.LocalPushCommonUploadReceipt) { r.Committed = false },
		"changed_hash":      func(r *client.LocalPushCommonUploadReceipt) { r.ContentSHA256 = strings.Repeat("d", 64) },
		"pending_with_node": func(r *client.LocalPushCommonUploadReceipt) {
			r.State = "bound"
			r.Committed = false
			r.NodeRevision = 0
			r.ContentSHA256 = ""
		},
		"unknown_state": func(r *client.LocalPushCommonUploadReceipt) { r.State = "cancelled" },
	}
	for name, mutate := range variants {
		t.Run(name, func(t *testing.T) {
			probe := &readOnlyOriginalProbe{read: func(call int, _, _ string) (client.LocalPushCommonUploadReceipt, error) {
				if call == 1 {
					return committedOriginalTestReceipt(p), nil
				}
				r := committedOriginalTestReceipt(second)
				mutate(&r)
				return r, nil
			}}
			got, err := ReadVerifiedOriginalFileReceipts(context.Background(), probe,
				durableProof(p), p.SourceID, p.SourceRevision, []Plan{p, second})
			if !errors.Is(err, ErrUncertain) || len(got) != 0 || probe.calls != 2 {
				t.Fatalf("%s allowed partly trusted group: %+v %v calls=%d", name, got, err, probe.calls)
			}
		})
	}
}

func TestReadOnlyOriginalAuditTransportRetryAndCancellation(t *testing.T) {
	p := fixturePlan()
	probe := &readOnlyOriginalProbe{read: func(call int, _, _ string) (client.LocalPushCommonUploadReceipt, error) {
		if call == 1 {
			return client.LocalPushCommonUploadReceipt{}, io.EOF
		}
		return committedOriginalTestReceipt(p), nil
	}}
	got, err := ReadVerifiedOriginalFileReceipts(context.Background(), probe,
		durableProof(p), p.SourceID, p.SourceRevision, []Plan{p})
	if err != nil || len(got) != 1 || probe.calls != 2 {
		t.Fatalf("one bounded transient read did not recover: %+v %v", got, err)
	}
	probe.calls = 0
	probe.read = func(_ int, _, _ string) (client.LocalPushCommonUploadReceipt, error) {
		return client.LocalPushCommonUploadReceipt{}, errors.New("403 owner revoked")
	}
	got, err = ReadVerifiedOriginalFileReceipts(context.Background(), probe,
		durableProof(p), p.SourceID, p.SourceRevision, []Plan{p})
	if !errors.Is(err, ErrUncertain) || len(got) != 0 || probe.calls != 1 {
		t.Fatalf("owner revoke retried an original: %+v %v calls=%d", got, err, probe.calls)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	probe.calls = 0
	got, err = ReadVerifiedOriginalFileReceipts(ctx, probe,
		durableProof(p), p.SourceID, p.SourceRevision, []Plan{p})
	if !errors.Is(err, ErrUncertain) || len(got) != 0 || probe.calls != 0 {
		t.Fatalf("cancelled read made a request or returned success: %+v %v", got, err)
	}
}
