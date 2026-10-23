//go:build linux || windows

package localpush

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/lazyxu/xdrive/internal/localpushcommon"
)

func TestNativeVersionedNestedOriginalJournalAndTransport(t *testing.T) {
	f := makeCommonPlanFixture(t)
	inner := filepath.Join(f.grant.Path, "photos", "2026")
	if err := os.MkdirAll(inner, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(inner, "photo.jpg"), []byte("native nested original"), 0o600); err != nil {
		t.Fatal(err)
	}
	snap, summary, err := ScanInventoryToJournal(context.Background(), f.config, f.grant,
		InventoryScanner{IncludeNativeIdentity: true})
	if err != nil || !summary.Complete {
		t.Fatalf("verified nested inventory: %+v %v", summary, err)
	}
	target := localpushcommon.Target{ParentID: 891, Name: "photo.jpg"}
	const relative = "photos/2026/photo.jpg"
	plan, err := PrepareVerifiedCommonUploadVersionedPlan(context.Background(),
		f.config, f.grant, f.secret, 7, snap.SnapshotSHA256, relative, target)
	if err != nil || plan.RelativePath != relative || plan.Target != target {
		t.Fatalf("persisted nested file identity: %+v %v", plan, err)
	}
	all, err := ListVerifiedCommonUploadVersionedPlans(f.config, f.grant, f.secret, relative)
	if err != nil || len(all) != 1 || all[0] != plan {
		t.Fatalf("read original nested file operation: %+v %v", all, err)
	}
	transport := &nativeCommonUploadProbe{plan: plan}
	got, err := UploadVerifiedCommonNativeVersionedOne(context.Background(),
		f.config, f.grant, snap.SnapshotSHA256, plan, transport,
		nativeCommonProof(f), nil)
	if err != nil || !got.Committed || got.OperationID != plan.OperationID ||
		transport.admissions != 1 || transport.binds != 1 || transport.byteOpens != 1 {
		t.Fatalf("nested native file upload bridge failed: %+v %+v %v", got, transport, err)
	}
	// Old first-file V1 remains TOP-LEVEL only. No legacy writer is retired.
	if _, err := PrepareVerifiedCommonUploadPlan(context.Background(),
		f.config, f.grant, f.secret, 7, snap.SnapshotSHA256, relative, target); !errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("legacy one-shot path accepted nested file: %v", err)
	}
}

func TestVersionedNestedPathsNeverEscapeVerifiedRoot(t *testing.T) {
	for _, bad := range []string{
		"", "../escape.txt", "a/../escape.txt", "/absolute/file",
		"a//double.txt", "a/./file", "a\\windows", "a:stream",
	} {
		if validCommonUploadVersionedRelativePath(bad) {
			t.Fatalf("unsafe native nested file accepted: %q", bad)
		}
	}
	for _, good := range []string{"alpha.txt", "a/b/c.txt", "2026/October/photo.jpg"} {
		if !validCommonUploadVersionedRelativePath(good) {
			t.Fatalf("valid native nested file rejected: %q", good)
		}
	}
}
