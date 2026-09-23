package client

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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
)

func TestUploadFileResumableSkipsCompletedChunkAndRetries(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "large.bin")
	data := make([]byte, int(DefaultUploadChunkSize)+123)
	for i := range data {
		data[i] = byte((i*17 + 11) % 251)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	full := sha256.Sum256(data)
	fullHash := hex.EncodeToString(full[:])
	first := sha256.Sum256(data[:DefaultUploadChunkSize])
	firstHash := hex.EncodeToString(first[:])
	second := sha256.Sum256(data[DefaultUploadChunkSize:])
	secondHash := hex.EncodeToString(second[:])

	var (
		mu          sync.Mutex
		putAttempts int
		putIndices  []int
	)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer token" {
			t.Fatalf("Authorization=%q", got)
		}
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/uploads":
			var init UploadInit
			if err := json.NewDecoder(r.Body).Decode(&init); err != nil {
				t.Fatal(err)
			}
			if init.Size != int64(len(data)) || init.SHA256 != fullHash || init.ResumeKey != fullHash {
				t.Fatalf("unexpected init: %+v", init)
			}
			_ = json.NewEncoder(w).Encode(UploadSession{
				ID: "upload-1", ParentID: init.ParentID, Name: init.Name,
				Size: init.Size, ChunkSize: DefaultUploadChunkSize, ChunkCount: 2,
				SHA256: init.SHA256, ResumeKey: init.ResumeKey, Status: "active",
				ExpiresAt: time.Now().Add(time.Hour),
				Received:  []UploadPart{{Index: 0, Size: DefaultUploadChunkSize, SHA256: firstHash}},
			})
		case r.Method == http.MethodPut && strings.HasPrefix(r.URL.Path, "/api/v1/uploads/upload-1/chunks/"):
			indexText := strings.TrimPrefix(r.URL.Path, "/api/v1/uploads/upload-1/chunks/")
			index, err := strconv.Atoi(indexText)
			if err != nil {
				t.Fatal(err)
			}
			body, err := io.ReadAll(r.Body)
			if err != nil {
				t.Fatal(err)
			}
			sum := sha256.Sum256(body)
			gotHash := hex.EncodeToString(sum[:])
			if index != 1 || gotHash != secondHash || r.Header.Get("X-Chunk-SHA256") != secondHash {
				t.Fatalf("unexpected chunk index=%d hash=%s header=%s", index, gotHash, r.Header.Get("X-Chunk-SHA256"))
			}
			mu.Lock()
			putAttempts++
			putIndices = append(putIndices, index)
			attempt := putAttempts
			mu.Unlock()
			if attempt == 1 {
				w.WriteHeader(http.StatusInternalServerError)
				_, _ = io.WriteString(w, `{"error":"temporary"}`)
				return
			}
			_ = json.NewEncoder(w).Encode(UploadPart{Index: 1, Size: int64(len(body)), SHA256: secondHash})
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/uploads/upload-1/finalize":
			_ = json.NewEncoder(w).Encode(UploadSession{
				ID: "upload-1", Status: "finalized", SHA256: fullHash,
				Result: &Node{ID: 9, ParentID: uint64Ptr(1), Name: "large.bin", Type: "file", Size: int64(len(data)), Revision: 1, SHA256: fullHash},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	c := New(server.URL, "token")
	node, err := c.UploadFileResumable(context.Background(), 1, path, "large.bin", nil)
	if err != nil {
		t.Fatal(err)
	}
	if node.ID != 9 || node.SHA256 != fullHash {
		t.Fatalf("node=%+v", node)
	}
	mu.Lock()
	defer mu.Unlock()
	if putAttempts != 2 {
		t.Fatalf("putAttempts=%d want=2", putAttempts)
	}
	for _, index := range putIndices {
		if index != 1 {
			t.Fatalf("completed chunk 0 was re-uploaded: %v", putIndices)
		}
	}
}

func uint64Ptr(v uint64) *uint64 { return &v }
