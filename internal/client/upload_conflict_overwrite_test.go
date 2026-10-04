package client

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestUploadConflictOverwriteClientContract(t *testing.T) {
	t.Run("preflight exposes file-only overwrite", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost || r.URL.Path != "/api/v1/uploads/preflight" {
				t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
			}
			_ = json.NewEncoder(w).Encode(UploadConflictPreflight{
				Conflict: true, TargetType: "file", CanOverwrite: true,
			})
		}))
		defer server.Close()

		result, err := New(server.URL, "token").UploadConflictPreflight(context.Background(), 7, "same.bin")
		if err != nil {
			t.Fatal(err)
		}
		if !result.Conflict || result.TargetType != "file" || !result.CanOverwrite {
			t.Fatalf("preflight=%+v", result)
		}
	})

	t.Run("resumable upload accepts overwrite policy", func(t *testing.T) {
		dir := t.TempDir()
		path := filepath.Join(dir, "same.bin")
		data := []byte("overwrite-client-content")
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(data)
		fullHash := hex.EncodeToString(sum[:])

		var seen UploadInit
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost || r.URL.Path != "/api/v1/uploads" {
				t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
			}
			if err := json.NewDecoder(r.Body).Decode(&seen); err != nil {
				t.Fatal(err)
			}
			nodeID := uint64(9)
			parentID := uint64(1)
			_ = json.NewEncoder(w).Encode(UploadSession{
				ID: "overwrite-session", ParentID: &parentID, NodeID: &nodeID,
				Name: seen.Name, RequestedName: seen.Name,
				ConflictPolicy: UploadConflictPolicyOverwrite, ExpectedRevision: 4,
				Size: seen.Size, ChunkSize: DefaultUploadChunkSize, ChunkCount: 1,
				SHA256: fullHash, ResumeKey: seen.ResumeKey, Status: "finalized",
				ExpiresAt: time.Now().Add(time.Hour),
				Result: &Node{
					ID: 9, ParentID: &parentID, Name: "same.bin", Type: "file",
					Size: int64(len(data)), Revision: 5, SHA256: fullHash,
				},
			})
		}))
		defer server.Close()

		result, err := New(server.URL, "token").UploadFileResumableWithConflictPolicyResult(
			context.Background(), 1, path, "same.bin", UploadConflictPolicyOverwrite, nil,
		)
		if err != nil {
			t.Fatal(err)
		}
		if seen.ConflictPolicy != UploadConflictPolicyOverwrite {
			t.Fatalf("conflict policy=%q", seen.ConflictPolicy)
		}
		if seen.ResumeKey == "" || seen.ResumeKey == fullHash || len(seen.ResumeKey) != 64 {
			t.Fatalf("overwrite resume key=%q", seen.ResumeKey)
		}
		if result.Node.ID != 9 || result.Node.Revision != 5 || result.Skipped || result.TransferredBytes != 0 {
			t.Fatalf("overwrite result=%+v", result)
		}
	})
}
