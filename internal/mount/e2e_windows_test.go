//go:build windows && xdrive_e2e

package mount

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
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

type e2eUpload struct {
	session client.UploadSession
	init    client.UploadInit
	chunks  map[int][]byte
	hashes  map[int]string
}

type e2eAPI struct {
	mu         sync.Mutex
	nextID     uint64
	nextUpload int
	entries    map[uint64]*e2eEntry
	uploads    map[string]*e2eUpload
}

func newE2EAPI() *e2eAPI {
	now := time.Now()
	return &e2eAPI{
		nextID:     3,
		nextUpload: 1,
		uploads:    map[string]*e2eUpload{},
		entries: map[uint64]*e2eEntry{
			1: {node: client.Node{ID: 1, Name: "", Type: "dir", Revision: 1, CreatedAt: now, UpdatedAt: now}},
			2: {node: client.Node{ID: 2, ParentID: uint64ptr(1), Name: "remote.txt", Type: "file", Size: 9, Revision: 1, CreatedAt: now, UpdatedAt: now}, content: []byte("remote-v1")},
		},
	}
}

func uint64ptr(v uint64) *uint64 { return &v }

func sameUint64Ptr(a, b *uint64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

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
	case r.Method == http.MethodPost && path == "/uploads":
		var init client.UploadInit
		if err := json.NewDecoder(r.Body).Decode(&init); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		a.mu.Lock()
		for _, upload := range a.uploads {
			if upload.init.ResumeKey == init.ResumeKey &&
				upload.init.Size == init.Size &&
				upload.init.ExpectedRevision == init.ExpectedRevision &&
				sameUint64Ptr(upload.init.ParentID, init.ParentID) &&
				sameUint64Ptr(upload.init.NodeID, init.NodeID) &&
				upload.init.Name == init.Name {
				out := upload.session
				out.Received = make([]client.UploadPart, 0, len(upload.hashes))
				for index, hash := range upload.hashes {
					out.Received = append(out.Received, client.UploadPart{Index: index, Size: int64(len(upload.chunks[index])), SHA256: hash})
				}
				a.mu.Unlock()
				_ = json.NewEncoder(w).Encode(out)
				return
			}
		}
		id := fmt.Sprintf("upload-%d", a.nextUpload)
		a.nextUpload++
		chunkSize := init.ChunkSize
		if chunkSize == 0 {
			chunkSize = client.DefaultUploadChunkSize
		}
		count := 0
		if init.Size > 0 {
			count = int((init.Size + chunkSize - 1) / chunkSize)
		}
		session := client.UploadSession{
			ID: id, ParentID: init.ParentID, NodeID: init.NodeID, Name: init.Name,
			Size: init.Size, ChunkSize: chunkSize, ChunkCount: count, SHA256: init.SHA256,
			ResumeKey: init.ResumeKey, ExpectedRevision: init.ExpectedRevision,
			Status: "active", ExpiresAt: time.Now().Add(time.Hour),
		}
		a.uploads[id] = &e2eUpload{session: session, init: init, chunks: map[int][]byte{}, hashes: map[int]string{}}
		a.mu.Unlock()
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(session)
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/uploads/"):
		id := strings.TrimPrefix(path, "/uploads/")
		a.mu.Lock()
		upload := a.uploads[id]
		if upload == nil {
			a.mu.Unlock()
			http.NotFound(w, r)
			return
		}
		out := upload.session
		out.Received = make([]client.UploadPart, 0, len(upload.hashes))
		for index, hash := range upload.hashes {
			out.Received = append(out.Received, client.UploadPart{Index: index, Size: int64(len(upload.chunks[index])), SHA256: hash})
		}
		a.mu.Unlock()
		_ = json.NewEncoder(w).Encode(out)
	case r.Method == http.MethodPut && strings.HasPrefix(path, "/uploads/") && strings.Contains(path, "/chunks/"):
		rest := strings.TrimPrefix(path, "/uploads/")
		parts := strings.Split(rest, "/chunks/")
		if len(parts) != 2 {
			http.Error(w, "bad chunk path", http.StatusBadRequest)
			return
		}
		index, err := strconv.Atoi(parts[1])
		if err != nil {
			http.Error(w, "bad chunk index", http.StatusBadRequest)
			return
		}
		data, _ := io.ReadAll(r.Body)
		sum := sha256.Sum256(data)
		actual := hex.EncodeToString(sum[:])
		if actual != r.Header.Get("X-Chunk-SHA256") {
			w.WriteHeader(http.StatusUnprocessableEntity)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": "chunk_hash_mismatch"})
			return
		}
		a.mu.Lock()
		upload := a.uploads[parts[0]]
		if upload == nil || index < 0 || index >= upload.session.ChunkCount {
			a.mu.Unlock()
			http.NotFound(w, r)
			return
		}
		upload.chunks[index] = append([]byte(nil), data...)
		upload.hashes[index] = actual
		a.mu.Unlock()
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(client.UploadPart{Index: index, Size: int64(len(data)), SHA256: actual})
	case r.Method == http.MethodPost && strings.HasPrefix(path, "/uploads/") && strings.HasSuffix(path, "/finalize"):
		id := strings.TrimSuffix(strings.TrimPrefix(path, "/uploads/"), "/finalize")
		a.mu.Lock()
		upload := a.uploads[id]
		if upload == nil {
			a.mu.Unlock()
			http.NotFound(w, r)
			return
		}
		if upload.session.Status == "finalized" {
			out := upload.session
			a.mu.Unlock()
			_ = json.NewEncoder(w).Encode(out)
			return
		}
		var assembled []byte
		for index := 0; index < upload.session.ChunkCount; index++ {
			chunk, ok := upload.chunks[index]
			if !ok {
				a.mu.Unlock()
				w.WriteHeader(http.StatusConflict)
				_ = json.NewEncoder(w).Encode(map[string]any{"error": "upload_incomplete"})
				return
			}
			assembled = append(assembled, chunk...)
		}
		full := sha256.Sum256(assembled)
		fullHash := hex.EncodeToString(full[:])
		if upload.init.SHA256 != "" && fullHash != upload.init.SHA256 {
			a.mu.Unlock()
			w.WriteHeader(http.StatusUnprocessableEntity)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": "file_hash_mismatch"})
			return
		}
		now := time.Now()
		if upload.init.NodeID != nil {
			entry := a.entries[*upload.init.NodeID]
			if entry == nil {
				a.mu.Unlock()
				http.NotFound(w, r)
				return
			}
			if entry.node.Revision != upload.init.ExpectedRevision {
				current := entry.node.Revision
				expected := upload.init.ExpectedRevision
				a.mu.Unlock()
				w.WriteHeader(http.StatusConflict)
				_ = json.NewEncoder(w).Encode(map[string]any{"error": "revision_conflict", "expected_revision": expected, "current_revision": current})
				return
			}
			entry.content = assembled
			entry.node.Size = int64(len(assembled))
			entry.node.SHA256 = fullHash
			entry.node.Revision++
			entry.node.UpdatedAt = now
			result := entry.node
			upload.session.Status = "finalized"
			upload.session.SHA256 = fullHash
			upload.session.Result = &result
		} else {
			nodeID := a.nextID
			a.nextID++
			result := client.Node{
				ID: nodeID, ParentID: upload.init.ParentID, Name: upload.init.Name,
				Type: "file", Size: int64(len(assembled)), Revision: 1, SHA256: fullHash,
				CreatedAt: now, UpdatedAt: now,
			}
			a.entries[nodeID] = &e2eEntry{node: result, content: assembled}
			upload.session.Status = "finalized"
			upload.session.SHA256 = fullHash
			upload.session.Result = &result
		}
		out := upload.session
		a.mu.Unlock()
		_ = json.NewEncoder(w).Encode(out)
	case r.Method == http.MethodDelete && strings.HasPrefix(path, "/uploads/"):
		id := strings.TrimPrefix(path, "/uploads/")
		a.mu.Lock()
		delete(a.uploads, id)
		a.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	case r.Method == http.MethodPost && strings.HasPrefix(path, "/nodes/") && strings.HasSuffix(path, "/directories"):
		id, ok := parseE2EID(strings.TrimSuffix(strings.TrimPrefix(path, "/nodes/"), "/directories"))
		if !ok {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		var body struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Name) == "" {
			http.Error(w, "bad directory", http.StatusBadRequest)
			return
		}
		a.mu.Lock()
		nodeID := a.nextID
		a.nextID++
		now := time.Now()
		e := &e2eEntry{node: client.Node{ID: nodeID, ParentID: uint64ptr(id), Name: body.Name, Type: "dir", Revision: 1, CreatedAt: now, UpdatedAt: now}}
		a.entries[nodeID] = e
		a.mu.Unlock()
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(e.node)
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
	case r.Method == http.MethodPatch && strings.HasPrefix(path, "/nodes/"):
		id, ok := parseE2EID(strings.TrimPrefix(path, "/nodes/"))
		if !ok {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		expected := parseIfMatchE2E(r.Header.Get("If-Match"))
		var body struct {
			Name     *string `json:"name"`
			ParentID *uint64 `json:"parent_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		a.mu.Lock()
		e := a.entries[id]
		if e == nil {
			a.mu.Unlock()
			http.NotFound(w, r)
			return
		}
		if expected != e.node.Revision {
			current := e.node.Revision
			a.mu.Unlock()
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": "revision_conflict", "expected_revision": expected, "current_revision": current})
			return
		}
		if body.Name != nil {
			e.node.Name = *body.Name
		}
		if body.ParentID != nil {
			e.node.ParentID = uint64ptr(*body.ParentID)
		}
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
	web := client.New(server.URL, "web-token")

	root := filepath.Join(t.TempDir(), "xDrive")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	conflictEvents := make(chan Event, 4)
	SetEventSink(func(event Event) {
		if event.Kind == EventConflict {
			select {
			case conflictEvents <- event:
			default:
			}
		}
	})
	defer SetEventSink(nil)
	done := make(chan error, 1)
	go func() {
		done <- runPlatform(ctx, client.New(server.URL, "e2e-token"), root)
	}()

	remotePath := filepath.Join(root, "remote.txt")
	waitE2E(t, 20*time.Second, "initial placeholder", func() bool {
		st, err := os.Stat(remotePath)
		return err == nil && st.Size() == 9
	})
	beforeHydrate, err := Availability(remotePath)
	if err != nil {
		t.Fatal(err)
	}
	if !beforeHydrate.Placeholder {
		t.Fatalf("initial remote file is not a CfAPI placeholder: %+v", beforeHydrate)
	}
	content, err := os.ReadFile(remotePath)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "remote-v1" {
		t.Fatalf("hydrated content=%q", content)
	}
	if err := KeepLocal(remotePath); err != nil {
		t.Fatal(err)
	}
	kept, err := Availability(remotePath)
	if err != nil {
		t.Fatal(err)
	}
	if !kept.Pinned || !kept.AvailableOffline {
		t.Fatalf("keep-local state=%+v", kept)
	}
	if err := MakeOnlineOnly(remotePath); err != nil {
		t.Fatal(err)
	}
	online, err := Availability(remotePath)
	if err != nil {
		t.Fatal(err)
	}
	if !online.OnlineOnly || !online.Placeholder {
		t.Fatalf("online-only state=%+v", online)
	}
	content, err = os.ReadFile(remotePath)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "remote-v1" {
		t.Fatalf("rehydrated content=%q", content)
	}

	webDir, err := web.CreateDir(ctx, 1, "web-created")
	if err != nil {
		t.Fatal(err)
	}
	webFile, err := web.Upload(ctx, webDir.ID, "web.txt", strings.NewReader("web-v1"))
	if err != nil {
		t.Fatal(err)
	}
	if !RequestSync(root) {
		t.Fatal("manual sync request was not accepted after Web create")
	}
	webLocalPath := filepath.Join(root, "web-created", "web.txt")
	waitE2E(t, 15*time.Second, "Web-created file on client", func() bool {
		got, readErr := os.ReadFile(webLocalPath)
		return readErr == nil && string(got) == "web-v1"
	})
	webEmpty, err := web.Upload(ctx, webDir.ID, "web-empty.txt", strings.NewReader(""))
	if err != nil {
		t.Fatal(err)
	}
	if webEmpty.Size != 0 {
		t.Fatalf("Web empty file size=%d", webEmpty.Size)
	}
	if !RequestSync(root) {
		t.Fatal("manual sync request was not accepted after Web empty-file create")
	}
	waitE2E(t, 15*time.Second, "Web empty file on client", func() bool {
		info, statErr := os.Stat(filepath.Join(root, "web-created", "web-empty.txt"))
		return statErr == nil && info.Size() == 0
	})

	webFile, err = web.Overwrite(ctx, webFile.ID, webFile.Revision, strings.NewReader("web-v2"))
	if err != nil {
		t.Fatal(err)
	}
	if !RequestSync(root) {
		t.Fatal("manual sync request was not accepted after Web overwrite")
	}
	waitE2E(t, 15*time.Second, "Web overwrite on client", func() bool {
		got, readErr := os.ReadFile(webLocalPath)
		return readErr == nil && string(got) == "web-v2"
	})

	webTarget, err := web.CreateDir(ctx, 1, "web-target")
	if err != nil {
		t.Fatal(err)
	}
	webMovedName := "web-moved.txt"
	webMoved, err := web.RenameMove(ctx, webFile.ID, webFile.Revision, &webMovedName, &webTarget.ID)
	if err != nil {
		t.Fatal(err)
	}
	if webMoved.ID != webFile.ID {
		t.Fatalf("Web move recreated node: before=%d after=%d", webFile.ID, webMoved.ID)
	}
	if !RequestSync(root) {
		t.Fatal("manual sync request was not accepted after Web move")
	}
	webMovedPath := filepath.Join(root, "web-target", webMovedName)
	waitE2E(t, 15*time.Second, "Web move/rename on client", func() bool {
		_, oldErr := os.Lstat(webLocalPath)
		got, newErr := os.ReadFile(webMovedPath)
		return os.IsNotExist(oldErr) && newErr == nil && string(got) == "web-v2"
	})
	if err := web.Delete(ctx, webMoved.ID, webMoved.Revision); err != nil {
		t.Fatal(err)
	}
	if !RequestSync(root) {
		t.Fatal("manual sync request was not accepted after Web delete")
	}
	waitE2E(t, 15*time.Second, "Web delete on client", func() bool {
		_, statErr := os.Lstat(webMovedPath)
		return os.IsNotExist(statErr)
	})

	webTree, err := web.CreateDir(ctx, 1, "web-tree")
	if err != nil {
		t.Fatal(err)
	}
	webNested, err := web.CreateDir(ctx, webTree.ID, "nested")
	if err != nil {
		t.Fatal(err)
	}
	webLeaf, err := web.Upload(ctx, webNested.ID, "leaf.txt", strings.NewReader("leaf-v1"))
	if err != nil {
		t.Fatal(err)
	}
	if !RequestSync(root) {
		t.Fatal("manual sync request was not accepted after Web tree create")
	}
	webTreeOldPath := filepath.Join(root, "web-tree")
	waitE2E(t, 15*time.Second, "Web directory tree on client", func() bool {
		got, readErr := os.ReadFile(filepath.Join(webTreeOldPath, "nested", "leaf.txt"))
		return readErr == nil && string(got) == "leaf-v1"
	})
	webTreeName := "web-tree-moved"
	webTreeMoved, err := web.RenameMove(ctx, webTree.ID, webTree.Revision, &webTreeName, &webTarget.ID)
	if err != nil {
		t.Fatal(err)
	}
	if webTreeMoved.ID != webTree.ID || webLeaf.ID == 0 {
		t.Fatalf("Web directory move changed identity: before=%d after=%d leaf=%d", webTree.ID, webTreeMoved.ID, webLeaf.ID)
	}
	if !RequestSync(root) {
		t.Fatal("manual sync request was not accepted after Web tree move")
	}
	webTreeNewPath := filepath.Join(root, "web-target", webTreeName)
	waitE2E(t, 15*time.Second, "Web directory tree move on client", func() bool {
		_, oldErr := os.Lstat(webTreeOldPath)
		got, newErr := os.ReadFile(filepath.Join(webTreeNewPath, "nested", "leaf.txt"))
		return os.IsNotExist(oldErr) && newErr == nil && string(got) == "leaf-v1"
	})
	if err := web.Delete(ctx, webTreeMoved.ID, webTreeMoved.Revision); err != nil {
		t.Fatal(err)
	}
	if !RequestSync(root) {
		t.Fatal("manual sync request was not accepted after Web tree delete")
	}
	waitE2E(t, 15*time.Second, "Web directory tree delete on client", func() bool {
		_, statErr := os.Lstat(webTreeNewPath)
		return os.IsNotExist(statErr)
	})

	localPath := filepath.Join(root, "local.txt")
	if err := os.WriteFile(localPath, []byte("local-v1"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitE2E(t, 15*time.Second, "local upload", func() bool {
		_, data, ok := api.byName("local.txt")
		return ok && string(data) == "local-v1"
	})
	localState, err := Availability(localPath)
	if err != nil {
		t.Fatal(err)
	}
	if !localState.Placeholder {
		t.Fatalf("uploaded local file was not converted to placeholder: %+v", localState)
	}
	if !RequestSync(root) {
		t.Fatal("manual sync request was not accepted by active provider")
	}

	uploaded, _, ok := api.byName("local.txt")
	if !ok {
		t.Fatal("local.txt was not uploaded")
	}
	renamedPath := filepath.Join(root, "renamed.txt")
	if err := os.Rename(localPath, renamedPath); err != nil {
		t.Fatal(err)
	}
	waitE2E(t, 10*time.Second, "event-driven local rename", func() bool {
		n, data, ok := api.byName("renamed.txt")
		return ok && n.ID == uploaded.ID && string(data) == "local-v1"
	})
	if _, _, ok := api.byName("local.txt"); ok {
		t.Fatal("local rename created a second remote node instead of moving the existing node")
	}

	localMovedPath := filepath.Join(root, "web-target", "moved.txt")
	if err := os.Rename(renamedPath, localMovedPath); err != nil {
		t.Fatal(err)
	}
	waitE2E(t, 10*time.Second, "event-driven local move", func() bool {
		n, data, ok := api.byName("moved.txt")
		return ok && n.ID == uploaded.ID && n.ParentID != nil && *n.ParentID == webTarget.ID && string(data) == "local-v1"
	})
	if err := os.Remove(localMovedPath); err != nil {
		t.Fatal(err)
	}
	waitE2E(t, 10*time.Second, "event-driven local delete", func() bool {
		_, _, ok := api.byName("moved.txt")
		return !ok
	})

	emptyLocalPath := filepath.Join(root, "local-empty.txt")
	if err := os.WriteFile(emptyLocalPath, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	waitE2E(t, 10*time.Second, "local empty file upload", func() bool {
		n, data, ok := api.byName("local-empty.txt")
		return ok && n.Size == 0 && len(data) == 0
	})

	truncatePath := filepath.Join(root, "truncate.txt")
	if err := os.WriteFile(truncatePath, []byte("truncate-me"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitE2E(t, 10*time.Second, "local truncate source upload", func() bool {
		n, data, ok := api.byName("truncate.txt")
		return ok && n.Size == int64(len("truncate-me")) && string(data) == "truncate-me"
	})
	if err := os.Truncate(truncatePath, 0); err != nil {
		t.Fatal(err)
	}
	waitE2E(t, 10*time.Second, "local truncate to zero", func() bool {
		n, data, ok := api.byName("truncate.txt")
		return ok && n.Size == 0 && len(data) == 0
	})

	bulkRoot := filepath.Join(root, "bulk")
	bulkNested := filepath.Join(bulkRoot, "nested")
	if err := os.MkdirAll(bulkNested, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bulkNested, "tree.txt"), []byte("tree-v1"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitE2E(t, 15*time.Second, "incremental directory tree upload", func() bool {
		_, _, bulkOK := api.byName("bulk")
		_, _, nestedOK := api.byName("nested")
		_, data, fileOK := api.byName("tree.txt")
		return bulkOK && nestedOK && fileOK && string(data) == "tree-v1"
	})
	bulkNode, _, ok := api.byName("bulk")
	if !ok {
		t.Fatal("bulk directory was not created remotely")
	}
	bulkRenamed := filepath.Join(root, "bulk-renamed")
	if err := os.Rename(bulkRoot, bulkRenamed); err != nil {
		t.Fatal(err)
	}
	waitE2E(t, 10*time.Second, "event-driven directory rename", func() bool {
		n, _, ok := api.byName("bulk-renamed")
		return ok && n.ID == bulkNode.ID
	})
	if _, _, ok := api.byName("bulk"); ok {
		t.Fatal("directory rename recreated the remote directory instead of moving the existing node")
	}
	bulkMoved := filepath.Join(root, "web-target", "bulk-moved")
	if err := os.Rename(bulkRenamed, bulkMoved); err != nil {
		t.Fatal(err)
	}
	waitE2E(t, 10*time.Second, "event-driven directory move", func() bool {
		n, _, ok := api.byName("bulk-moved")
		return ok && n.ID == bulkNode.ID && n.ParentID != nil && *n.ParentID == webTarget.ID
	})
	if _, _, ok := api.byName("bulk-renamed"); ok {
		t.Fatal("directory move recreated the remote directory instead of moving the existing node")
	}
	if err := os.RemoveAll(bulkMoved); err != nil {
		t.Fatal(err)
	}
	waitE2E(t, 10*time.Second, "event-driven directory delete", func() bool {
		remote, walkErr := web.Walk(ctx)
		if walkErr != nil {
			return false
		}
		_, exists := remote["web-target/bulk-moved"]
		return !exists
	})

	largeContent := bytes.Repeat([]byte("L"), int(client.DefaultUploadChunkSize)+257)
	largePath := filepath.Join(root, "large.bin")
	if err := os.WriteFile(largePath, largeContent, 0o644); err != nil {
		t.Fatal(err)
	}
	waitE2E(t, 30*time.Second, "resumable large local upload", func() bool {
		n, data, ok := api.byName("large.bin")
		return ok && n.Size == int64(len(largeContent)) && bytes.Equal(data, largeContent)
	})

	if err := os.WriteFile(remotePath, []byte("local-v2"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitE2E(t, 15*time.Second, "local overwrite", func() bool {
		n, data, ok := api.byName("remote.txt")
		return ok && n.Revision >= 2 && string(data) == "local-v2"
	})

	// Create a deterministic stale-write window: the local watcher enqueues
	// the write while the server revision advances before the debounced batch.
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
	var conflictEvent Event
	select {
	case conflictEvent = <-conflictEvents:
	case <-time.After(5 * time.Second):
		t.Fatal("conflict event was not emitted")
	}
	if conflictEvent.OriginalPath != "remote.txt" || conflictEvent.OriginalNodeID != n.ID ||
		conflictEvent.ConflictNodeID == 0 || conflictEvent.Path == "" {
		t.Fatalf("conflict event missing resolution metadata: %+v", conflictEvent)
	}
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
