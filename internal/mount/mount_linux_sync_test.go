//go:build linux

package mount

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
)

type linuxSyncEntry struct {
	node    client.Node
	content []byte
}

type linuxSyncUpload struct {
	session client.UploadSession
	chunks  map[int][]byte
}

type linuxSyncAPI struct {
	mu         sync.Mutex
	nextUpload int
	entries    map[uint64]*linuxSyncEntry
	uploads    map[string]*linuxSyncUpload
}

func newLinuxSyncAPI() *linuxSyncAPI {
	now := time.Now().UTC()
	return &linuxSyncAPI{
		nextUpload: 1,
		uploads:    map[string]*linuxSyncUpload{},
		entries: map[uint64]*linuxSyncEntry{
			1: {node: client.Node{ID: 1, Name: "", Type: "dir", Revision: 1, CreatedAt: now, UpdatedAt: now}},
			2: {node: client.Node{ID: 2, ParentID: uint64ptrLinux(1), Name: "target", Type: "dir", Revision: 1, CreatedAt: now, UpdatedAt: now}},
			3: {node: client.Node{ID: 3, ParentID: uint64ptrLinux(1), Name: "web.txt", Type: "file", Size: 6, Revision: 1, CreatedAt: now, UpdatedAt: now}, content: []byte("web-v1")},
		},
	}
}

func (a *linuxSyncAPI) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	path := strings.TrimPrefix(r.URL.Path, "/api/v1")
	switch {
	case r.Method == http.MethodPost && path == "/uploads":
		var init client.UploadInit
		if err := json.NewDecoder(r.Body).Decode(&init); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		chunkSize := init.ChunkSize
		if chunkSize <= 0 {
			chunkSize = client.DefaultUploadChunkSize
		}
		chunkCount := 0
		if init.Size > 0 {
			chunkCount = int((init.Size + chunkSize - 1) / chunkSize)
		}
		a.mu.Lock()
		id := fmt.Sprintf("linux-upload-%d", a.nextUpload)
		a.nextUpload++
		session := client.UploadSession{
			ID: id, ParentID: init.ParentID, NodeID: init.NodeID, Name: init.Name,
			Size: init.Size, ChunkSize: chunkSize, ChunkCount: chunkCount,
			SHA256: init.SHA256, ResumeKey: init.ResumeKey,
			ExpectedRevision: init.ExpectedRevision, Status: "active",
			ExpiresAt: time.Now().Add(time.Hour),
		}
		a.uploads[id] = &linuxSyncUpload{session: session, chunks: map[int][]byte{}}
		a.mu.Unlock()
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(session)
	case r.Method == http.MethodPut && strings.HasPrefix(path, "/uploads/") && strings.Contains(path, "/chunks/"):
		rest := strings.TrimPrefix(path, "/uploads/")
		parts := strings.Split(rest, "/chunks/")
		if len(parts) != 2 {
			http.Error(w, "bad chunk path", http.StatusBadRequest)
			return
		}
		index, err := strconv.Atoi(parts[1])
		if err != nil || index < 0 {
			http.Error(w, "bad chunk index", http.StatusBadRequest)
			return
		}
		data, _ := io.ReadAll(r.Body)
		a.mu.Lock()
		upload := a.uploads[parts[0]]
		if upload == nil {
			a.mu.Unlock()
			http.NotFound(w, r)
			return
		}
		upload.chunks[index] = append([]byte(nil), data...)
		a.mu.Unlock()
		_ = json.NewEncoder(w).Encode(client.UploadPart{
			Index: index, Size: int64(len(data)), SHA256: r.Header.Get("X-Chunk-SHA256"),
		})
	case r.Method == http.MethodPost && strings.HasPrefix(path, "/uploads/") && strings.HasSuffix(path, "/finalize"):
		id := strings.TrimSuffix(strings.TrimPrefix(path, "/uploads/"), "/finalize")
		a.mu.Lock()
		upload := a.uploads[id]
		if upload == nil || upload.session.NodeID == nil {
			a.mu.Unlock()
			http.NotFound(w, r)
			return
		}
		entry := a.entries[*upload.session.NodeID]
		if entry == nil {
			a.mu.Unlock()
			http.NotFound(w, r)
			return
		}
		if entry.node.Revision != upload.session.ExpectedRevision {
			current := entry.node.Revision
			a.mu.Unlock()
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error": "revision_conflict", "current_revision": current,
			})
			return
		}
		var data []byte
		for index := 0; index < upload.session.ChunkCount; index++ {
			data = append(data, upload.chunks[index]...)
		}
		entry.content = append([]byte(nil), data...)
		entry.node.Size = int64(len(data))
		entry.node.SHA256 = upload.session.SHA256
		entry.node.Revision++
		entry.node.UpdatedAt = time.Now().UTC()
		result := entry.node
		upload.session.Status = "finalized"
		upload.session.Result = &result
		session := upload.session
		a.mu.Unlock()
		_ = json.NewEncoder(w).Encode(session)
	case r.Method == http.MethodGet && path == "/nodes/root":
		a.writeNode(w, 1)
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/nodes/") && strings.HasSuffix(path, "/children"):
		id, ok := linuxSyncID(strings.TrimSuffix(strings.TrimPrefix(path, "/nodes/"), "/children"))
		if !ok {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		a.mu.Lock()
		out := make([]client.Node, 0)
		for _, entry := range a.entries {
			if entry.node.ParentID != nil && *entry.node.ParentID == id {
				out = append(out, entry.node)
			}
		}
		a.mu.Unlock()
		_ = json.NewEncoder(w).Encode(out)
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/files/") && strings.HasSuffix(path, "/content"):
		id, ok := linuxSyncID(strings.TrimSuffix(strings.TrimPrefix(path, "/files/"), "/content"))
		if !ok {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		a.mu.Lock()
		entry := a.entries[id]
		if entry == nil {
			a.mu.Unlock()
			http.NotFound(w, r)
			return
		}
		node := entry.node
		data := append([]byte(nil), entry.content...)
		a.mu.Unlock()
		http.ServeContent(w, r, node.Name, node.UpdatedAt, bytes.NewReader(data))
	case r.Method == http.MethodPut && strings.HasPrefix(path, "/files/") && strings.HasSuffix(path, "/content"):
		id, ok := linuxSyncID(strings.TrimSuffix(strings.TrimPrefix(path, "/files/"), "/content"))
		if !ok {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		expected := linuxSyncIfMatch(r.Header.Get("If-Match"))
		data, _ := io.ReadAll(r.Body)
		a.mu.Lock()
		entry := a.entries[id]
		if entry == nil {
			a.mu.Unlock()
			http.NotFound(w, r)
			return
		}
		if expected != entry.node.Revision {
			current := entry.node.Revision
			a.mu.Unlock()
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": "revision_conflict", "current_revision": current})
			return
		}
		entry.content = data
		entry.node.Size = int64(len(data))
		entry.node.Revision++
		entry.node.UpdatedAt = time.Now().UTC()
		node := entry.node
		a.mu.Unlock()
		_ = json.NewEncoder(w).Encode(node)
	case r.Method == http.MethodPatch && strings.HasPrefix(path, "/nodes/"):
		id, ok := linuxSyncID(strings.TrimPrefix(path, "/nodes/"))
		if !ok {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		expected := linuxSyncIfMatch(r.Header.Get("If-Match"))
		var body struct {
			Name     *string `json:"name"`
			ParentID *uint64 `json:"parent_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		a.mu.Lock()
		entry := a.entries[id]
		if entry == nil {
			a.mu.Unlock()
			http.NotFound(w, r)
			return
		}
		if expected != entry.node.Revision {
			current := entry.node.Revision
			a.mu.Unlock()
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": "revision_conflict", "current_revision": current})
			return
		}
		if body.Name != nil {
			entry.node.Name = *body.Name
		}
		if body.ParentID != nil {
			entry.node.ParentID = uint64ptrLinux(*body.ParentID)
		}
		entry.node.Revision++
		entry.node.UpdatedAt = time.Now().UTC()
		node := entry.node
		a.mu.Unlock()
		_ = json.NewEncoder(w).Encode(node)
	case r.Method == http.MethodDelete && strings.HasPrefix(path, "/nodes/"):
		id, ok := linuxSyncID(strings.TrimPrefix(path, "/nodes/"))
		if !ok {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		expected := linuxSyncIfMatch(r.Header.Get("If-Match"))
		a.mu.Lock()
		entry := a.entries[id]
		if entry == nil {
			a.mu.Unlock()
			http.NotFound(w, r)
			return
		}
		if expected != entry.node.Revision {
			current := entry.node.Revision
			a.mu.Unlock()
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": "revision_conflict", "current_revision": current})
			return
		}
		delete(a.entries, id)
		a.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	default:
		http.NotFound(w, r)
	}
}

func (a *linuxSyncAPI) writeNode(w http.ResponseWriter, id uint64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	entry := a.entries[id]
	if entry == nil {
		http.Error(w, "missing", http.StatusNotFound)
		return
	}
	_ = json.NewEncoder(w).Encode(entry.node)
}

func (a *linuxSyncAPI) webAddFile(parentID uint64, name, content string) client.Node {
	a.mu.Lock()
	defer a.mu.Unlock()
	id := uint64(10)
	for {
		if _, exists := a.entries[id]; !exists {
			break
		}
		id++
	}
	now := time.Now().UTC()
	node := client.Node{
		ID: id, ParentID: uint64ptrLinux(parentID), Name: name, Type: "file",
		Size: int64(len(content)), Revision: 1, CreatedAt: now, UpdatedAt: now,
	}
	a.entries[id] = &linuxSyncEntry{node: node, content: []byte(content)}
	return node
}

func (a *linuxSyncAPI) webDelete(id uint64) {
	a.mu.Lock()
	delete(a.entries, id)
	a.mu.Unlock()
}

func (a *linuxSyncAPI) webOverwrite(id uint64, content string) client.Node {
	a.mu.Lock()
	defer a.mu.Unlock()
	entry := a.entries[id]
	entry.content = []byte(content)
	entry.node.Size = int64(len(content))
	entry.node.Revision++
	entry.node.UpdatedAt = time.Now().UTC()
	return entry.node
}

func (a *linuxSyncAPI) webRename(id uint64, name string) client.Node {
	a.mu.Lock()
	defer a.mu.Unlock()
	entry := a.entries[id]
	entry.node.Name = name
	entry.node.Revision++
	entry.node.UpdatedAt = time.Now().UTC()
	return entry.node
}

func (a *linuxSyncAPI) node(id uint64) (client.Node, []byte, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	entry := a.entries[id]
	if entry == nil {
		return client.Node{}, nil, false
	}
	return entry.node, append([]byte(nil), entry.content...), true
}

func TestLinuxFUSEBidirectionalMutationContract(t *testing.T) {
	api := newLinuxSyncAPI()
	server := httptest.NewServer(api)
	defer server.Close()

	ctx := context.Background()
	cli := client.New(server.URL, "linux-sync-token")
	rootNode, err := cli.Root(ctx)
	if err != nil {
		t.Fatal(err)
	}
	root := &linuxNode{cli: cli, node: rootNode}
	targetNode, err := root.findChild(ctx, "target")
	if err != nil {
		t.Fatal(err)
	}
	target := &linuxNode{cli: cli, node: targetNode}

	webCreated := api.webAddFile(rootNode.ID, "web-created.txt", "created-after-mount")
	createdSeen, err := root.findChild(ctx, "web-created.txt")
	if err != nil || createdSeen.ID != webCreated.ID {
		t.Fatalf("Linux client did not see Web-created file after mount: node=%+v err=%v", createdSeen, err)
	}
	webDeleted := api.webAddFile(rootNode.ID, "web-delete.txt", "delete-me")
	if _, err := root.findChild(ctx, "web-delete.txt"); err != nil {
		t.Fatalf("Linux client did not see Web file before delete: %v", err)
	}
	api.webDelete(webDeleted.ID)
	if _, err := root.findChild(ctx, "web-delete.txt"); err == nil {
		t.Fatal("Linux client still saw Web-deleted file")
	}

	webFile, err := root.findChild(ctx, "web.txt")
	if err != nil {
		t.Fatalf("Linux client did not see Web-created file: %v", err)
	}
	handle, err := newLinuxHandle(ctx, cli, webFile, uint32(os.O_RDONLY), false, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := handle.file.Seek(0, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(handle.file)
	if err != nil || string(data) != "web-v1" {
		t.Fatalf("Linux client content=%q err=%v", data, err)
	}
	_ = handle.Release(ctx)

	webUpdated := api.webOverwrite(webFile.ID, "web-v2")
	refreshed, err := root.findChild(ctx, "web.txt")
	if err != nil {
		t.Fatal(err)
	}
	if refreshed.Revision != webUpdated.Revision {
		t.Fatalf("Linux lookup revision=%d want=%d", refreshed.Revision, webUpdated.Revision)
	}
	handle, err = newLinuxHandle(ctx, cli, refreshed, uint32(os.O_RDONLY), false, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := handle.file.Seek(0, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	data, err = io.ReadAll(handle.file)
	if err != nil || string(data) != "web-v2" {
		t.Fatalf("Linux updated content=%q err=%v", data, err)
	}
	_ = handle.Release(ctx)

	webRenamed := api.webRename(webFile.ID, "web-renamed.txt")
	if _, err := root.findChild(ctx, "web.txt"); err == nil {
		t.Fatal("Linux client still saw old Web-renamed path")
	}
	renamed, err := root.findChild(ctx, "web-renamed.txt")
	if err != nil || renamed.ID != webFile.ID || renamed.Revision != webRenamed.Revision {
		t.Fatalf("Linux client did not converge on Web rename: node=%+v err=%v", renamed, err)
	}

	newName := "client-moved.txt"
	if errno := root.Rename(ctx, "web-renamed.txt", target, newName, 0); errno != 0 {
		t.Fatalf("Linux rename/move errno=%v", errno)
	}
	moved, _, ok := api.node(webFile.ID)
	if !ok || moved.ID != webFile.ID || moved.Name != newName ||
		moved.ParentID == nil || *moved.ParentID != targetNode.ID {
		t.Fatalf("Web/server did not observe Linux rename/move: %+v ok=%t", moved, ok)
	}

	handle, err = newLinuxHandle(ctx, cli, moved, uint32(os.O_RDWR), false, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := handle.truncate(0); err != nil {
		t.Fatal(err)
	}
	if _, errno := handle.Write(ctx, []byte("client-v2"), 0); errno != 0 {
		t.Fatalf("Linux write errno=%v", errno)
	}
	if errno := handle.Flush(ctx); errno != 0 {
		t.Fatalf("Linux flush errno=%v", errno)
	}
	_ = handle.Release(ctx)
	updatedNode, updatedContent, ok := api.node(webFile.ID)
	if !ok || string(updatedContent) != "client-v2" || updatedNode.Revision <= moved.Revision {
		t.Fatalf("Web/server did not observe Linux content update: node=%+v content=%q", updatedNode, updatedContent)
	}

	if errno := target.Unlink(ctx, newName); errno != 0 {
		t.Fatalf("Linux unlink errno=%v", errno)
	}
	if _, _, ok := api.node(webFile.ID); ok {
		t.Fatal("Web/server still contains Linux-deleted file")
	}
}

func uint64ptrLinux(value uint64) *uint64 { return &value }

func linuxSyncID(value string) (uint64, bool) {
	id, err := strconv.ParseUint(strings.Trim(value, "/"), 10, 64)
	return id, err == nil && id > 0
}

func linuxSyncIfMatch(value string) uint64 {
	value = strings.Trim(strings.TrimSpace(value), "\"")
	id, _ := strconv.ParseUint(value, 10, 64)
	return id
}
