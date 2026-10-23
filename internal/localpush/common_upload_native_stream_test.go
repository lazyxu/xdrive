//go:build linux || windows

package localpush

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpushcommon"
)

type nativeCommonUploadProbe struct {
	plan       localpushcommon.Plan
	state      string
	admissions int
	binds      int
	byteOpens  int
	afterRead  func() error
}

func (p *nativeCommonUploadProbe) AdmitLocalPushCommonUpload(
	_ context.Context, sourceID, revision uint64,
	_ client.LocalBoundSourceProof, in client.LocalPushCommonUploadInput,
) (client.LocalPushCommonUploadStatus, error) {
	p.admissions++
	key, _ := p.plan.ResumeKey()
	if in.OperationID != p.plan.OperationID || in.ResumeKey != key ||
		in.SHA256 != p.plan.ContentSHA256 || in.Size != p.plan.Size ||
		sourceID != p.plan.SourceID || revision != p.plan.SourceRevision {
		return client.LocalPushCommonUploadStatus{}, errors.New("wrong original operation")
	}
	if p.state == "" {
		p.state = "reserved"
	}
	return client.LocalPushCommonUploadStatus{
		SourceID: sourceID, Revision: revision,
		OperationID: p.plan.OperationID, State: p.state,
	}, nil
}

func (p *nativeCommonUploadProbe) BindLocalPushCommonUpload(
	_ context.Context, sourceID, revision uint64,
	_ client.LocalBoundSourceProof, operationID, key, sessionID string,
) (client.LocalPushCommonUploadStatus, error) {
	p.binds++
	expectedKey, _ := p.plan.ResumeKey()
	if p.state != "reserved" || operationID != p.plan.OperationID ||
		key != expectedKey || sessionID == "" {
		return client.LocalPushCommonUploadStatus{}, errors.New("unsafe bind")
	}
	p.state = "bound"
	return client.LocalPushCommonUploadStatus{
		SourceID: sourceID, Revision: revision,
		OperationID: operationID, State: "bound",
	}, nil
}

func (p *nativeCommonUploadProbe) ReadLocalPushCommonUploadReceipt(
	_ context.Context, sourceID, revision uint64,
	_ client.LocalBoundSourceProof, operationID, key string,
) (client.LocalPushCommonUploadReceipt, error) {
	expectedKey, _ := p.plan.ResumeKey()
	if operationID != p.plan.OperationID || key != expectedKey {
		return client.LocalPushCommonUploadReceipt{}, errors.New("wrong receipt")
	}
	got := client.LocalPushCommonUploadReceipt{
		SourceID: sourceID, Revision: revision, OperationID: operationID,
		State: p.state,
	}
	if p.state == "committed" {
		got.Committed = true
		got.NodeID = 12345
		got.NodeRevision = 1
		got.ContentSHA256 = p.plan.ContentSHA256
		got.Size = p.plan.Size
	}
	return got, nil
}

func (p *nativeCommonUploadProbe) UploadStreamResumableVerifiedBoundResult(
	ctx context.Context, init client.UploadInit, open client.UploadStreamOpen,
	gate func(context.Context, client.UploadSession) error, _ client.UploadProgress,
) (client.UploadResult, error) {
	key, _ := p.plan.ResumeKey()
	if init.ResumeKey != key || init.SHA256 != p.plan.ContentSHA256 ||
		init.Size != p.plan.Size || init.ParentID == nil ||
		*init.ParentID != p.plan.Target.ParentID {
		return client.UploadResult{}, errors.New("bad ordinary upload Init")
	}
	if err := gate(ctx, client.UploadSession{
		ID: uuid.NewString(), Status: "active",
		ResumeKey: key, SHA256: p.plan.ContentSHA256, Size: p.plan.Size,
	}); err != nil {
		return client.UploadResult{}, err
	}
	stream, err := open(ctx, 0)
	if err != nil {
		return client.UploadResult{}, err
	}
	p.byteOpens++
	bytes, readErr := io.ReadAll(stream)
	closeErr := stream.Close()
	sum := sha256.Sum256(bytes)
	if readErr != nil || closeErr != nil || int64(len(bytes)) != p.plan.Size ||
		hex.EncodeToString(sum[:]) != p.plan.ContentSHA256 {
		return client.UploadResult{}, errors.New("native stream bytes are wrong")
	}
	p.state = "committed"
	if p.afterRead != nil {
		if err := p.afterRead(); err != nil {
			return client.UploadResult{}, err
		}
	}
	return client.UploadResult{}, nil
}

func nativeCommonProof(f commonPlanFixture) client.LocalBoundSourceProof {
	return client.LocalBoundSourceProof{
		DeviceID: f.grant.DeviceID, DeviceToken: "owning-agent-secret-in-memory",
		RootID: f.grant.RootID, RootFingerprint: f.grant.Fingerprint,
	}
}

func TestCommonNativeStreamHoldsOriginalUntilPosthashAndReplaysCommit(t *testing.T) {
	f := makeCommonPlanFixture(t)
	plan, err := prepareCommonFixture(t, f, "alpha.txt")
	if err != nil {
		t.Fatal(err)
	}
	transport := &nativeCommonUploadProbe{plan: plan}
	first, err := UploadVerifiedCommonNativeOne(context.Background(),
		f.config, f.grant, f.snap.SnapshotSHA256, plan, transport,
		nativeCommonProof(f), nil)
	if err != nil || !first.Committed || first.OperationID != plan.OperationID ||
		first.ContentSHA256 != plan.ContentSHA256 ||
		transport.admissions != 1 || transport.binds != 1 ||
		transport.byteOpens != 1 {
		t.Fatalf("native original file did not commit: %+v %+v %v", first, transport, err)
	}
	// An original committed SQL receipt is immutable. A repeat call with
	// the same journal and native file must NOT send another byte.
	second, err := UploadVerifiedCommonNativeOne(context.Background(),
		f.config, f.grant, f.snap.SnapshotSHA256, plan, transport,
		nativeCommonProof(f), nil)
	if err != nil || second.OperationID != plan.OperationID ||
		transport.admissions != 2 || transport.byteOpens != 1 {
		t.Fatalf("retry minted or uploaded another operation: %+v %+v %v", second, transport, err)
	}
}

func TestCommonNativeStreamRefusesMutatedBytesBeforeNetwork(t *testing.T) {
	f := makeCommonPlanFixture(t)
	plan, err := prepareCommonFixture(t, f, "alpha.txt")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(f.grant.Path, "alpha.txt"),
		[]byte("mutation-before-opening"), 0o600); err != nil {
		t.Fatal(err)
	}
	probe := &nativeCommonUploadProbe{plan: plan}
	_, err = UploadVerifiedCommonNativeOne(context.Background(),
		f.config, f.grant, f.snap.SnapshotSHA256, plan, probe,
		nativeCommonProof(f), nil)
	if !errors.Is(err, ErrCommonUploadPlanQuarantined) ||
		probe.admissions != 0 {
		t.Fatalf("changed local content initiated HTTP: %v %+v", err, probe)
	}
}

func TestCommonNativeStreamDoesNotAcknowledgeMidUploadMutation(t *testing.T) {
	f := makeCommonPlanFixture(t)
	plan, err := prepareCommonFixture(t, f, "alpha.txt")
	if err != nil {
		t.Fatal(err)
	}
	probe := &nativeCommonUploadProbe{plan: plan}
	probe.afterRead = func() error {
		return os.WriteFile(filepath.Join(f.grant.Path, "alpha.txt"),
			[]byte("changed-after-chunks"), 0o600)
	}
	_, err = UploadVerifiedCommonNativeOne(context.Background(),
		f.config, f.grant, f.snap.SnapshotSHA256, plan, probe,
		nativeCommonProof(f), nil)
	if !errors.Is(err, localpushcommon.ErrUncertain) ||
		probe.state != "committed" || probe.byteOpens != 1 {
		t.Fatalf("local mutation was acknowledged as stable: %v %+v", err, probe)
	}
}

func TestCommonNativeStreamRejectsForgedPlanAndForeignDeviceBeforeHTTP(t *testing.T) {
	f := makeCommonPlanFixture(t)
	plan, err := prepareCommonFixture(t, f, "alpha.txt")
	if err != nil {
		t.Fatal(err)
	}
	probe := &nativeCommonUploadProbe{plan: plan}
	forged := plan
	forged.OperationID = uuid.NewString()
	_, err = UploadVerifiedCommonNativeOne(context.Background(),
		f.config, f.grant, f.snap.SnapshotSHA256, forged, probe,
		nativeCommonProof(f), nil)
	if !errors.Is(err, ErrCommonUploadPlanQuarantined) || probe.admissions != 0 {
		t.Fatalf("unpersisted Operation entered transport: %v", err)
	}
	foreign := nativeCommonProof(f)
	foreign.DeviceID = uuid.NewString()
	_, err = UploadVerifiedCommonNativeOne(context.Background(),
		f.config, f.grant, f.snap.SnapshotSHA256, plan, probe,
		foreign, nil)
	if !errors.Is(err, ErrCommonUploadPlanQuarantined) || probe.admissions != 0 {
		t.Fatalf("wrong device entered private upload: %v", err)
	}
}
