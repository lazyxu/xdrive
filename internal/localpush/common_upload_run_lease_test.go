//go:build linux || windows

package localpush

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestCommonBatchRunLeaseRejectsOtherLiveWriterAndReacquiresAfterRelease(t *testing.T) {
	f := makeCommonPlanFixture(t)
	ctx := context.Background()
	first, err := AcquireVerifiedCommonBatchRunLease(ctx, f.config, f.grant)
	if err != nil {
		t.Fatalf("owning Agent could not acquire Source-scoped lock: %v", err)
	}
	if next, err := AcquireVerifiedCommonBatchRunLease(ctx, f.config, f.grant); next != nil ||
		!errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("second Agent process obtained a live writer: %+v %v", next, err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	next, err := AcquireVerifiedCommonBatchRunLease(ctx, f.config, f.grant)
	if err != nil {
		t.Fatalf("restarted Agent could not acquire released lock: %v", err)
	}
	if err := next.Close(); err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS == "windows" {
		return
	}
	dir, err := commonUploadPlanJournalDir(f.config, f.grant)
	if err != nil {
		t.Fatal(err)
	}
	lock := filepath.Join(dir, "source-batch.lock")
	if err := os.Remove(lock); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "out")
	if err := os.WriteFile(outside, []byte("do not lock outside private journal"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, lock); err != nil {
		t.Fatal(err)
	}
	if _, err := AcquireVerifiedCommonBatchRunLease(ctx, f.config, f.grant); !errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("symlinked run lock was accepted: %v", err)
	}
}
