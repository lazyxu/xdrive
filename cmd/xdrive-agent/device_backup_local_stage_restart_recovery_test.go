package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpushstage"
)

func samplePrivateStageHint(n int, path string) localpushstage.LocalOriginalRecoveryHint {
	return localpushstage.LocalOriginalRecoveryHint{
		Stage: localpushstage.LocalOriginalServerStage{
			SourceID: 42, Revision: 7,
			StageID:        fmt.Sprintf("00000000-0000-4000-8000-%012d", n),
			Size:           256,
			SHA256:         strings.Repeat("a", 64),
			SnapshotSHA256: strings.Repeat("b", 64),
			CurrentPathKey: strings.Repeat("c", 64),
		},
		RelativePath: path,
	}
}

func TestPrivateStageRestartPageIsBoundedSortedAndRequiresExactCursor(t *testing.T) {
	hints := make([]localpushstage.LocalOriginalRecoveryHint, 0, 10)
	for i := 10; i >= 1; i-- {
		hints = append(hints, samplePrivateStageHint(i, "first-leaf.jpg"))
	}
	first, next, more, err := selectLocalStageRestartPage(hints, 42, "", 8)
	if err != nil || len(first) != 8 || !more ||
		first[0].Stage.StageID != samplePrivateStageHint(1, "").Stage.StageID ||
		next != samplePrivateStageHint(8, "").Stage.StageID {
		t.Fatalf("invalid bounded first recovery page: %d %q %t %v",
			len(first), next, more, err)
	}
	second, after, more, err := selectLocalStageRestartPage(hints, 42, next, 8)
	if err != nil || len(second) != 2 || more || after != "" ||
		second[0].Stage.StageID != samplePrivateStageHint(9, "").Stage.StageID {
		t.Fatalf("unbounded or unstable terminal page: %d %q %t %v",
			len(second), after, more, err)
	}
	_, _, more, err = selectLocalStageRestartPage(hints, 42,
		samplePrivateStageHint(10, "").Stage.StageID, 8)
	if err != nil || more {
		t.Fatalf("last cursor not terminal: %v more=%t", err, more)
	}
	for _, tc := range []struct {
		name  string
		hints []localpushstage.LocalOriginalRecoveryHint
		after string
		limit int
		id    uint64
	}{
		{"wrong Source", hints, "", 8, 43},
		{"zero Source", hints, "", 8, 0},
		{"zero limit", hints, "", 0, 42},
		{"oversized limit", hints, "", 9, 42},
		{"missing cursor", hints, samplePrivateStageHint(15, "").Stage.StageID, 8, 42},
		{"unsafe cursor", hints, "../secret", 8, 42},
		{"duplicate Stage", append(hints, hints[0]), "", 8, 42},
		{"too many staged hints", make([]localpushstage.LocalOriginalRecoveryHint, 129), "", 8, 42},
		{"mixed Source", []localpushstage.LocalOriginalRecoveryHint{
			hints[0], func() localpushstage.LocalOriginalRecoveryHint {
				v := hints[1]
				v.Stage.SourceID = 43
				return v
			}(),
		}, "", 8, 42},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if page, next, hasMore, err := selectLocalStageRestartPage(
				tc.hints, tc.id, tc.after, tc.limit,
			); err == nil || len(page) != 0 || next != "" || hasMore {
				t.Fatalf("untrusted recovery page accepted: %q %+v %s %t %v",
					tc.name, page, next, hasMore, err)
			}
		})
	}
}

func TestPrivateStageRestartOnlyHistoricalPhysicalReceiptCountsAsObserved(t *testing.T) {
	ctx := context.Background()
	hint := samplePrivateStageHint(1, "first-leaf.jpg")
	success := client.LocalPushFirstLeafPhysicalReceipt{
		StageID: hint.Stage.StageID, SourceID: 42, Revision: 7,
		NodeID: 51, SourceItemID: 72, State: localPhysicalReceiptRecoveryState,
		CASObserved: true,
	}
	calls := 0
	reader := func(ctx context.Context, id, revision uint64, stage, path string) (
		client.LocalPushFirstLeafPhysicalReceipt, error,
	) {
		calls++
		if id != 42 || revision != 7 || stage != hint.Stage.StageID || path != "first-leaf.jpg" {
			t.Fatal("private Stage recovery contacted wrong Root/Source leaf")
		}
		return success, nil
	}
	observation, err := inspectLocalHistoricalStage(ctx, hint, 42, 7, reader)
	if err != nil || !observation.CASObserved ||
		observation.State != localPhysicalReceiptRecoveryState ||
		observation.NodeID != 51 || observation.SourceItemID != 72 || calls != 1 {
		t.Fatalf("committed physical CAS not accepted as neutral observation: %+v %v", observation, err)
	}
	for _, tc := range []struct {
		name     string
		modify   func(*localpushstage.LocalOriginalRecoveryHint, *client.LocalPushFirstLeafPhysicalReceipt)
		noRemote bool
	}{
		{"previous Source revision", func(h *localpushstage.LocalOriginalRecoveryHint, r *client.LocalPushFirstLeafPhysicalReceipt) {
			h.Stage.Revision = 6
		}, true},
		{"nested folder", func(h *localpushstage.LocalOriginalRecoveryHint, r *client.LocalPushFirstLeafPhysicalReceipt) {
			h.RelativePath = "nested/file.jpg"
		}, true},
		{"directory traversal", func(h *localpushstage.LocalOriginalRecoveryHint, r *client.LocalPushFirstLeafPhysicalReceipt) {
			h.RelativePath = "../outside"
		}, true},
		{"wrong Stage receipt", func(h *localpushstage.LocalOriginalRecoveryHint, r *client.LocalPushFirstLeafPhysicalReceipt) {
			r.StageID = "other"
		}, false},
		{"wrong Source receipt", func(h *localpushstage.LocalOriginalRecoveryHint, r *client.LocalPushFirstLeafPhysicalReceipt) {
			r.SourceID = 43
		}, false},
		{"no CAS physical bytes", func(h *localpushstage.LocalOriginalRecoveryHint, r *client.LocalPushFirstLeafPhysicalReceipt) {
			r.CASObserved = false
		}, false},
		{"forged backup success", func(h *localpushstage.LocalOriginalRecoveryHint, r *client.LocalPushFirstLeafPhysicalReceipt) {
			r.BackupComplete = true
		}, false},
		{"forged upload authority", func(h *localpushstage.LocalOriginalRecoveryHint, r *client.LocalPushFirstLeafPhysicalReceipt) {
			r.CommitSupported = true
		}, false},
		{"native bytes unproven", func(h *localpushstage.LocalOriginalRecoveryHint, r *client.LocalPushFirstLeafPhysicalReceipt) {
			r.NativeVerified = true
		}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			candidate, result := hint, success
			tc.modify(&candidate, &result)
			lookups := 0
			recovered, err := inspectLocalHistoricalStage(ctx, candidate, 42, 7,
				func(context.Context, uint64, uint64, string, string) (
					client.LocalPushFirstLeafPhysicalReceipt, error,
				) {
					lookups++
					return result, nil
				},
			)
			if err != nil || recovered.CASObserved ||
				recovered.State != localStageRestartUnresolved ||
				recovered.NodeID != 0 || recovered.SourceItemID != 0 ||
				(tc.noRemote && lookups != 0) {
				t.Fatalf("untrusted private Stage promoted to canonical success: %+v %v (calls=%d)",
					recovered, err, lookups)
			}
		})
	}
	unknown, err := inspectLocalHistoricalStage(ctx, hint, 42, 7,
		func(context.Context, uint64, uint64, string, string) (
			client.LocalPushFirstLeafPhysicalReceipt, error,
		) {
			return client.LocalPushFirstLeafPhysicalReceipt{},
				errors.New("may contain private Root or bearer data")
		},
	)
	if err != nil || unknown.CASObserved || unknown.State != localStageRestartUnresolved {
		t.Fatalf("unavailable Server leaked false backup success: %+v %v", unknown, err)
	}
	privateJSON, err := json.Marshal(observation)
	if err != nil || string(privateJSON) != "{}" {
		t.Fatalf("private Stage state escaped IPC JSON: %s %v", privateJSON, err)
	}
	pageJSON, err := json.Marshal(localStageRestartInspectionPage{
		Rows:           []localStageRestartInspection{observation},
		BackupComplete: false, Authoritative: false,
	})
	if err != nil || string(pageJSON) != "{}" {
		t.Fatalf("private recovery batch escaped IPC JSON: %s %v", pageJSON, err)
	}
}

func TestPrivateStageRestartPropagatesCancellationAndCannotBeUsedAsCommitToken(t *testing.T) {
	hint := samplePrivateStageHint(1, "original.jpg")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	called := false
	row, err := inspectLocalHistoricalStage(ctx, hint, 42, 7,
		func(context.Context, uint64, uint64, string, string) (
			client.LocalPushFirstLeafPhysicalReceipt, error,
		) {
			called = true
			return client.LocalPushFirstLeafPhysicalReceipt{CASObserved: true}, nil
		},
	)
	if !errors.Is(err, context.Canceled) || called || row.CASObserved {
		t.Fatalf("canceled private hint read gained physical authority: %+v %v called=%t",
			row, err, called)
	}
}
