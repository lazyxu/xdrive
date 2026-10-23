//go:build linux || windows

package localpush

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
)

func commonBatchHistoryFixture(f commonPlanFixture, state string, n int, at time.Time) CommonBatchCheckpoint {
	return CommonBatchCheckpoint{
		Version: commonBatchCheckpointVersion, RunID: uuid.NewString(),
		SourceID: f.grant.SourceID, SourceRevision: 7,
		RootFingerprint: f.grant.Fingerprint,
		SessionDigest:   commonUploadSessionDigest(f.secret),
		State:           state, InspectedFiles: int64(n + 2),
		ConfirmedFiles: int64(n), SkippedFiles: 1, UnsupportedFiles: 1,
		ConfirmedBytes: int64(n * 1024),
		StartedAt:      at.Add(-time.Minute), UpdatedAt: at,
	}
}

func TestVerifiedCommonBatchRunHistoryIsImmutableOwnerPrivate(t *testing.T) {
	f := makeCommonPlanFixture(t)
	ctx := context.Background()
	older := commonBatchHistoryFixture(f, "partial", 2, time.Now().UTC().Add(-2*time.Hour))
	recent := commonBatchHistoryFixture(f, "paused", 3, time.Now().UTC().Add(-time.Hour))
	for _, cp := range []CommonBatchCheckpoint{older, recent, recent} {
		if err := AppendVerifiedCommonBatchHistory(ctx, f.config, f.grant, f.secret, cp); err != nil {
			t.Fatalf("append/replay original local attempt: %v", err)
		}
	}
	items, err := ListVerifiedCommonBatchHistory(ctx, f.config, f.grant, f.secret)
	if err != nil || len(items) != 2 || items[0] != recent || items[1] != older {
		t.Fatalf("private history was not chronological, immutable and exact: %+v %v", items, err)
	}
	if _, err := ListVerifiedCommonBatchHistory(ctx, f.config, f.grant, "another-session"); !errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("old private history became visible after session switch: %v", err)
	}
	changed := recent
	changed.ConfirmedBytes++
	if err := AppendVerifiedCommonBatchHistory(ctx, f.config, f.grant, f.secret, changed); !errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("original RunID was overwritten with another result: %v", err)
	}
	unsafe := recent
	unsafe.RunID = uuid.NewString()
	unsafe.BackupComplete = true
	if err := AppendVerifiedCommonBatchHistory(ctx, f.config, f.grant, f.secret, unsafe); !errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("history promoted a partial backup to whole-Source success: %v", err)
	}
	running := recent
	running.RunID = uuid.NewString()
	running.State = "running"
	if err := AppendVerifiedCommonBatchHistory(ctx, f.config, f.grant, f.secret, running); !errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("in-flight task was recorded as immutable terminal history: %v", err)
	}
}

func TestVerifiedCommonBatchHistoryBoundsAndInvalidRecordFailsClosed(t *testing.T) {
	f := makeCommonPlanFixture(t)
	ctx := context.Background()
	start := time.Now().UTC().Add(-2 * time.Hour)
	for i := 0; i < commonBatchHistoryLimit+3; i++ {
		cp := commonBatchHistoryFixture(f, "cancelled", 2, start.Add(time.Duration(i)*time.Minute))
		if err := AppendVerifiedCommonBatchHistory(ctx, f.config, f.grant, f.secret, cp); err != nil {
			t.Fatalf("bounded append %d: %v", i, err)
		}
	}
	dir, err := commonBatchHistoryDir(f.config, f.grant)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	records := 0
	for _, entry := range raw {
		if filepath.Ext(entry.Name()) == ".json" {
			records++
		}
	}
	if records != commonBatchHistoryLimit {
		t.Fatalf("history is unbounded or lost extra records: %d", records)
	}
	items, err := ListVerifiedCommonBatchHistory(ctx, f.config, f.grant, f.secret)
	if err != nil || len(items) != commonBatchHistoryReadLimit {
		t.Fatalf("read exceeded 20 redacted records: %d %v", len(items), err)
	}
	bad := filepath.Join(dir, "run-"+uuid.NewString()+".json")
	if err := os.WriteFile(bad, []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := ListVerifiedCommonBatchHistory(ctx, f.config, f.grant, f.secret); !errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("corrupt historical receipt was silently discarded: %v", err)
	}
}

func TestVerifiedCommonBatchHistoryBackfillsCrashWindowWithoutFakeCommit(t *testing.T) {
	f := makeCommonPlanFixture(t)
	ctx := context.Background()
	original := commonBatchHistoryFixture(f, "running", 1, time.Now().UTC().Add(-time.Minute))
	if err := StoreVerifiedCommonBatchCheckpoint(
		ctx, f.config, f.grant, f.secret, 7, original,
	); err != nil {
		t.Fatal(err)
	}
	if err := ReconcileVerifiedCommonBatchHistoryBeforeRun(
		ctx, f.config, f.grant, f.secret, 7,
	); err != nil {
		t.Fatalf("stale-running Source could not be safely quarantined: %v", err)
	}
	cp, err := ReadVerifiedCommonBatchCheckpoint(ctx, f.config, f.grant, f.secret, 7)
	if err != nil || cp.State != "uncertain" || cp.UncertainFiles == 0 ||
		cp.BackupComplete || cp.RetirementSafe || cp.CurrentCASVerified {
		t.Fatalf("stale crash history invented backup success: %+v %v", cp, err)
	}
	items, err := ListVerifiedCommonBatchHistory(ctx, f.config, f.grant, f.secret)
	if err != nil || len(items) != 1 || items[0] != cp {
		t.Fatalf("crash window not reconciled into immutable local attempt: %+v %v", items, err)
	}
	if err := ReconcileVerifiedCommonBatchHistoryBeforeRun(
		ctx, f.config, f.grant, f.secret, 7,
	); err != nil {
		t.Fatalf("same authenticated run was not idempotent: %v", err)
	}
	if err := ReconcileVerifiedCommonBatchHistoryBeforeRun(
		ctx, f.config, f.grant, f.secret, 8,
	); !errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("changed Source revision replayed old original run: %v", err)
	}
}
