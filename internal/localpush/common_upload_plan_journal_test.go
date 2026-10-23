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

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/localpushcommon"
)

type commonPlanFixture struct {
	config string
	grant  RootGrant
	snap   InventoryJournalSnapshot
	target localpushcommon.Target
	secret string
}

func makeCommonPlanFixture(t *testing.T) commonPlanFixture {
	t.Helper()
	base := t.TempDir()
	root := filepath.Join(base, "original")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"alpha.txt", "bravo.txt"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("immutable-"+name), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	grant, err := PrepareRootGrant("https://server.test", "owning-user", 42, uuid.NewString(), root)
	if err != nil || !grant.StrongIdentity {
		t.Fatalf("strong local Root unavailable: %+v %v", grant, err)
	}
	config := filepath.Join(base, "config")
	if err := SaveRootGrant(config, grant); err != nil {
		t.Fatal(err)
	}
	snap, summary, err := ScanInventoryToJournal(
		context.Background(), config, grant, InventoryScanner{
			BatchSize: 2, IncludeNativeIdentity: true,
		})
	if err != nil || !summary.Complete || summary.MissingInferenceSafe ||
		snap.Items != 2 || snap.SnapshotSHA256 == "" {
		t.Fatalf("verified local journal unavailable: %+v %+v %v", snap, summary, err)
	}
	return commonPlanFixture{
		config: config, grant: grant, snap: snap,
		secret: "do-not-store-authenticated-owner-session-id",
		target: localpushcommon.Target{ParentID: 999, Name: "alpha.txt"},
	}
}

func prepareCommonFixture(t *testing.T, f commonPlanFixture, relative string) (localpushcommon.Plan, error) {
	t.Helper()
	target := f.target
	target.Name = relative
	return PrepareVerifiedCommonUploadPlan(
		context.Background(), f.config, f.grant, f.secret, 7,
		f.snap.SnapshotSHA256, relative, target,
	)
}

func TestCommonUploadPlanPersistedBeforeHTTPAndReplayOriginal(t *testing.T) {
	f := makeCommonPlanFixture(t)
	first, err := prepareCommonFixture(t, f, "alpha.txt")
	if err != nil || first.OperationID == "" || first.OwnerSession != f.secret {
		t.Fatalf("first original Plan not issued: %+v %v", first, err)
	}
	same, err := prepareCommonFixture(t, f, "alpha.txt")
	if err != nil || same != first {
		t.Fatalf("restart minted new Operation ID: original=%+v repeat=%+v err=%v", first, same, err)
	}
	key, err := first.ResumeKey()
	repeat, repeatErr := same.ResumeKey()
	if err != nil || repeatErr != nil || key != repeat {
		t.Fatalf("original operation resumed with changed upload identity: %q %q", key, repeat)
	}
	dir, err := commonUploadPlanJournalDir(f.config, f.grant)
	if err != nil {
		t.Fatal(err)
	}
	slot := commonUploadPlanSlot(dir, "alpha.txt")
	bytes, err := os.ReadFile(slot)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(bytes), f.secret) || strings.Contains(string(bytes), "DeviceToken") ||
		!strings.Contains(string(bytes), first.OperationID) {
		t.Fatal("original persistent Plan omitted identity or leaked authenticated session")
	}
	if runtime.GOOS != "windows" {
		info, err := os.Lstat(slot)
		if err != nil || info.Mode().Perm()&0o077 != 0 {
			t.Fatalf("pending operation journal was not private: %+v %v", info, err)
		}
	}
	second, err := prepareCommonFixture(t, f, "bravo.txt")
	if err != nil || second.OperationID == first.OperationID || second.RelativePath != "bravo.txt" {
		t.Fatalf("different file did not get independent original identity: %+v %v", second, err)
	}
}

func TestCommonUploadPlanNeverReplacedOnChangedSessionOrFile(t *testing.T) {
	f := makeCommonPlanFixture(t)
	first, err := prepareCommonFixture(t, f, "alpha.txt")
	if err != nil {
		t.Fatal(err)
	}
	otherSession := f
	otherSession.secret = "rotated-owner-session"
	if _, err := prepareCommonFixture(t, otherSession, "alpha.txt"); !errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("other account session recovered original Operation: %v", err)
	}
	changedTarget := f
	changedTarget.target.ParentID++
	if _, err := prepareCommonFixture(t, changedTarget, "alpha.txt"); !errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("changed target overwrote active original: %v", err)
	}
	changedRevision, err := PrepareVerifiedCommonUploadPlan(
		context.Background(), f.config, f.grant, f.secret, 8,
		f.snap.SnapshotSHA256, "alpha.txt", f.target)
	if !errors.Is(err, ErrCommonUploadPlanQuarantined) || changedRevision.OperationID != "" {
		t.Fatalf("new Source revision reused original slot: %+v %v", changedRevision, err)
	}
	same, err := prepareCommonFixture(t, f, "alpha.txt")
	if err != nil || same.OperationID != first.OperationID {
		t.Fatalf("original operation was not preserved: %+v %v", same, err)
	}
	if err := os.WriteFile(filepath.Join(f.grant.Path, "alpha.txt"), []byte("replaced original source"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := prepareCommonFixture(t, f, "alpha.txt"); err == nil {
		t.Fatal("mutated native file was accepted as original source")
	}
}

func TestCommonUploadPlanCorruptOrSymlinkSlotFailsClosed(t *testing.T) {
	f := makeCommonPlanFixture(t)
	if _, err := prepareCommonFixture(t, f, "alpha.txt"); err != nil {
		t.Fatal(err)
	}
	dir, err := commonUploadPlanJournalDir(f.config, f.grant)
	if err != nil {
		t.Fatal(err)
	}
	slot := commonUploadPlanSlot(dir, "alpha.txt")
	if err := os.WriteFile(slot, []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := prepareCommonFixture(t, f, "alpha.txt"); !errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("truncated O_EXCL journal caused unsafe retry: %v", err)
	}
	if err := os.Remove(slot); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "outside.json")
	if err := os.WriteFile(outside, []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, slot); err != nil {
		t.Skipf("symlink privilege unavailable: %v", err)
	}
	if _, err := prepareCommonFixture(t, f, "alpha.txt"); !errors.Is(err, ErrCommonUploadPlanQuarantined) {
		t.Fatalf("symlink slot escaped private journal: %v", err)
	}
}
