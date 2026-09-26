package sourceagentidentity

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourceagent"
)

func TestStrongIdentitySurvivesDeviceChange(t *testing.T) {
	dir := t.TempDir()
	store, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	modified := time.Date(2026, 9, 26, 1, 2, 3, 0, time.UTC)
	first := observation(
		"fs:shared:10:42",
		"btime:shared:42:100:7",
		"ino:shared:42",
		"Shared/photo.jpg",
		10,
		modified,
	)
	id1, err := store.Resolve(first)
	if err != nil {
		t.Fatal(err)
	}
	if id1 != first.Filesystem.LegacyExternalID {
		t.Fatalf("first id=%q want legacy=%q", id1, first.Filesystem.LegacyExternalID)
	}
	if err := store.Flush(); err != nil {
		t.Fatal(err)
	}
	if err := store.Complete(); err != nil {
		t.Fatal(err)
	}

	reopened, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	second := observation(
		"fs:shared:99:42",
		"btime:shared:42:100:7",
		"ino:shared:42",
		"Shared/Renamed/photo.jpg",
		10,
		modified,
	)
	id2, err := reopened.Resolve(second)
	if err != nil {
		t.Fatal(err)
	}
	if id2 != id1 {
		t.Fatalf("remount changed stable id: got=%q want=%q", id2, id1)
	}
}

func TestStrongIdentityDetectsInodeReuse(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	modified := time.Date(2026, 9, 26, 1, 2, 3, 0, time.UTC)
	first := observation(
		"fs:shared:10:42",
		"btime:shared:42:100:1",
		"ino:shared:42",
		"Shared/old.jpg",
		10,
		modified,
	)
	oldID, err := store.Resolve(first)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Complete(); err != nil {
		t.Fatal(err)
	}
	if err := store.Complete(); err != nil {
		t.Fatal(err)
	}

	reused := observation(
		"fs:shared:10:42",
		"btime:shared:42:200:1",
		"ino:shared:42",
		"Shared/new.jpg",
		99,
		modified.Add(time.Hour),
	)
	newID, err := store.Resolve(reused)
	if err != nil {
		t.Fatal(err)
	}
	if newID == oldID || !strings.HasPrefix(newID, "fs2:") {
		t.Fatalf("inode reuse id=%q old=%q", newID, oldID)
	}
}

func TestWeakIdentityKeepsContinuousFileButRejectsAgedReuse(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	modified := time.Date(2026, 9, 26, 1, 2, 3, 0, time.UTC)
	first := observation(
		"fs:shared:10:55",
		"",
		"ino:shared:55",
		"Shared/a.jpg",
		10,
		modified,
	)
	id1, err := store.Resolve(first)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Complete(); err != nil {
		t.Fatal(err)
	}

	changed := observation(
		"fs:shared:99:55",
		"",
		"ino:shared:55",
		"Shared/a.jpg",
		20,
		modified.Add(time.Minute),
	)
	id2, err := store.Resolve(changed)
	if err != nil {
		t.Fatal(err)
	}
	if id2 != id1 {
		t.Fatalf("continuous weak identity changed: got=%q want=%q", id2, id1)
	}
	if err := store.Complete(); err != nil {
		t.Fatal(err)
	}

	// One complete generation without seeing this inode means it is no longer
	// safe to treat a later metadata-mismatching weak identity as the same file.
	if err := store.Complete(); err != nil {
		t.Fatal(err)
	}
	reused := observation(
		"fs:shared:99:55",
		"",
		"ino:shared:55",
		"Shared/reused.jpg",
		1,
		modified.Add(24*time.Hour),
	)
	id3, err := store.Resolve(reused)
	if err != nil {
		t.Fatal(err)
	}
	if id3 == id1 {
		t.Fatalf("aged weak inode reuse reused old id=%q", id1)
	}
}

func TestLegacyExternalIDCollisionAllocatesFS2(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	modified := time.Date(2026, 9, 26, 1, 2, 3, 0, time.UTC)
	first := observation(
		"fs:shared:10:77",
		"btime:shared:77:100:1",
		"ino:shared:77",
		"Shared/old.jpg",
		10,
		modified,
	)
	oldID, err := store.Resolve(first)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Complete(); err != nil {
		t.Fatal(err)
	}
	if err := store.Complete(); err != nil {
		t.Fatal(err)
	}

	reused := observation(
		"fs:shared:10:77",
		"btime:shared:77:200:1",
		"ino:shared:77",
		"Shared/new.jpg",
		20,
		modified.Add(time.Hour),
	)
	newID, err := store.Resolve(reused)
	if err != nil {
		t.Fatal(err)
	}
	if newID == oldID || !strings.HasPrefix(newID, "fs2:shared:") {
		t.Fatalf("legacy collision id=%q old=%q", newID, oldID)
	}
}

func TestIdentityStateCorruptionIsRejected(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "meta.json"), []byte("{broken"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(dir); err == nil {
		t.Fatal("corrupt identity state was silently accepted")
	}
}

func observation(legacy, strong, weak, path string, size int64, modified time.Time) sourceagent.IdentityObservation {
	return sourceagent.IdentityObservation{
		Filesystem: sourceagent.FilesystemIdentity{
			LegacyExternalID: legacy,
			StrongKey:        strong,
			WeakKey:          weak,
		},
		Kind:       meta.SourceItemKindFile,
		Path:       path,
		Size:       size,
		ModifiedAt: &modified,
	}
}
