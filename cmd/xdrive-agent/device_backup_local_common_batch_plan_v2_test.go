package main

import (
	"math"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpushcommon"
)

func commonBatchDecisionFixture() (localpushcommon.Plan, client.LocalPushCommonUploadReceipt, client.Node) {
	parent := uint64(99)
	p := localpushcommon.Plan{
		Server: "https://server.test", Account: "owner", OwnerSession: "session",
		DeviceID: uuid.NewString(), RootID: uuid.NewString(),
		RootFingerprint: strings.Repeat("f", 64),
		SourceID:        42, SourceRevision: 7, OperationID: uuid.NewString(),
		RelativePath: "alpha.txt", NativeIdentityKey: strings.Repeat("c", 64),
		ContentSHA256: strings.Repeat("a", 64), Size: 3,
		Target: localpushcommon.Target{ParentID: parent, Name: "alpha.txt"},
	}
	r := client.LocalPushCommonUploadReceipt{
		SourceID: 42, Revision: 7, OperationID: p.OperationID,
		State: "committed", Committed: true,
		NodeID: 123, NodeRevision: 1, ContentSHA256: p.ContentSHA256, Size: p.Size,
	}
	node := client.Node{
		ID: 123, ParentID: &parent, Name: "alpha.txt", Type: "file",
		Revision: 1, SHA256: p.ContentSHA256, Size: p.Size,
	}
	return p, r, node
}

func TestCommonBatchFileAThenFileBThenUpdatedA(t *testing.T) {
	p, receipt, current := commonBatchDecisionFixture()
	if err := p.Validate(); err != nil {
		t.Fatal(err)
	}
	target, skipped, err := decideLocalCommonRootFile(
		"alpha.txt", p.ContentSHA256, 3, 42, 7, 99, nil, nil)
	if err != nil || skipped || target.ParentID != 99 ||
		target.Name != "alpha.txt" || target.NodeID != 0 {
		t.Fatalf("file A creation: %+v skipped=%v %v", target, skipped, err)
	}
	bTarget, bSkipped, err := decideLocalCommonRootFile(
		"bravo.txt", strings.Repeat("b", 64), 9, 42, 7, 99, nil, nil)
	if err != nil || bSkipped || bTarget.Name != "bravo.txt" ||
		bTarget.ParentID != 99 {
		t.Fatalf("file B independent creation: %+v skipped=%v %v", bTarget, bSkipped, err)
	}
	originals := []localCommonVerifiedOriginal{{Plan: p, Receipt: receipt}}
	_, skipped, err = decideLocalCommonRootFile(
		"alpha.txt", p.ContentSHA256, 3, 42, 7, 99, &current, originals)
	if err != nil || !skipped {
		t.Fatalf("unchanged A should skip only after original SQL and current Node: %v", err)
	}
	target, skipped, err = decideLocalCommonRootFile(
		"alpha.txt", strings.Repeat("d", 64), 4, 42, 7, 99,
		&current, originals)
	if err != nil || skipped || target.NodeID != 123 ||
		target.ExpectedRevision != 1 || target.ParentID != 0 {
		t.Fatalf("updated A' should write next Node revision: %+v skipped=%v %v",
			target, skipped, err)
	}
	newP := p
	newP.Target = target
	newP.OperationID = uuid.NewString()
	newP.ContentSHA256 = strings.Repeat("d", 64)
	newP.Size = 4
	newR := receipt
	newR.OperationID = newP.OperationID
	newR.NodeRevision = 2
	newR.ContentSHA256 = newP.ContentSHA256
	newR.Size = newP.Size
	current.Revision = 2
	current.SHA256 = newP.ContentSHA256
	current.Size = 4
	originals = append(originals, localCommonVerifiedOriginal{Plan: newP, Receipt: newR})
	_, skipped, err = decideLocalCommonRootFile(
		"alpha.txt", newP.ContentSHA256, newP.Size, 42, 7, 99,
		&current, originals)
	if err != nil || !skipped {
		t.Fatalf("A' immutable original and current Node not recognized: %v", err)
	}
}

func TestCommonBatchRejectsUnownedRemoteOrUncertainOriginal(t *testing.T) {
	p, receipt, current := commonBatchDecisionFixture()
	sha := p.ContentSHA256
	if _, _, err := decideLocalCommonRootFile(
		"alpha.txt", sha, 3, 42, 7, 99, &current, nil); err == nil {
		t.Fatal("unowned pre-existing cloud file silently taken over")
	}
	originals := []localCommonVerifiedOriginal{{Plan: p, Receipt: receipt}}
	current.Revision++
	if _, _, err := decideLocalCommonRootFile(
		"alpha.txt", sha, 3, 42, 7, 99, &current, originals); err == nil {
		t.Fatal("cloud Node mutated outside original Operation")
	}
	current.Revision--
	pending := client.LocalPushCommonUploadReceipt{
		SourceID: 42, Revision: 7, OperationID: p.OperationID, State: "reserved",
	}
	if _, _, err := decideLocalCommonRootFile("alpha.txt",
		strings.Repeat("e", 64), 3, 42, 7, 99, nil,
		[]localCommonVerifiedOriginal{{Plan: p, Receipt: pending}}); err == nil {
		t.Fatal("changed source bytes replaced original pending Operation")
	}
	target, skipped, err := decideLocalCommonRootFile("alpha.txt",
		sha, 3, 42, 7, 99, nil,
		[]localCommonVerifiedOriginal{{Plan: p, Receipt: pending}})
	if err != nil || skipped || target != p.Target {
		t.Fatalf("original pending Operation cannot replay: %+v %v", target, err)
	}
	// A forged Owner-revision or Operation ID must not confer ownership.
	receipt.OperationID = uuid.NewString()
	if _, _, err := decideLocalCommonRootFile("alpha.txt", sha, 3, 42, 7,
		99, &current, []localCommonVerifiedOriginal{{Plan: p, Receipt: receipt}}); err == nil {
		t.Fatal("non-original SQL receipt accepted")
	}
}

func TestCommonBatchRejectedHugeRevisionCannotSpin(t *testing.T) {
	p, receipt, current := commonBatchDecisionFixture()
	// A hostile or corrupt history revision must fail in bounded time.
	p.Target = localpushcommon.Target{NodeID: 123, ExpectedRevision: math.MaxUint64 - 1}
	receipt.NodeRevision = math.MaxUint64
	current.Revision = math.MaxUint64
	if _, _, err := decideLocalCommonRootFile("alpha.txt", p.ContentSHA256,
		3, 42, 7, 99, &current,
		[]localCommonVerifiedOriginal{{Plan: p, Receipt: receipt}}); err == nil {
		t.Fatal("unbounded revision gap accepted")
	}
}

func TestCommonBatchNestedTargetsPreserveExactParentAndFileIdentity(t *testing.T) {
	p, receipt, current := commonBatchDecisionFixture()
	nestedParent := uint64(456)
	p.RelativePath = "trips/autumn/alpha.txt"
	p.Target = localpushcommon.Target{ParentID: nestedParent, Name: "alpha.txt"}
	current.ParentID = &nestedParent
	if err := p.Validate(); err != nil {
		t.Fatal(err)
	}
	old := []localCommonVerifiedOriginal{{Plan: p, Receipt: receipt}}
	_, skip, err := decideLocalCommonRootFile(
		p.RelativePath, p.ContentSHA256, p.Size,
		p.SourceID, p.SourceRevision, nestedParent, &current, old)
	if err != nil || !skip {
		t.Fatalf("nested unchanged original not recognized: %v", err)
	}
	target, skip, err := decideLocalCommonRootFile(
		p.RelativePath, strings.Repeat("d", 64), 7,
		p.SourceID, p.SourceRevision, nestedParent, &current, old)
	if err != nil || skip || target.NodeID != receipt.NodeID ||
		target.ExpectedRevision != receipt.NodeRevision {
		t.Fatalf("nested next FileVersion target incorrect: %+v %v", target, err)
	}
	wrongParent := nestedParent + 1
	current.ParentID = &wrongParent
	if _, _, err := decideLocalCommonRootFile(
		p.RelativePath, p.ContentSHA256, p.Size,
		p.SourceID, p.SourceRevision, nestedParent, &current, old); err == nil {
		t.Fatal("nested file moved outside selected parent was reused")
	}
}
