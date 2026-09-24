//go:build windows && xdrive_e2e

package mount

import (
	"context"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
)

func (a *e2eAPI) addRemoteDirWithFile(dirName, fileName string, data []byte) (uint64, uint64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	dirID := a.nextID
	a.nextID++
	fileID := a.nextID
	a.nextID++
	a.entries[dirID] = &e2eEntry{node: client.Node{
		ID: dirID, ParentID: uint64ptr(1), Name: dirName, Type: "dir",
		Revision: 1, CreatedAt: now, UpdatedAt: now,
	}}
	a.entries[fileID] = &e2eEntry{
		node: client.Node{
			ID: fileID, ParentID: uint64ptr(dirID), Name: fileName, Type: "file",
			Size: int64(len(data)), Revision: 1, CreatedAt: now, UpdatedAt: now,
		},
		content: append([]byte(nil), data...),
	}
	return dirID, fileID
}

func TestWindowsCfAPISelectiveSyncAndCachePolicy(t *testing.T) {
	api := newE2EAPI()
	api.addRemoteDirWithFile("excluded", "hidden.txt", []byte("hidden"))
	_, keptFileID := api.addRemoteDirWithFile("kept", "offline.txt", []byte("keep-offline"))
	api.addRemoteDirWithFile("manual", "manual.txt", []byte("manual-content"))
	server := httptest.NewServer(api)
	defer server.Close()

	root := filepath.Join(t.TempDir(), "xDrive")
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- runPlatformWithOptions(ctx, client.New(server.URL, "e2e-token"), root, Options{
			ExcludedPaths:    []string{"excluded", "stale-missing"},
			AlwaysLocalPaths: []string{"kept"},
			CacheLimitBytes:  1,
		})
	}()

	keptPath := filepath.Join(root, "kept", "offline.txt")
	waitE2E(t, 20*time.Second, "always-local hydration", func() bool {
		state, err := Availability(keptPath)
		return err == nil && state.Pinned && state.AvailableOffline
	})
	if _, err := os.Lstat(filepath.Join(root, "excluded")); !os.IsNotExist(err) {
		t.Fatalf("excluded remote directory was materialized locally: %v", err)
	}

	manualDir := filepath.Join(root, "manual")
	manualFile := filepath.Join(manualDir, "manual.txt")
	waitE2E(t, 20*time.Second, "manual directory placeholder", func() bool {
		_, err := os.Lstat(manualFile)
		return err == nil
	})
	if err := KeepLocal(manualDir); err != nil {
		t.Fatal(err)
	}
	waitE2E(t, 10*time.Second, "recursive directory pin", func() bool {
		state, err := Availability(manualFile)
		return err == nil && state.Pinned && state.AvailableOffline
	})
	if err := MakeOnlineOnly(manualDir); err != nil {
		t.Fatal(err)
	}
	waitE2E(t, 10*time.Second, "recursive directory dehydration", func() bool {
		state, err := Availability(manualFile)
		return err == nil && state.OnlineOnly && !state.AvailableOffline
	})

	remotePath := filepath.Join(root, "remote.txt")
	waitE2E(t, 20*time.Second, "cache candidate placeholder", func() bool {
		_, err := os.Lstat(remotePath)
		return err == nil
	})
	content, err := os.ReadFile(remotePath)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "remote-v1" {
		t.Fatalf("hydrated cache candidate=%q", content)
	}

	activeWinProvider.RLock()
	provider := activeWinProvider.p
	activeWinProvider.RUnlock()
	if provider == nil {
		t.Fatal("Windows provider is not active")
	}
	provider.mu.Lock()
	provider.cacheGrace = 0
	provider.accessed[2] = time.Now().Add(-time.Hour)
	provider.accessed[keptFileID] = time.Now().Add(-time.Hour)
	provider.mu.Unlock()
	if err := provider.enforceCacheSnapshot(); err != nil {
		t.Fatal(err)
	}

	waitE2E(t, 10*time.Second, "LRU cache dehydration", func() bool {
		state, err := Availability(remotePath)
		return err == nil && state.OnlineOnly && !state.AvailableOffline
	})
	kept, err := Availability(keptPath)
	if err != nil {
		t.Fatal(err)
	}
	if !kept.Pinned || !kept.AvailableOffline {
		t.Fatalf("cache policy evicted always-local file: %+v", kept)
	}

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("provider did not stop")
	}
}
