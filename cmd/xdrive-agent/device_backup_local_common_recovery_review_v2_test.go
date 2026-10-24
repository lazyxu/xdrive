//go:build linux || windows

package main

import (
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushcommon"
)

func TestReadOnlyRecoveryClassifierNeverPromotesPendingToComplete(t *testing.T) {
	cases := []struct {
		name      string
		originals []localpushcommon.VerifiedOriginalReceipt
		want      string
		valid     bool
	}{
		{name: "missing original", want: "unrecorded", valid: true},
		{name: "historical committed only", originals: []localpushcommon.VerifiedOriginalReceipt{
			{Receipt: client.LocalPushCommonUploadReceipt{State: "committed", Committed: true}},
		}, want: "historical_committed", valid: true},
		{name: "pending reserved", originals: []localpushcommon.VerifiedOriginalReceipt{
			{Receipt: client.LocalPushCommonUploadReceipt{State: "reserved"}},
		}, want: "pending", valid: true},
		{name: "pending follows committed", originals: []localpushcommon.VerifiedOriginalReceipt{
			{Receipt: client.LocalPushCommonUploadReceipt{State: "committed", Committed: true}},
			{Receipt: client.LocalPushCommonUploadReceipt{State: "bound"}},
		}, want: "pending", valid: true},
		{name: "forged committed", originals: []localpushcommon.VerifiedOriginalReceipt{
			{Receipt: client.LocalPushCommonUploadReceipt{State: "committed"}},
		}},
		{name: "forged pending", originals: []localpushcommon.VerifiedOriginalReceipt{
			{Receipt: client.LocalPushCommonUploadReceipt{State: "bound", Committed: true}},
		}},
		{name: "unknown state", originals: []localpushcommon.VerifiedOriginalReceipt{
			{Receipt: client.LocalPushCommonUploadReceipt{State: "cancelled"}},
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, valid := classifyLocalCommonReadOnlyOriginals(tc.originals)
			if got != tc.want || valid != tc.valid {
				t.Fatalf("read-only history was promoted: got=%q valid=%t want=%q valid=%t",
					got, valid, tc.want, tc.valid)
			}
		})
	}
}

func TestRecoveryReviewEpochFencesSourceInventoryAndSessionAcrossPages(t *testing.T) {
	grant := localpush.RootGrant{
		Server: "https://example.test", Account: "owner",
		SourceID: 42, DeviceID: "12345678-1234-1234-1234-123456789abc",
		RootID:      "23456789-1234-1234-1234-123456789abc",
		Fingerprint: strings.Repeat("a", 64), StrongIdentity: true,
	}
	snapshot := localpush.InventoryJournalSnapshot{
		SnapshotName: "current-native-snapshot", SnapshotSHA256: strings.Repeat("b", 64),
	}
	cp := localpush.CommonBatchCheckpoint{
		RunID: "34567890-1234-1234-1234-123456789abc",
		State: "uncertain", UpdatedAt: time.Date(2026, 10, 24, 8, 0, 0, 0, time.UTC),
	}
	build := func(session string, g localpush.RootGrant, revision, targetNodeID uint64,
		snap localpush.InventoryJournalSnapshot, checkpoint localpush.CommonBatchCheckpoint,
		rules string,
	) string {
		return localCommonRecoveryReviewEpoch(session, g, revision, targetNodeID, snap, checkpoint, rules)
	}
	epoch := build("high-entropy-private-session", grant, 7, 99, snapshot, cp, "private-rules")
	if len(epoch) != 64 || strings.Contains(epoch, "high-entropy-private-session") ||
		strings.Contains(epoch, grant.Fingerprint) || strings.Contains(epoch, snapshot.SnapshotSHA256) {
		t.Fatalf("review disclosed raw identity data in epoch: %q", epoch)
	}
	same := build("high-entropy-private-session", grant, 7, 99, snapshot, cp, "private-rules")
	if epoch != same {
		t.Fatal("unchanged private generation changed between pages")
	}
	testChanged := func(label, got string) {
		t.Helper()
		if got == "" || got == epoch {
			t.Fatalf("%s did not invalidate stale recovery page ordinal", label)
		}
	}
	testChanged("Owner session", build("rotated-session", grant, 7, 99, snapshot, cp, "private-rules"))
	altered := grant
	altered.Fingerprint = strings.Repeat("c", 64)
	testChanged("native Root", build("high-entropy-private-session", altered, 7, 99, snapshot, cp, "private-rules"))
	newGeneration := snapshot
	newGeneration.SnapshotSHA256 = strings.Repeat("d", 64)
	testChanged("changed Inventory generation", build("high-entropy-private-session", grant, 7, 99, newGeneration, cp, "private-rules"))
	later := cp
	later.UpdatedAt = cp.UpdatedAt.Add(time.Second)
	testChanged("new checkpoint", build("high-entropy-private-session", grant, 7, 99, snapshot, later, "private-rules"))
	testChanged("Source revision", build("high-entropy-private-session", grant, 8, 99, snapshot, cp, "private-rules"))
	testChanged("ignore rules", build("high-entropy-private-session", grant, 7, 99, snapshot, cp, "new-rules"))
	testChanged("destination Node ID", build("high-entropy-private-session", grant, 7, 100, snapshot, cp, "private-rules"))
	if got := build("", grant, 7, 99, snapshot, cp, "private-rules"); got != "" {
		t.Fatal("missing Owner session minted a valid page epoch")
	}
}
