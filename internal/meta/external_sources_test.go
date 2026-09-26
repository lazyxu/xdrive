package meta

import (
	"strings"
	"testing"
)

func TestExternalSourceValidation(t *testing.T) {
	for _, name := range []string{"Synology Photos", "家庭照片", "NAS backup"} {
		if !ValidSourceName(name) {
			t.Fatalf("expected source name %q to be valid", name)
		}
	}
	for _, name := range []string{"", " padded", "trailing ", "bad\nname", strings.Repeat("x", 129)} {
		if ValidSourceName(name) {
			t.Fatalf("expected source name %q to be invalid", name)
		}
	}

	for _, kind := range []string{"synology", "synology_photos", "photos.v2", "s3-compatible"} {
		if !ValidSourceKind(kind) {
			t.Fatalf("expected source kind %q to be valid", kind)
		}
	}
	for _, kind := range []string{"", "Synology", "_private", "bad/kind", strings.Repeat("a", 65)} {
		if ValidSourceKind(kind) {
			t.Fatalf("expected source kind %q to be invalid", kind)
		}
	}

	if !ValidSourceDirection(SourceDirectionPush) || !ValidSourceDirection(SourceDirectionPull) || ValidSourceDirection("both") {
		t.Fatal("unexpected source direction validation")
	}
	if !ValidSourceSyncMode(SourceSyncModeBackup) || !ValidSourceSyncMode(SourceSyncModeMirror) || ValidSourceSyncMode("delete") {
		t.Fatal("unexpected source sync mode validation")
	}
	if !ValidSourceRunMode(SourceRunModeSync) || !ValidSourceRunMode(SourceRunModeScan) || ValidSourceRunMode("deep") {
		t.Fatal("unexpected source run mode validation")
	}
	if !ValidSourceStatus(SourceStatusActive) || !ValidSourceStatus(SourceStatusPaused) || ValidSourceStatus("error") {
		t.Fatal("unexpected source status validation")
	}
}

func TestExternalSourceItemAndRunStates(t *testing.T) {
	for _, kind := range []string{SourceItemKindFile, SourceItemKindDirectory} {
		if !ValidSourceItemKind(kind) {
			t.Fatalf("kind %q should be valid", kind)
		}
	}
	for _, state := range []string{
		SourceItemStatePending,
		SourceItemStateSynced,
		SourceItemStateMissing,
		SourceItemStateIgnored,
		SourceItemStateError,
	} {
		if !ValidSourceItemState(state) {
			t.Fatalf("item state %q should be valid", state)
		}
	}

	for _, trigger := range []string{
		SyncRunTriggerManual,
		SyncRunTriggerScheduled,
		SyncRunTriggerEvent,
		SyncRunTriggerReconcile,
	} {
		if !ValidSyncRunTrigger(trigger) {
			t.Fatalf("trigger %q should be valid", trigger)
		}
	}

	if SyncRunTerminal(SyncRunStatusRunning) {
		t.Fatal("running sync must not be terminal")
	}
	for _, state := range []string{
		SyncRunStatusCompleted,
		SyncRunStatusPartial,
		SyncRunStatusFailed,
		SyncRunStatusCancelled,
	} {
		if !ValidSyncRunStatus(state) || !SyncRunTerminal(state) {
			t.Fatalf("run state %q should be valid and terminal", state)
		}
	}
	if ValidSyncRunStatus("queued") || SyncRunTerminal("queued") {
		t.Fatal("unknown sync state was accepted")
	}
}
