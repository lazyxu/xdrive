//go:build linux || windows

package localpush

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestCommonBatchCheckpointSurvivesRestartWithoutInventingCompletion(t *testing.T) {
	f := makeCommonPlanFixture(t)
	ctx := context.Background()
	cp := CommonBatchCheckpoint{
		Version: commonBatchCheckpointVersion, RunID: uuid.NewString(),
		SourceID: f.grant.SourceID, SourceRevision: 7,
		RootFingerprint: f.grant.Fingerprint,
		SessionDigest:   commonUploadSessionDigest(f.secret),
		State:           "running", InspectedFiles: 3,
		ConfirmedFiles: 1, SkippedFiles: 1, UnsupportedFiles: 1,
		ConfirmedBytes: 12, UpdatedAt: time.Now().UTC(),
	}
	if err := StoreVerifiedCommonBatchCheckpoint(ctx, f.config, f.grant, f.secret, 7, cp); err != nil {
		t.Fatalf("durable checkpoint unavailable: %v", err)
	}
	recovered, err := ReadVerifiedCommonBatchCheckpoint(ctx, f.config, f.grant, f.secret, 7)
	if err != nil || recovered != cp {
		t.Fatalf("fresh Agent cannot read exact last run: %+v %v", recovered, err)
	}
	if _, err := ReadVerifiedCommonBatchCheckpoint(ctx, f.config, f.grant, "rotated-owner-session", 7); !errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("rotated Owner session accessed old progress: %v", err)
	}
	if _, err := ReadVerifiedCommonBatchCheckpoint(ctx, f.config, f.grant, f.secret, 8); !errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("different Source revision obtained stale run status: %v", err)
	}
	cp.State = "partial"
	cp.UpdatedAt = cp.UpdatedAt.Add(time.Second)
	if err := StoreVerifiedCommonBatchCheckpoint(ctx, f.config, f.grant, f.secret, 7, cp); err != nil {
		t.Fatal(err)
	}
	same, err := ReadVerifiedCommonBatchCheckpoint(ctx, f.config, f.grant, f.secret, 7)
	if err != nil || same != cp || same.BackupComplete || same.CurrentCASVerified {
		t.Fatalf("partial original proof was promoted to a full backup: %+v %v", same, err)
	}
}

func TestCommonBatchCheckpointRejectsCorruptionAndSymlinks(t *testing.T) {
	f := makeCommonPlanFixture(t)
	ctx := context.Background()
	cp := CommonBatchCheckpoint{
		Version: 1, RunID: uuid.NewString(), SourceID: f.grant.SourceID,
		SourceRevision: 7, RootFingerprint: f.grant.Fingerprint,
		SessionDigest: commonUploadSessionDigest(f.secret),
		State:         "partial", UpdatedAt: time.Now().UTC(),
	}
	p, err := commonBatchCheckpointPath(f.config, f.grant)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadVerifiedCommonBatchCheckpoint(ctx, f.config, f.grant, f.secret, 7); !errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("truncated run snapshot appeared valid: %v", err)
	}
	if runtime.GOOS != "windows" {
		if err := os.Remove(p); err != nil {
			t.Fatal(err)
		}
		outside := filepath.Join(t.TempDir(), "outsider")
		if err := os.WriteFile(outside, []byte(strings.Repeat("X", 32)), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(outside, p); err != nil {
			t.Fatal(err)
		}
		if err := StoreVerifiedCommonBatchCheckpoint(ctx, f.config, f.grant, f.secret, 7, cp); !errors.Is(err, ErrCommonUploadPlanQuarantined) {
			t.Fatalf("symlink status destination was accepted: %v", err)
		}
	}
}

// Paused and cancelled mean no more files will be scheduled in this run.
// Neither state is a physical CANCEL nor a verified complete Source.
func TestCommonBatchCheckpointPersistsSchedulingStopWithoutFalseBackupProof(t *testing.T) {
	f := makeCommonPlanFixture(t)
	ctx := context.Background()
	base := CommonBatchCheckpoint{
		Version: commonBatchCheckpointVersion, RunID: uuid.NewString(),
		SourceID: f.grant.SourceID, SourceRevision: 7,
		RootFingerprint: f.grant.Fingerprint,
		SessionDigest:   commonUploadSessionDigest(f.secret),
		InspectedFiles:  5, ConfirmedFiles: 2, SkippedFiles: 2,
		ConfirmedBytes: 4096, UpdatedAt: time.Now().UTC(),
	}
	for _, state := range []string{"paused", "cancelled"} {
		t.Run(state, func(t *testing.T) {
			checkpoint := base
			checkpoint.State = state
			if err := StoreVerifiedCommonBatchCheckpoint(
				ctx, f.config, f.grant, f.secret, 7, checkpoint,
			); err != nil {
				t.Fatal(err)
			}
			read, err := ReadVerifiedCommonBatchCheckpoint(ctx, f.config, f.grant, f.secret, 7)
			if err != nil || read != checkpoint || read.BackupComplete ||
				read.CurrentCASVerified || read.RetirementSafe {
				t.Fatalf("stop checkpoint forged terminal remote status: %+v, %v", read, err)
			}
		})
	}
	unsafe := base
	unsafe.State = "cancelled"
	unsafe.BackupComplete = true
	if err := StoreVerifiedCommonBatchCheckpoint(
		ctx, f.config, f.grant, f.secret, 7, unsafe,
	); !errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("cancelled incorrectly became complete Source: %v", err)
	}
}
