//go:build linux || windows

package main

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpushcommon"
)

func TestReadOnlyHistoricalNodeMatchesCurrentCloudRevisionWithoutCASClaim(t *testing.T) {
	plan, receipt, node := commonBatchDecisionFixture()
	originals := []localCommonVerifiedOriginal{{Plan: plan, Receipt: receipt}}
	if !localCommonHistoricalMatchesCurrentNode("alpha.txt", 99, &node, originals) {
		t.Fatal("original committed Node metadata should agree")
	}
	if localCommonHistoricalMatchesCurrentNode("alpha.txt", 0, &node, originals) ||
		localCommonHistoricalMatchesCurrentNode("alpha.txt", 99, nil, originals) ||
		localCommonHistoricalMatchesCurrentNode("other.txt", 99, &node, originals) ||
		localCommonHistoricalMatchesCurrentNode("alpha.txt", 99, &node, nil) {
		t.Fatal("missing or foreign read-only scope was treated as verified")
	}
}

func TestReadOnlyHistoricalNodeRejectsExternalChangesAndPendingOperations(t *testing.T) {
	plan, receipt, node := commonBatchDecisionFixture()
	base := []localCommonVerifiedOriginal{{Plan: plan, Receipt: receipt}}
	for name, alter := range map[string]func(*client.Node){
		"wrong_revision": func(n *client.Node) { n.Revision++ },
		"changed_hash":   func(n *client.Node) { n.SHA256 = "external-change" },
		"changed_size":   func(n *client.Node) { n.Size++ },
		"deleted": func(n *client.Node) {
			now := n.CreatedAt
			n.DeletedAt = &now
		},
		"wrong_parent": func(n *client.Node) {
			id := uint64(100)
			n.ParentID = &id
		},
		"wrong_node": func(n *client.Node) { n.ID++ },
	} {
		t.Run(name, func(t *testing.T) {
			changed := node
			alter(&changed)
			if localCommonHistoricalMatchesCurrentNode("alpha.txt", 99, &changed, base) {
				t.Fatalf("%s falsely proved historical cloud Node still current", name)
			}
		})
	}
	// A signed old SQL COMMIT cannot make a newer outstanding operation
	// appear complete, even when the CURRENT Node still equals the old one.
	newPlan := plan
	newPlan.OperationID = "44567890-1234-1234-1234-123456789abc"
	newPlan.ContentSHA256 = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
	newPlan.Target = localpushcommon.Target{NodeID: receipt.NodeID, ExpectedRevision: receipt.NodeRevision}
	pending := client.LocalPushCommonUploadReceipt{
		SourceID: plan.SourceID, Revision: plan.SourceRevision,
		OperationID: newPlan.OperationID, State: "bound",
	}
	if localCommonHistoricalMatchesCurrentNode("alpha.txt", 99, &node,
		append(base, localCommonVerifiedOriginal{Plan: newPlan, Receipt: pending})) {
		t.Fatal("pending original was mislabeled current and committed")
	}
	invalid := base[0]
	invalid.Receipt.OperationID = newPlan.OperationID
	if localCommonHistoricalMatchesCurrentNode("alpha.txt", 99, &node,
		[]localCommonVerifiedOriginal{invalid}) {
		t.Fatal("wrong immutable operation reused as live metadata proof")
	}
}

func TestReadOnlyHistoricalNodeRequiresCompleteMultipleVersionChain(t *testing.T) {
	first, firstReceipt, current := commonBatchDecisionFixture()
	second := first
	second.OperationID = "44567890-1234-1234-1234-123456789abc"
	second.Target = localpushcommon.Target{
		NodeID: firstReceipt.NodeID, ExpectedRevision: firstReceipt.NodeRevision,
	}
	second.ContentSHA256 = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
	second.Size = 4
	secondReceipt := firstReceipt
	secondReceipt.OperationID = second.OperationID
	secondReceipt.NodeRevision = 2
	secondReceipt.ContentSHA256 = second.ContentSHA256
	secondReceipt.Size = second.Size
	current.Revision = 2
	current.SHA256 = second.ContentSHA256
	current.Size = second.Size
	chain := []localCommonVerifiedOriginal{
		{Plan: first, Receipt: firstReceipt},
		{Plan: second, Receipt: secondReceipt},
	}
	if !localCommonHistoricalMatchesCurrentNode("alpha.txt", 99, &current, chain) {
		t.Fatal("verified two-generation original receipt chain was rejected")
	}
	if localCommonHistoricalMatchesCurrentNode("alpha.txt", 99, &current, chain[1:]) {
		t.Fatal("missing first committed revision was treated as current")
	}
	forged := chain[1]
	forged.Receipt.NodeID++
	if localCommonHistoricalMatchesCurrentNode("alpha.txt", 99, &current,
		[]localCommonVerifiedOriginal{chain[0], forged}) {
		t.Fatal("changed original Node identity was treated as current")
	}
}
