//go:build linux

package localpush

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// A watcher hint is only metadata. The current Root's full scanner and
// immutable original SQL Operations remain the exclusive backup authority.
func TestNativeRootWatcherSeesExistingNestedFileAndStops(t *testing.T) {
	f := makeCommonPlanFixture(t)
	dir := filepath.Join(f.grant.Path, "nested", "child")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	events := make(chan struct{}, 1)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stop, err := WatchNativeRootChanges(ctx, f.grant, func() {
		select {
		case events <- struct{}{}:
		default:
		}
	})
	if err != nil {
		t.Fatalf("cannot watch current native Root: %v", err)
	}
	defer stop()
	file := filepath.Join(dir, "new-photo.jpg")
	if err := os.WriteFile(file, []byte("source-only fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	select {
	case <-events:
	case <-time.After(4 * time.Second):
		t.Fatal("nested file change failed to wake the owning Agent")
	}
	stop()
	cancel()
}

func TestNativeRootWatcherRejectsWeakOrRevokedRoot(t *testing.T) {
	f := makeCommonPlanFixture(t)
	weak := f.grant
	weak.StrongIdentity = false
	if stop, err := WatchNativeRootChanges(context.Background(), weak, func() {}); err == nil || stop != nil {
		t.Fatal("weak Root was allowed to subscribe")
	}
	if stop, err := WatchNativeRootChanges(context.Background(), f.grant, nil); err == nil || stop != nil {
		t.Fatal("nil wake handler was allowed")
	}
}

func TestNativeRootWatcherNewDirectoryIsObservedWithoutFollowingSymlink(t *testing.T) {
	f := makeCommonPlanFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events := make(chan struct{}, 1)
	stop, err := WatchNativeRootChanges(ctx, f.grant, func() {
		select {
		case events <- struct{}{}:
		default:
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	defer stop()

	nested := filepath.Join(f.grant.Path, "new-directory")
	if err := os.Mkdir(nested, 0o700); err != nil {
		t.Fatal(err)
	}
	select {
	case <-events:
	case <-time.After(4 * time.Second):
		t.Fatal("new directory did not trigger a watcher hint")
	}
	// Ensure that the watch manager has processed the directory creation
	// before checking a subsequent nested file event.
	time.Sleep(700 * time.Millisecond)
	select {
	case <-events:
	default:
	}
	if err := os.WriteFile(filepath.Join(nested, "after.jpg"), []byte("new native file"), 0o600); err != nil {
		t.Fatal(err)
	}
	select {
	case <-events:
	case <-time.After(4 * time.Second):
		t.Fatal("new nested directory was not recursively observed")
	}

	// Creating a symlink itself can wake the parent; the directory behind
	// it must never be traversed or subscribed by a Root-scoped watcher.
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(f.grant.Path, "outside-link")); err != nil {
		t.Fatal(err)
	}
	time.Sleep(500 * time.Millisecond)
	select {
	case <-events:
	default:
	}
	if err := os.WriteFile(filepath.Join(outside, "private-file"), []byte("outside"), 0o600); err != nil {
		t.Fatal(err)
	}
	select {
	case <-events:
		t.Fatal("out-of-Root symlink target was watched")
	case <-time.After(600 * time.Millisecond):
	}
}
