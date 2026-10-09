package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/secretstore"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// Test first: actual CloudMediaThumbnail, the production Agent in-memory
// cache, real HTTP conditional GET and owner-scoped userconfig.NewClient.
// The source changes while an existing 3600-second MaxAge is still fresh.
func TestAgentCloudMediaThumbnailOverwriteRevalidatesUnknownRevision(t *testing.T) {
	root := t.TempDir()
	configDir := filepath.Join(root, "config")
	t.Setenv("XDG_CONFIG_HOME", configDir)
	t.Setenv("APPDATA", configDir)
	t.Setenv("HOME", filepath.Join(root, "home"))
	t.Setenv("USERPROFILE", filepath.Join(root, "home"))
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")

	type item struct{ revision, requests int }
	var lock sync.Mutex
	items := map[uint64]*item{}
	for i := uint64(617); i < 620; i++ {
		items[i] = &item{revision: 3}
	}
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var id uint64
		if _, err := fmt.Sscanf(r.URL.Path, "/api/v1/media/items/%d/thumbnail", &id); err != nil {
			http.NotFound(w, r)
			return
		}
		lock.Lock()
		it := items[id]
		if it == nil {
			lock.Unlock()
			http.NotFound(w, r)
			return
		}
		it.requests++
		revision := it.revision
		lock.Unlock()
		tag := fmt.Sprintf("\"thumb-%d-rev-%d\"", id, revision)
		w.Header().Set("ETag", tag)
		w.Header().Set("Cache-Control", "private, max-age=3600")
		w.Header().Set("Content-Type", "image/jpeg")
		if r.Header.Get("If-None-Match") == tag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		_, _ = w.Write([]byte(fmt.Sprintf("thumb-%d-revision-%d", id, revision)))
	}))
	defer remote.Close()

	cfg := userconfig.Config{Server: remote.URL, Username: "alice", SessionID: "thumb-overwrite-test"}
	if err := userconfig.Save(cfg); err != nil {
		t.Fatal(err)
	}
	dir, err := userconfig.Dir()
	if err != nil {
		t.Fatal(err)
	}
	if err := secretstore.Save(dir, cfg.SessionID, "test", secretstore.Credentials{
		AccessToken:     "test-token",
		AccessExpiresAt: time.Now().Add(2 * time.Hour),
	}); err != nil {
		t.Fatal(err)
	}

	ctrl := &agentController{thumbnailCache: newAgentMediaThumbnailCache(256, 32<<20)}
	ctx := context.Background()
	for id := uint64(617); id < 620; id++ {
		t.Run(fmt.Sprintf("node-%d", id), func(t *testing.T) {
			before, err := ctrl.CloudMediaThumbnail(ctx, id)
			if err != nil {
				t.Fatal(err)
			}
			lock.Lock()
			items[id].revision = 4
			lock.Unlock()
			after, err := ctrl.CloudMediaThumbnail(ctx, id)
			if err != nil {
				t.Fatal(err)
			}
			lock.Lock()
			count := items[id].requests
			lock.Unlock()
			wanted := fmt.Sprintf("thumb-%d-revision-4", id)
			t.Logf("GALLERY_AGENT_THUMB_CACHE_SAMPLE node=%d before=%q after=%q HTTP_GETs=%d expected=%q",
				id, string(before.Data), string(after.Data), count, wanted)
			if !strings.Contains(string(before.Data), "revision-3") {
				t.Fatalf("invalid initial thumbnail: %q", before.Data)
			}
			if string(after.Data) != wanted {
				t.Fatalf("Agent returned stale bytes after Server revision changed: node=%d got=%q want=%q",
					id, after.Data, wanted)
			}
			if count != 2 {
				t.Fatalf("Agent must make HTTP conditional GET after unknown-revision overwrite: node=%d got=%d want=2", id, count)
			}
		})
	}
}
