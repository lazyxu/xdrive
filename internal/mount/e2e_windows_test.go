//go:build windows && xdrive_e2e

package mount

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
)

type e2eEntry struct {
	node    client.Node
	content []byte
}

type e2eAPI struct {
	mu      sync.Mutex
	nextID  uint64
	entries map[uint64]*e2eEntry
}

func newE2EAPI() *e2eAPI {
	now := time.Now()
	return &e2eAPI{
		nextID: 3,
		entries: map[uint64]*e2eEntry{
			1: {node: client.Node{ID: 1, Name: "", Type: "dir", Revision: 1, CreatedAt: now, UpdatedAt: now}},
			2: {node: client.Node{ID: 2, ParentID: uint64ptr(1), Name: "remote.txt", Type: "file", Size: 9, Revision: 1, CreatedAt: now, UpdatedAt: now}, content: []byte("remote-v1")},
		},
	}
}

func uint64ptr(v uint64) *uint64 { return &v }

func (a *e2eAPI) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	path := strings.TrimPrefix(r.URL.Path, "/api/v1")
	switch {
	case r.Method == http.MethodGet && path == "/nodes/root":
		a.writeNode(w, 1)
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/nodes/") && strings.HasSuffix(path, "/children"):
		id, ok := parseE2EID(strings.TrimSuffix(strings.TrimPrefix(path, "/nodes/"), "/children"))
		if !ok {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		a.mu.Lock()
		out := []client.Node{}
		for _, e := range a.entries {
			if e.node.ParentID != nil && *e.node.ParentID == id {
				out = append(out, e.node)
			}
		}
		a.mu.Unlock()
		_ = json.NewEncoder(w).Encode(out)
	case r.Method == http.MethodPost && strings.HasPrefix(path, "/nodes/") && strings.HasSuffix(path, "/files"):
		id, ok := parseE2EID(strings.TrimSuffix(strings.TrimPrefix(path, "/nodes/"), "/files"))
		if !ok {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		if err := r.ParseMultipartForm(8 << 20); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		f, fh, err := r.FormFile("file")
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		defer f.Close()
		data, _ := io.ReadAll(f)
		a.mu.Lock()
		nodeID := a.nextID
		a.nextID++
		now := time.Now()
		e := &e2eEntry{node: client.Node{ID: nodeID, ParentID: uint64ptr(id), Name: fh.Filename, Type: "file", Size: int64(len(data)), Revision: 1, CreatedAt: now, UpdatedAt: now}, content: data}
		a.entries[nodeID] = e
		a.mu.Unlock()
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(e.node)
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/files/") && strings.HasSuffix(path, "/content"):
		id, ok := parseE2EID(strings.TrimSuffix(strings.TrimPrefix(path, "/files/"), "/content"))
		if !ok {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		a.mu.Lock()
		e := a.entries[id]
		if e == nil {
			a.mu.Unlock()
			http.NotFound(w, r)
			return
		}
		n := e.node
		data := append([]byte(nil), e.content...)
		a.mu.Unlock()
		w.Header().Set("ETag", fmt.Sprintf("\"%d\"", n.Revision))
		http.ServeContent(w, r, n.Name, n.UpdatedAt, bytes.NewReader(data))
	case r.Method == http.MethodPut && strings.HasPrefix(path, "/files/") && strings.HasSuffix(path, "/content"):
		id, ok := parseE2EID(strings.TrimSuffix(strings.TrimPrefix(path, "/files/"), "/content"))
		if !ok {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		expected := parseIfMatchE2E(r.Header.Get("If-Match"))
		data, _ := io.ReadAll(r.Body)
		a.mu.Lock()
		e := a.entries[id]
		if e == nil {
			a.mu.Unlock()
			http.NotFound(w, r)
			return
		}
		if expected == 0 || expected != e.node.Revision {
			current := e.node.Revision
			a.mu.Unlock()
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": "revision_conflict", "expected_revision": expected, "current_revision": current})
			return
		}
		e.content = data
		e.node.Size = int64(len(data))
		e.node.Revision++
		e.node.UpdatedAt = time.Now()
		n := e.node
		a.mu.Unlock()
		_ = json.NewEncoder(w).Encode(n)
	case r.Method == http.MethodDelete && strings.HasPrefix(path, "/nodes/"):
		id, ok := parseE2EID(strings.TrimPrefix(path, "/nodes/"))
		if !ok {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		expected := parseIfMatchE2E(r.Header.Get("If-Match"))
		a.mu.Lock()
		e := a.entries[id]
		if e == nil {
			a.mu.Unlock()
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if expected != e.node.Revision {
			current := e.node.Revision
			a.mu.Unlock()
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": "revision_conflict", "expected_revision": expected, "current_revision": current})
			return
		}
		delete(a.entries, id)
		a.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	default:
		http.NotFound(w, r)
	}
}

func (a *e2eAPI) writeNode(w http.ResponseWriter, id uint64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	e := a.entries[id]
	if e == nil {
		http.Error(w, "missing", http.StatusNotFound)
		return
	}
	_ = json.NewEncoder(w).Encode(e.node)
}

func (a *e2eAPI) byName(name string) (client.Node, []byte, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, e := range a.entries {
		if e.node.Name == name {
			return e.node, append([]byte(nil), e.content...), true
		}
	}
	return client.Node{}, nil, false
}

func (a *e2eAPI) externalOverwrite(id uint64, data []byte) {
	a.mu.Lock()
	defer a.mu.Unlock()
	e := a.entries[id]
	e.content = append([]byte(nil), data...)
	e.node.Size = int64(len(data))
	e.node.Revision++
	e.node.UpdatedAt = time.Now().Add(time.Second)
}

func parseE2EID(s string) (uint64, bool) {
	s = strings.Trim(s, "/")
	id, err := strconv.ParseUint(s, 10, 64)
	return id, err == nil && id > 0
}

func parseIfMatchE2E(s string) uint64 {
	s = strings.Trim(strings.TrimSpace(s), "\"")
	id, _ := strconv.ParseUint(s, 10, 64)
	return id
}

func waitE2E(t *testing.T, timeout time.Duration, label string, fn func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if fn() {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", label)
}

func TestWindowsCfAPIE2E(t *testing.T) {
	api := newE2EAPI()
	server := httptest.NewServer(api)
	defer server.Close()

	root := filepath.Join(t.TempDir(), "xDrive")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- runPlatform(ctx, client.New(server.URL, "e2e-token"), root)
	}()

	remotePath := filepath.Join(root, "remote.txt")
	waitE2E(t, 20*time.Second, "initial placeholder", func() bool {
		st, err := os.Stat(remotePath)
		return err == nil && st.Size() == 9
	})
	content, err := os.ReadFile(remotePath)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "remote-v1" {
		t.Fatalf("hydrated content=%q", content)
	}

	localPath := filepath.Join(root, "local.txt")
	if err := os.WriteFile(localPath, []byte("local-v1"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitE2E(t, 15*time.Second, "local upload", func() bool {
		_, data, ok := api.byName("local.txt")
		return ok && string(data) == "local-v1"
	})

	if err := os.WriteFile(remotePath, []byte("local-v2"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitE2E(t, 15*time.Second, "local overwrite", func() bool {
		n, data, ok := api.byName("remote.txt")
		return ok && n.Revision >= 2 && string(data) == "local-v2"
	})

	// Synchronize with a reconcile tick, then create a deterministic stale-write
	// window before the next 3-second scan.
	tickPath := filepath.Join(root, "tick.txt")
	if err := os.WriteFile(tickPath, []byte("tick"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitE2E(t, 15*time.Second, "tick upload", func() bool {
		_, _, ok := api.byName("tick.txt")
		return ok
	})

	n, _, ok := api.byName("remote.txt")
	if !ok {
		t.Fatal("remote.txt disappeared")
	}
	if err := os.WriteFile(remotePath, []byte("local-conflict"), 0o644); err != nil {
		t.Fatal(err)
	}
	api.externalOverwrite(n.ID, []byte("server-wins"))

	waitE2E(t, 20*time.Second, "conflict copy", func() bool {
		api.mu.Lock()
		defer api.mu.Unlock()
		for _, e := range api.entries {
			if strings.HasPrefix(e.node.Name, "remote (conflict ") && string(e.content) == "local-conflict" {
				return true
			}
		}
		return false
	})
	_, final, ok := api.byName("remote.txt")
	if !ok || string(final) != "server-wins" {
		t.Fatalf("server winner lost: ok=%v content=%q", ok, final)
	}
	waitE2E(t, 20*time.Second, "restored server file", func() bool {
		got, err := os.ReadFile(remotePath)
		return err == nil && string(got) == "server-wins"
	})

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

// Keep multipart imported in this platform-tagged E2E file so future upload
// extensions can share the same fake server without changing its build shape.
var _ = multipart.ErrMessageTooLarge
