package localbackupipc

import (
	"testing"
	"time"
)

func TestScanCompletionIsAFileTraversalFlagNotSourceCASAuthority(t *testing.T) {
	base := Summary{SourceID: 42, Revision: 3, State: "partial",
		ScanComplete: true, InspectedFiles: 2, ConfirmedFiles: 1, SkippedFiles: 1,
		BackupComplete: false, RetirementSafe: false, CurrentCASVerified: false,
	}
	if !ValidateSummary(base, 42) {
		t.Fatal("complete scan was incorrectly rejected")
	}
	for _, state := range []string{"running", "uncertain", "paused", "cancelled"} {
		bad := base
		bad.State = state
		bad.Running = state == "running"
		if ValidateSummary(bad, 42) {
			t.Fatalf("%s fabricated scan completion", state)
		}
	}
	forged := base
	forged.BackupComplete = true
	if ValidateSummary(forged, 42) {
		t.Fatal("scan flag overrode Source/CAS proof")
	}
	now := time.Now().UTC()
	history := HistoryPage{SourceID: 42, Items: []HistoryItem{{
		RunID: "original-local-run", SourceID: 42, Revision: 3, State: "partial",
		ScanComplete: true, InspectedFiles: 1, ConfirmedFiles: 1,
		StartedAt: now.Add(-time.Minute), FinishedAt: now,
	}}}
	if !ValidateHistory(history, 42) {
		t.Fatal("completed local traversal missing from private history")
	}
	history.Items[0].State = "uncertain"
	if ValidateHistory(history, 42) {
		t.Fatal("uncertain history forged traversal completion")
	}
}
