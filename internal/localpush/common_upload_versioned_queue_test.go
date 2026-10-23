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

func prepareVersionedFixture(f commonPlanFixture, relative string,
	target localpushcommon.Target,
) (localpushcommon.Plan, error) {
	return PrepareVerifiedCommonUploadVersionedPlan(context.Background(),
		f.config, f.grant, f.secret, 7, f.snap.SnapshotSHA256, relative, target)
}

func TestCommonVersionedOriginalsAllowNextCommittedRevisionWithoutReplacingHistory(t *testing.T) {
	f := makeCommonPlanFixture(t)
	first, err := prepareVersionedFixture(f, "alpha.txt", f.target)
	if err != nil {
		t.Fatalf("first operation: %v", err)
	}
	secondTarget := localpushcommon.Target{ParentID: f.target.ParentID, Name: "bravo.txt"}
	second, err := prepareVersionedFixture(f, "bravo.txt", secondTarget)
	if err != nil || first.OperationID == second.OperationID {
		t.Fatalf("independent file operation: %+v %v", second, err)
	}
	old, err := ListVerifiedCommonUploadVersionedPlans(f.config, f.grant, f.secret, "alpha.txt")
	if err != nil || len(old) != 1 || old[0] != first {
		t.Fatalf("original file operation unavailable: %+v %v", old, err)
	}
	// The pending creation intent is immutable. A modification cannot mint
	// a second creation operation under a different original content.
	if err := os.WriteFile(filepath.Join(f.grant.Path, "alpha.txt"),
		[]byte("updated alpha"), 0o600); err != nil {
		t.Fatal(err)
	}
	snap, _, err := ScanInventoryToJournal(context.Background(), f.config, f.grant,
		InventoryScanner{IncludeNativeIdentity: true})
	if err != nil {
		t.Fatal(err)
	}
	f.snap = snap
	if _, err := prepareVersionedFixture(f, "alpha.txt", f.target); !errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("same target revision minted a second operation: %v", err)
	}
	// Choosing the NEXT revision is deliberately a higher-level Agent
	// decision that requires current Server SQL receipt and current Node.
	newTarget := localpushcommon.Target{NodeID: 123, ExpectedRevision: 1}
	next, err := prepareVersionedFixture(f, "alpha.txt", newTarget)
	if err != nil || next.OperationID == first.OperationID || next.ContentSHA256 == first.ContentSHA256 {
		t.Fatalf("next revision operation not isolated: %+v %v", next, err)
	}
	replayed, err := prepareVersionedFixture(f, "alpha.txt", newTarget)
	if err != nil || replayed != next {
		t.Fatalf("restart did not reuse exact original: %+v %v", replayed, err)
	}
	all, err := ListVerifiedCommonUploadVersionedPlans(f.config, f.grant, f.secret, "alpha.txt")
	if err != nil || len(all) != 2 ||
		all[0].OperationID != first.OperationID || all[1].OperationID != next.OperationID {
		t.Fatalf("immutable earlier operation lost: %+v %v", all, err)
	}
}

func TestCommonVersionedLegacyMarkerOrCorruptPathFailsClosed(t *testing.T) {
	f := makeCommonPlanFixture(t)
	if _, err := prepareCommonFixture(t, f, "alpha.txt"); err != nil {
		t.Fatal(err)
	}
	if _, err := prepareVersionedFixture(f, "alpha.txt", f.target); !errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("legacy v2 original marker bypassed: %v", err)
	}
	if _, err := ListVerifiedCommonUploadVersionedPlans(f.config, f.grant, f.secret, "alpha.txt"); !errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("legacy original listing bypassed: %v", err)
	}
}

func TestCommonVersionedCorruptedOriginalBlocksReadback(t *testing.T) {
	f := makeCommonPlanFixture(t)
	if _, err := prepareVersionedFixture(f, "alpha.txt", f.target); err != nil {
		t.Fatal(err)
	}
	dir, err := commonUploadPlanJournalDir(f.config, f.grant)
	if err != nil {
		t.Fatal(err)
	}
	slot, err := commonUploadVersionedSlot(dir, "alpha.txt", 7, f.target)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(slot, []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := ListVerifiedCommonUploadVersionedPlans(f.config, f.grant, f.secret, "alpha.txt"); !errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("truncated durable original silently skipped: %v", err)
	}
	if _, err := prepareVersionedFixture(f, "alpha.txt", f.target); !errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("corrupted existing target revision replaced: %v", err)
	}
}
