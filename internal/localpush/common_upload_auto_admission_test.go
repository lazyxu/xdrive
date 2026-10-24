//go:build linux || windows

package localpush

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// A cooldown may only be derived from an independently persisted,
// Owner/session/Source-revision-verified terminal checkpoint.
func storeCommonAutoCheckpoint(t *testing.T, f commonPlanFixture,
	cp CommonBatchCheckpoint, session string,
) {
	t.Helper()
	if err := StoreVerifiedCommonBatchCheckpoint(context.Background(),
		f.config, f.grant, session, cp.SourceRevision, cp); err != nil {
		t.Fatalf("persist verified original terminal checkpoint: %v", err)
	}
}

func TestCommonAutoAdmissionPersistsRestartAndEscalatesOnlyUnchangedCheckpoint(t *testing.T) {
	f := makeCommonPlanFixture(t)
	ctx := context.Background()
	cp := commonBatchHistoryFixture(f, "partial", 1,
		time.Date(2026, 10, 20, 10, 0, 0, 0, time.UTC))
	storeCommonAutoCheckpoint(t, f, cp, f.secret)
	start := cp.UpdatedAt.Add(time.Hour)
	allowed, err := ReserveVerifiedCommonAutoAdmission(ctx, f.config, f.grant, f.secret, cp, start)
	if err != nil || !allowed {
		t.Fatalf("first eligible scheduling admission not durable: %t %v", allowed, err)
	}
	path, err := commonAutoAdmissionPath(f.config, f.grant)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil || strings.Contains(string(raw), f.secret) ||
		strings.Contains(string(raw), f.grant.Path) {
		t.Fatalf("cooldown leaked Owner secret or native Root: %v", err)
	}
	first, exists, err := readCommonAutoAdmission(path, f.grant)
	if err != nil || !exists || first.Streak != 1 ||
		!first.NextAttemptAt.Equal(start.Add(15*time.Minute)) {
		t.Fatalf("first durable cooldown corrupted: %+v %v", first, err)
	}
	for _, next := range []time.Time{start, start.Add(time.Minute), start.Add(14 * time.Minute)} {
		if allowed, err := ReserveVerifiedCommonAutoAdmission(
			ctx, f.config, f.grant, f.secret, cp, next,
		); err != nil || allowed {
			t.Fatalf("restarted Agent bypassed same original cooldown at %v: %t %v", next, allowed, err)
		}
	}
	if allowed, err := ReserveVerifiedCommonAutoAdmission(
		ctx, f.config, f.grant, f.secret, cp, start.Add(15*time.Minute),
	); err != nil || !allowed {
		t.Fatalf("first bounded retry never became eligible: %t %v", allowed, err)
	}
	second, _, err := readCommonAutoAdmission(path, f.grant)
	if err != nil || second.Streak != 2 ||
		!second.NextAttemptAt.Equal(start.Add(45*time.Minute)) {
		t.Fatalf("restart did not preserve exponential cooldown: %+v %v", second, err)
	}
	if allowed, err := ReserveVerifiedCommonAutoAdmission(ctx, f.config,
		f.grant, f.secret, cp, start.Add(44*time.Minute),
	); err != nil || allowed {
		t.Fatalf("second cooldown was skipped: %t %v", allowed, err)
	}
	// One genuinely new, private terminal checkpoint MUST immediately clear
	// old admission delays, even with a short explicitly configured interval.
	fresh := commonBatchHistoryFixture(f, "partial", 2, start.Add(16*time.Minute))
	storeCommonAutoCheckpoint(t, f, fresh, f.secret)
	if allowed, err := ReserveVerifiedCommonAutoAdmission(
		ctx, f.config, f.grant, f.secret, fresh, start.Add(17*time.Minute),
	); err != nil || !allowed {
		t.Fatalf("new trustworthy run inherited old backoff: %t %v", allowed, err)
	}
	reset, _, err := readCommonAutoAdmission(path, f.grant)
	if err != nil || reset.Streak != 1 || reset.CheckpointRunID != fresh.RunID {
		t.Fatalf("checkpoint change failed to reset throttle: %+v %v", reset, err)
	}
}

func TestCommonAutoAdmissionRejectsUncertainRevokedAndCorruptLocalState(t *testing.T) {
	f := makeCommonPlanFixture(t)
	ctx := context.Background()
	cp := commonBatchHistoryFixture(f, "partial", 1,
		time.Date(2026, 10, 20, 10, 0, 0, 0, time.UTC))
	storeCommonAutoCheckpoint(t, f, cp, f.secret)
	now := cp.UpdatedAt.Add(time.Hour)
	bad := cp
	bad.State, bad.UncertainFiles = "uncertain", 1
	if allowed, err := ReserveVerifiedCommonAutoAdmission(ctx, f.config, f.grant, f.secret, bad, now); allowed || !errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("uncertain Operation was automatically scheduled: allowed=%t err=%v", allowed, err)
	}
	for _, terminal := range []string{"running", "paused", "cancelled", "uncertain"} {
		bad = cp
		bad.State = terminal
		if allowed, err := ReserveVerifiedCommonAutoAdmission(ctx, f.config, f.grant,
			f.secret, bad, now); allowed || !errors.Is(err, ErrCommonUploadPlanQuarantined) {
			t.Fatalf("unsafe original state %q armed automatic work: %t %v", terminal, allowed, err)
		}
	}
	for _, claim := range []string{"backup_complete", "retirement_safe", "current_cas_verified"} {
		bad = cp
		switch claim {
		case "backup_complete":
			bad.BackupComplete = true
		case "retirement_safe":
			bad.RetirementSafe = true
		case "current_cas_verified":
			bad.CurrentCASVerified = true
		}
		if allowed, err := ReserveVerifiedCommonAutoAdmission(ctx, f.config, f.grant,
			f.secret, bad, now); allowed || !errors.Is(err, ErrCommonUploadPlanQuarantined) {
			t.Fatalf("forged whole-Source field %q armed automatic work: %t %v", claim, allowed, err)
		}
	}
	if ok, err := ReserveVerifiedCommonAutoAdmission(ctx, f.config, f.grant, f.secret, cp, now); !ok || err != nil {
		t.Fatalf("setup verified cooldown: %t %v", ok, err)
	}
	path, err := commonAutoAdmissionPath(f.config, f.grant)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		info, statErr := os.Lstat(path)
		if statErr != nil || info.Mode().Perm() != 0o600 {
			t.Fatalf("private scheduling record is not owner-only: %+v %v", info, statErr)
		}
		if err := os.Chmod(path, 0o644); err != nil {
			t.Fatal(err)
		}
		if allowed, err := ReserveVerifiedCommonAutoAdmission(
			ctx, f.config, f.grant, f.secret, cp, now.Add(time.Hour),
		); allowed || !errors.Is(err, ErrCommonUploadPlanQuarantined) {
			t.Fatalf("world-readable cooldown allowed Agent work: %t %v", allowed, err)
		}
		if err := os.Chmod(path, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(path, []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if allowed, err := ReserveVerifiedCommonAutoAdmission(ctx, f.config, f.grant, f.secret, cp, now.Add(time.Hour)); allowed || !errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("corrupted private cooldown bypassed: %t %v", allowed, err)
	}
	if runtime.GOOS != "windows" {
		if err := os.Remove(path); err != nil {
			t.Fatal(err)
		}
		outside := filepath.Join(t.TempDir(), "outside")
		if err := os.WriteFile(outside, []byte("untouched"), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(outside, path); err != nil {
			t.Fatal(err)
		}
		if allowed, err := ReserveVerifiedCommonAutoAdmission(ctx, f.config, f.grant, f.secret, cp, now.Add(time.Hour)); allowed || !errors.Is(err, ErrCommonUploadPlanQuarantined) {
			t.Fatalf("symlink escaped Owner-private journal: %t %v", allowed, err)
		}
		other, err := os.ReadFile(outside)
		if err != nil || string(other) != "untouched" {
			t.Fatal("outside file was changed by rejected admission")
		}
		if err := os.Remove(path); err != nil {
			t.Fatal(err)
		}
	} else if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	revokedPath, err := grantFile(f.config, f.grant.Server, f.grant.Account, f.grant.RootID)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(revokedPath); err != nil {
		t.Fatal(err)
	}
	if allowed, err := ReserveVerifiedCommonAutoAdmission(ctx, f.config, f.grant, f.secret, cp, now); allowed || !errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("revoked native Root was used to admit scheduling: %t %v", allowed, err)
	}
}

func TestCommonAutoAdmissionRejectsForgedSessionDigestWithoutNewRun(t *testing.T) {
	f := makeCommonPlanFixture(t)
	ctx := context.Background()
	cp := commonBatchHistoryFixture(f, "partial", 1,
		time.Date(2026, 10, 20, 10, 0, 0, 0, time.UTC))
	storeCommonAutoCheckpoint(t, f, cp, f.secret)
	now := cp.UpdatedAt.Add(time.Hour)
	if ok, err := ReserveVerifiedCommonAutoAdmission(ctx, f.config, f.grant,
		f.secret, cp, now); !ok || err != nil {
		t.Fatalf("initial persisted admission: %t %v", ok, err)
	}
	path, err := commonAutoAdmissionPath(f.config, f.grant)
	if err != nil {
		t.Fatal(err)
	}
	record, exists, err := readCommonAutoAdmission(path, f.grant)
	if err != nil || !exists {
		t.Fatalf("read stored admission: %+v %v", record, err)
	}
	record.SessionDigest = strings.Repeat("a", 64)
	data, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, append(data, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}
	// Reject even after the old cooldown expires. A forged session string
	// does not authenticate a newer original SQL receipt or terminal run.
	if ok, err := ReserveVerifiedCommonAutoAdmission(ctx, f.config, f.grant,
		f.secret, cp, now.Add(16*time.Minute)); ok ||
		!errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("forged digest cleared old admission cooldown: allowed=%t err=%v", ok, err)
	}
	// Changing only the RunID with the same earlier terminal timestamp is
	// also insufficient; trusted progress must postdate the last admission.
	cp.RunID = uuid.NewString()
	if ok, err := ReserveVerifiedCommonAutoAdmission(ctx, f.config, f.grant,
		f.secret, cp, now.Add(17*time.Minute)); ok ||
		!errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("old checkpoint timestamp bypassed cooldown: allowed=%t err=%v", ok, err)
	}
}

func TestCommonAutoAdmissionRejectsUnpersistedNewTerminalClaim(t *testing.T) {
	f := makeCommonPlanFixture(t)
	cp := commonBatchHistoryFixture(f, "partial", 1,
		time.Date(2026, 10, 20, 10, 0, 0, 0, time.UTC))
	storeCommonAutoCheckpoint(t, f, cp, f.secret)
	now := cp.UpdatedAt.Add(time.Hour)
	if ok, err := ReserveVerifiedCommonAutoAdmission(context.Background(),
		f.config, f.grant, f.secret, cp, now); !ok || err != nil {
		t.Fatalf("original checkpoint was not accepted: %t %v", ok, err)
	}
	fabricated := cp
	fabricated.RunID = uuid.NewString()
	fabricated.StartedAt = now
	fabricated.UpdatedAt = now.Add(time.Minute)
	// Structurally valid but never journal-persisted. It cannot clear the
	// still-active older admission cooldown or mint any source success.
	if ok, err := ReserveVerifiedCommonAutoAdmission(context.Background(),
		f.config, f.grant, f.secret, fabricated, now.Add(2*time.Minute)); ok ||
		!errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("unpersisted terminal claim was trusted: %t %v", ok, err)
	}
	path, err := commonAutoAdmissionPath(f.config, f.grant)
	if err != nil {
		t.Fatal(err)
	}
	original, exists, err := readCommonAutoAdmission(path, f.grant)
	if err != nil || !exists || original.CheckpointRunID != cp.RunID ||
		original.Streak != 1 {
		t.Fatalf("forged checkpoint mutated durable cooldown: %+v %v", original, err)
	}
}

func TestCommonAutoAdmissionExponentialCooldownCapsAtTwoHours(t *testing.T) {
	f := makeCommonPlanFixture(t)
	cp := commonBatchHistoryFixture(f, "partial", 1,
		time.Date(2026, 10, 20, 10, 0, 0, 0, time.UTC))
	storeCommonAutoCheckpoint(t, f, cp, f.secret)
	start := cp.UpdatedAt.Add(time.Hour)
	for _, tt := range []struct {
		at     time.Time
		streak int
		delay  time.Duration
	}{
		{start, 1, 15 * time.Minute},
		{start.Add(15 * time.Minute), 2, 30 * time.Minute},
		{start.Add(45 * time.Minute), 3, time.Hour},
		{start.Add(105 * time.Minute), 4, 2 * time.Hour},
		{start.Add(225 * time.Minute), 4, 2 * time.Hour},
	} {
		allowed, err := ReserveVerifiedCommonAutoAdmission(context.Background(),
			f.config, f.grant, f.secret, cp, tt.at)
		if err != nil || !allowed {
			t.Fatalf("attempt %d denied: %t %v", tt.streak, allowed, err)
		}
		path, _ := commonAutoAdmissionPath(f.config, f.grant)
		got, exists, err := readCommonAutoAdmission(path, f.grant)
		if err != nil || !exists || got.Streak != tt.streak ||
			!got.NextAttemptAt.Equal(tt.at.Add(tt.delay)) {
			t.Fatalf("backoff miscalculated/cap bypassed: %+v %v", got, err)
		}
	}
}

func TestCommonAutoAdmissionSessionChangeAndCancellation(t *testing.T) {
	f := makeCommonPlanFixture(t)
	cp := commonBatchHistoryFixture(f, "partial", 1,
		time.Date(2026, 10, 20, 10, 0, 0, 0, time.UTC))
	storeCommonAutoCheckpoint(t, f, cp, f.secret)
	now := cp.UpdatedAt.Add(time.Hour)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if allowed, err := ReserveVerifiedCommonAutoAdmission(ctx, f.config, f.grant, f.secret, cp, now); allowed || !errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("cancelled admission wrote a file: %t %v", allowed, err)
	}
	normal := context.Background()
	if ok, err := ReserveVerifiedCommonAutoAdmission(normal, f.config, f.grant, f.secret, cp, now); !ok || err != nil {
		t.Fatalf("authenticated first attempt was refused: %t %v", ok, err)
	}
	rotated := cp
	rotated.RunID = uuid.NewString()
	rotated.StartedAt = now.Add(-time.Minute)
	// A session change alone cannot clear an old cooldown. The owning
	// device must establish a genuinely newer verified terminal attempt.
	rotated.UpdatedAt = now.Add(time.Second)
	rotated.SessionDigest = commonUploadSessionDigest("rotated-session")
	storeCommonAutoCheckpoint(t, f, rotated, "rotated-session")
	if ok, err := ReserveVerifiedCommonAutoAdmission(
		normal, f.config, f.grant, "rotated-session", rotated, now.Add(2*time.Second),
	); !ok || err != nil {
		t.Fatalf("new authenticated Owner session with fresh terminal run could not reset: %t %v", ok, err)
	}
	if allowed, err := ReserveVerifiedCommonAutoAdmission(normal, f.config, f.grant,
		f.secret, rotated, now.Add(3*time.Second)); allowed ||
		!errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("previous session reused new private checkpoint: %t %v", allowed, err)
	}
}
