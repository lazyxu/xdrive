package main

import (
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpushcommon"
)

func TestCommonBatchRebaselinePreservesExactHistoricalNodeAndBlocksOldPending(t *testing.T) {
	prior, receipt, node := commonBatchDecisionFixture()
	old := []localCommonVerifiedOriginal{{Plan: prior, Receipt: receipt}}
	// A saved schedule PATCH advances Source revision but does not authorize
	// adopting an unrelated cloud file or using an old pending upload key.
	_, skip, err := decideLocalCommonRootFile("alpha.txt", prior.ContentSHA256,
		prior.Size, prior.SourceID, prior.SourceRevision+1, 99, &node, old)
	if err != nil || !skip {
		t.Fatalf("unchanged previously committed file was retransferred: %t %v", skip, err)
	}
	nextHash := strings.Repeat("d", 64)
	target, skip, err := decideLocalCommonRootFile("alpha.txt", nextHash,
		4, prior.SourceID, prior.SourceRevision+1, 99, &node, old)
	if err != nil || skip || target.NodeID != node.ID || target.ExpectedRevision != node.Revision {
		t.Fatalf("new plan did not use current verified cloud Node: %+v %v", target, err)
	}
	nextPlan := prior
	nextPlan.SourceRevision++
	nextPlan.OperationID = uuid.NewString()
	nextPlan.Target = localpushcommon.Target{NodeID: node.ID, ExpectedRevision: node.Revision}
	nextPlan.ContentSHA256 = nextHash
	nextPlan.Size = 4
	committed := client.LocalPushCommonUploadReceipt{
		SourceID: prior.SourceID, Revision: nextPlan.SourceRevision,
		OperationID: nextPlan.OperationID, State: "committed", Committed: true,
		NodeID: node.ID, NodeRevision: node.Revision + 1, ContentSHA256: nextHash, Size: 4,
	}
	node.Revision++
	node.SHA256 = nextHash
	node.Size = 4
	next := append(old, localCommonVerifiedOriginal{Plan: nextPlan, Receipt: committed})
	if _, skip, err := decideLocalCommonRootFile("alpha.txt", nextHash,
		4, prior.SourceID, nextPlan.SourceRevision, 99, &node, next); err != nil || !skip {
		t.Fatalf("cross-revision committed chain did not preserve incremental skip: %t %v", skip, err)
	}
	pending := receipt
	pending.State, pending.Committed = "bound", false
	pending.NodeID, pending.NodeRevision = 0, 0
	pending.ContentSHA256 = ""
	if _, _, err := decideLocalCommonRootFile("alpha.txt", prior.ContentSHA256,
		prior.Size, prior.SourceID, prior.SourceRevision+1, 99, nil,
		[]localCommonVerifiedOriginal{{Plan: prior, Receipt: pending}}); err == nil {
		t.Fatal("old Source revision reissued a pending original Operation")
	}
	node.Name = "foreign.txt"
	if _, _, err := decideLocalCommonRootFile("alpha.txt", nextHash, 4,
		prior.SourceID, nextPlan.SourceRevision, 99, &node, next); err == nil {
		t.Fatal("external cloud Node identity was adopted during version rebaseline")
	}
}
