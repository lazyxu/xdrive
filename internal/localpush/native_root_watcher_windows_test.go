//go:build windows

package localpush

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Windows change notifications are advisory wake-ups only; native contents
// and any original SQL Operation must still be revalidated by the Runner.
func TestNativeRootWatcherWindowsFileWakeAndCancellation(t *testing.T) {
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
	if err != nil || stop == nil {
		t.Fatalf("watch current strong Windows Root: stop=%v err=%v", stop != nil, err)
	}
	defer stop()
	if err := os.WriteFile(filepath.Join(f.grant.Path, "new-image.jpg"), []byte("synthetic native change"), 0o600); err != nil {
		t.Fatal(err)
	}
	select {
	case <-events:
	case <-time.After(5 * time.Second):
		t.Fatal("real Windows Root file update did not wake the Agent")
	}
	stop()
	cancel()
}
