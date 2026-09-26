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
			if len(init.ChunkSHA256) != 2 || init.ChunkSHA256[0] != firstHash || init.ChunkSHA256[1] != secondHash {
				t.Fatalf("unexpected chunk manifest: %+v", init.ChunkSHA256)
			}
			_ = json.NewEncoder(w).Encode(UploadSession{
				ID: "upload-1", ParentID: init.ParentID, Name: init.Name,
				Size: init.Size, ChunkSize: DefaultUploadChunkSize, ChunkCount: 2,
				SHA256: init.SHA256, ResumeKey: init.ResumeKey, Status: "active",
				ExpiresAt: time.Now().Add(time.Hour),
				Received:  []UploadPart{{Index: 0, Size: DefaultUploadChunkSize, SHA256: firstHash, Reused: true}},
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
	result, err := c.UploadFileResumableResult(context.Background(), 1, path, "large.bin", nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.Node.ID != 9 || result.Node.SHA256 != fullHash || result.SHA256 != fullHash {
		t.Fatalf("result=%+v", result)
	}
	if result.TransferredBytes != 123 {
		t.Fatalf("transferred_bytes=%d want=123", result.TransferredBytes)
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

func TestUploadFileResumableResumesAfterInterruptedCallAndClientRestart(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "restart.bin")
	data := make([]byte, int(DefaultUploadChunkSize)+321)
	for i := range data {
		data[i] = byte((i*29 + 7) % 251)
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
		mu            sync.Mutex
		recovered     bool
		received      = map[int]UploadPart{}
		chunkAttempts = map[int]int{}
		finalizeCalls int
		startCalls    int
	)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/uploads":
			var init UploadInit
			if err := json.NewDecoder(r.Body).Decode(&init); err != nil {
				t.Fatal(err)
			}
			if init.Size != int64(len(data)) || init.SHA256 != fullHash || init.ResumeKey != fullHash {
				t.Fatalf("unexpected restart init: %+v", init)
			}
			mu.Lock()
			startCalls++
			parts := make([]UploadPart, 0, len(received))
			for _, part := range received {
				parts = append(parts, part)
			}
			mu.Unlock()
			_ = json.NewEncoder(w).Encode(UploadSession{
				ID: "upload-restart", ParentID: init.ParentID, Name: init.Name,
				Size: init.Size, ChunkSize: DefaultUploadChunkSize, ChunkCount: 2,
				SHA256: init.SHA256, ResumeKey: init.ResumeKey, Status: "active",
				ExpiresAt: time.Now().Add(time.Hour), Received: parts,
			})
		case r.Method == http.MethodPut && strings.HasPrefix(r.URL.Path, "/api/v1/uploads/upload-restart/chunks/"):
			indexText := strings.TrimPrefix(r.URL.Path, "/api/v1/uploads/upload-restart/chunks/")
			index, err := strconv.Atoi(indexText)
			if err != nil {
				t.Fatal(err)
			}
			body, err := io.ReadAll(r.Body)
			if err != nil {
				t.Fatal(err)
			}
			sum := sha256.Sum256(body)
			hash := hex.EncodeToString(sum[:])
			wantHash := firstHash
			if index == 1 {
				wantHash = secondHash
			}
			if hash != wantHash || r.Header.Get("X-Chunk-SHA256") != wantHash {
				t.Fatalf("chunk %d hash=%q header=%q want=%q", index, hash, r.Header.Get("X-Chunk-SHA256"), wantHash)
			}
			mu.Lock()
			chunkAttempts[index]++
			ready := recovered
			if index == 0 || ready {
				received[index] = UploadPart{Index: index, Size: int64(len(body)), SHA256: hash}
			}
			mu.Unlock()
			if index == 1 && !ready {
				w.WriteHeader(http.StatusServiceUnavailable)
				_, _ = io.WriteString(w, `{"error":"network_unavailable"}`)
				return
			}
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(UploadPart{Index: index, Size: int64(len(body)), SHA256: hash})
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/uploads/upload-restart/finalize":
			mu.Lock()
			finalizeCalls++
			haveFirst := received[0].SHA256 == firstHash
			haveSecond := received[1].SHA256 == secondHash
			mu.Unlock()
			if !haveFirst || !haveSecond {
				w.WriteHeader(http.StatusConflict)
				_, _ = io.WriteString(w, `{"error":"missing_chunks"}`)
				return
			}
			_ = json.NewEncoder(w).Encode(UploadSession{
				ID: "upload-restart", Status: "finalized", SHA256: fullHash,
				Result: &Node{
					ID: 101, ParentID: uint64Ptr(1), Name: "restart.bin", Type: "file",
					Size: int64(len(data)), Revision: 1, SHA256: fullHash,
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	firstClient := New(server.URL, "token")
	if _, err := firstClient.UploadFileResumable(context.Background(), 1, path, "restart.bin", nil); err == nil {
		t.Fatal("interrupted upload unexpectedly succeeded")
	}

	mu.Lock()
	if chunkAttempts[0] != 1 || chunkAttempts[1] != 3 {
		t.Fatalf("first process chunk attempts=%v want chunk0=1 chunk1=3", chunkAttempts)
	}
	if len(received) != 1 || received[0].SHA256 != firstHash {
		t.Fatalf("server resume state after interruption=%+v", received)
	}
	recovered = true
	mu.Unlock()

	var progress [][2]int64
	secondClient := New(server.URL, "token")
	node, err := secondClient.UploadFileResumable(context.Background(), 1, path, "restart.bin", func(done, total int64) {
		progress = append(progress, [2]int64{done, total})
	})
	if err != nil {
		t.Fatal(err)
	}
	if node.ID != 101 || node.SHA256 != fullHash {
		t.Fatalf("resumed node=%+v", node)
	}

	mu.Lock()
	defer mu.Unlock()
	if startCalls != 2 {
		t.Fatalf("upload session starts=%d want=2", startCalls)
	}
	if chunkAttempts[0] != 1 {
		t.Fatalf("completed first chunk was re-uploaded after restart: attempts=%v", chunkAttempts)
	}
	if chunkAttempts[1] != 4 {
		t.Fatalf("second chunk attempts=%d want=4 (3 interrupted + 1 resumed)", chunkAttempts[1])
	}
	if finalizeCalls != 1 {
		t.Fatalf("finalize calls=%d want=1", finalizeCalls)
	}
	if len(progress) == 0 || progress[0][0] != DefaultUploadChunkSize || progress[0][1] != int64(len(data)) {
		t.Fatalf("restart progress did not resume from persisted chunk: %v", progress)
	}
}

func TestUploadFileResumableInstantFinalizeSkipsChunks(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "instant.bin")
	data := []byte("instant-upload-client-payload")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])

	var requests []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests = append(requests, r.Method+" "+r.URL.Path)
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/uploads" {
			t.Fatalf("unexpected request after instant finalize: %s %s", r.Method, r.URL.Path)
		}
		var init UploadInit
		if err := json.NewDecoder(r.Body).Decode(&init); err != nil {
			t.Fatal(err)
		}
		if init.SHA256 != hash || init.ResumeKey != hash || init.Size != int64(len(data)) {
			t.Fatalf("init=%+v", init)
		}
		if len(init.ChunkSHA256) != 1 || init.ChunkSHA256[0] != hash {
			t.Fatalf("chunk hashes=%v", init.ChunkSHA256)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(UploadSession{
			ID: "instant-session", ParentID: init.ParentID, Name: init.Name,
			Size: init.Size, ChunkSize: DefaultUploadChunkSize, ChunkCount: 1,
			SHA256: init.SHA256, ResumeKey: init.ResumeKey,
			Status: "finalized", ExpiresAt: time.Now().Add(time.Hour),
			Result: &Node{
				ID: 77, ParentID: uint64Ptr(1), Name: "instant.bin", Type: "file",
				Size: int64(len(data)), Revision: 1, SHA256: hash,
			},
		})
	}))
	defer server.Close()

	var progress [][2]int64
	cli := New(server.URL, "token")
	result, err := cli.UploadFileResumableResult(context.Background(), 1, path, "instant.bin", func(done, total int64) {
		progress = append(progress, [2]int64{done, total})
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Node.ID != 77 || result.Node.SHA256 != hash || result.SHA256 != hash {
		t.Fatalf("result=%+v", result)
	}
	if result.TransferredBytes != 0 {
		t.Fatalf("instant transferred_bytes=%d want=0", result.TransferredBytes)
	}
	if len(requests) != 1 || requests[0] != "POST /api/v1/uploads" {
		t.Fatalf("requests=%v", requests)
	}
	if len(progress) != 1 || progress[0] != [2]int64{int64(len(data)), int64(len(data))} {
		t.Fatalf("progress=%v", progress)
	}
}

func uint64Ptr(v uint64) *uint64 { return &v }
