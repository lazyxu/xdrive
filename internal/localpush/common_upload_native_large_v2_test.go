//go:build linux || windows

package localpush

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/lazyxu/xdrive/internal/localpushcommon"
)

func TestVersionedNativeCommonUploadStreamsAboveLegacy64MiBBound(t *testing.T) {
	f := makeCommonPlanFixture(t)
	const size = int64(65 << 20)
	name := "large-video.bin"
	file, err := os.OpenFile(filepath.Join(f.grant.Path, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(size); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	snap, summary, err := ScanInventoryToJournal(
		context.Background(), f.config, f.grant,
		InventoryScanner{IncludeNativeIdentity: true})
	if err != nil || !summary.Complete || snap.SnapshotSHA256 == "" {
		t.Fatalf("native full inventory missing: %+v %v", summary, err)
	}
	target := localpushcommon.Target{ParentID: 999, Name: name}
	// The historical first-file route remains limited; no accidental
	// migration, Stage retirement or bypass of its 64 MiB fence.
	if _, err := PrepareVerifiedCommonUploadPlan(
		context.Background(), f.config, f.grant, f.secret, 7,
		snap.SnapshotSHA256, name, target); err == nil {
		t.Fatal("legacy first-file plan accepted an oversized file")
	}
	plan, err := PrepareVerifiedCommonUploadVersionedPlan(
		context.Background(), f.config, f.grant, f.secret, 7,
		snap.SnapshotSHA256, name, target)
	if err != nil || plan.Size != size {
		t.Fatalf("v2 native large-file original was rejected: %+v %v", plan, err)
	}
	probe := &nativeCommonUploadProbe{plan: plan}
	receipt, err := UploadVerifiedCommonNativeVersionedOne(context.Background(),
		f.config, f.grant, snap.SnapshotSHA256, plan, probe,
		nativeCommonProof(f), nil)
	if err != nil || !receipt.Committed ||
		receipt.Size != size || receipt.OperationID != plan.OperationID ||
		probe.admissions != 1 || probe.binds != 1 || probe.byteOpens != 1 {
		t.Fatalf("real 65MiB original native bytes did not stream: %+v %+v %v", receipt, probe, err)
	}
}
