//go:build linux || windows

package localpushstage

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
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
)

func nativeByteStageFixture(
	t *testing.T, serverURL string,
) (string, localpush.RootGrant, string, []byte, client.LocalBoundSourceProof) {
	t.Helper()
	root := filepath.Join(t.TempDir(), "Originals")
	config := filepath.Join(t.TempDir(), "PrivateConfig")
	if err := os.MkdirAll(root, 0o700); err != nil {
		t.Fatal(err)
	}
	body := bytes.Repeat([]byte("device-original-content-"), 24000)
	if err := os.WriteFile(filepath.Join(root, "photo.bin"), body, 0o600); err != nil {
		t.Fatal(err)
	}
	device := uuid.NewString()
	grant, err := localpush.PrepareRootGrant(serverURL, "owner", 42, device, root)
	if err != nil {
		t.Fatal(err)
	}
	if err := localpush.SaveRootGrant(config, grant); err != nil {
		t.Fatal(err)
	}
	journal, err := localpush.BeginInventoryJournal(config, grant)
	if err != nil {
		t.Fatal(err)
	}
	defer journal.Abort()
	stats, err := (localpush.InventoryScanner{
		IncludeNativeIdentity: true, BatchSize: localpush.DefaultInventoryBatchSize,
	}).ScanInventory(context.Background(), grant, journal.Append)
	if err != nil || !stats.Complete {
		t.Fatalf("native file scan did not complete: %+v %v", stats, err)
	}
	if _, err := journal.Commit(stats); err != nil {
		t.Fatal(err)
	}
	proof := client.LocalBoundSourceProof{
		DeviceID: device, DeviceToken: "agent-private-only-secret",
		RootID: grant.RootID, RootFingerprint: grant.Fingerprint,
	}
	sum := sha256.Sum256(body)
	return config, grant, hex.EncodeToString(sum[:]), body, proof
}

func TestStageVerifiedNativeOriginalBytesRealAgentToServerProtocol(t *testing.T) {
	stageID := uuid.NewString()
	var proof client.LocalBoundSourceProof
	var expectedSHA, generationSHA, originalKey string
	var expectedContent []byte
	var posted, uploaded, queried, physicallyChecked, cancelled int
	var upload []byte
	var mu sync.Mutex
	respond := func(w http.ResponseWriter, status string, code int) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Set("ETag", "\"7\"")
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(client.LocalPushStagingResult{
			StageID: stageID, SourceID: 42, Revision: 7,
			Size: int64(len(expectedContent)), Status: status,
			ExpiresAt:       time.Now().Add(time.Hour),
			ContentVerified: false, CommitSupported: false,
			Authoritative: false, MissingInferenceSafe: false,
		})
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("If-Match") != "\"7\"" ||
			r.Header.Get("X-XDrive-Device-ID") != proof.DeviceID ||
			r.Header.Get("X-XDrive-Device-Token") != proof.DeviceToken ||
			r.Header.Get("X-XDrive-Local-Root-ID") != proof.RootID ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != proof.RootFingerprint {
			t.Errorf("Agent request lost bound native/Source credentials")
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		switch {
		case r.Method == http.MethodPost &&
			r.URL.Path == "/api/v1/sources/42/local-staging":
			mu.Lock()
			posted++
			mu.Unlock()
			var claim client.LocalPushStagingInput
			if err := json.NewDecoder(r.Body).Decode(&claim); err != nil ||
				claim.SHA256 != expectedSHA ||
				claim.Size != int64(len(expectedContent)) ||
				claim.CurrentSnapshotSHA256 != generationSHA ||
				claim.CurrentPathKey != originalKey {
				t.Errorf("native journal/content claim not correctly bound: %+v err=%v", claim, err)
			}
			respond(w, "reserved", http.StatusCreated)
		case r.Method == http.MethodPut &&
			r.URL.Path == "/api/v1/sources/42/local-staging/"+stageID+"/content":
			body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
			mu.Lock()
			uploaded++
			upload = body
			mu.Unlock()
			if err != nil || !bytes.Equal(body, expectedContent) {
				t.Errorf("received native bytes are incomplete: %v length=%d", err, len(body))
			}
			respond(w, "staged", http.StatusOK)
		case r.Method == http.MethodGet &&
			r.URL.Path == "/api/v1/sources/42/local-staging/"+stageID+"/content-preflight":
			mu.Lock()
			physicallyChecked++
			mu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "private, no-store")
			w.Header().Set("ETag", "\"7\"")
			_, _ = fmt.Fprintf(w,
				"{\"stage_id\":%q,\"source_id\":42,\"revision\":7,\"size\":%d,\"physical_staging_matched\":true,\"content_verified\":false,\"commit_supported\":false,\"authoritative\":false,\"missing_inference_safe\":false}",
				stageID, len(expectedContent))
		case r.Method == http.MethodGet &&
			r.URL.Path == "/api/v1/sources/42/local-staging/"+stageID:
			mu.Lock()
			queried++
			mu.Unlock()
			respond(w, "staged", http.StatusOK)
		case r.Method == http.MethodDelete &&
			r.URL.Path == "/api/v1/sources/42/local-staging/"+stageID:
			mu.Lock()
			cancelled++
			mu.Unlock()
			w.Header().Set("Cache-Control", "private, no-store")
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Errorf("unexpected transport route: %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	config, grant, sha, body, localProof := nativeByteStageFixture(t, server.URL)
	proof = localProof
	expectedSHA, expectedContent = sha, body
	snapshot, err := localpush.VerifyInventoryJournal(context.Background(), config, grant)
	if err != nil {
		t.Fatal(err)
	}
	generationSHA = snapshot.SnapshotSHA256
	originalKey, err = localpush.LocalInventoryPathKey(grant, "file", "photo.bin")
	if err != nil {
		t.Fatal(err)
	}
	cli := client.New(server.URL, "owner")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	receipt, err := StageVerifiedNativeOriginalBytes(
		cli, ctx, config, grant, 7, proof, "photo.bin", sha,
	)
	mu.Lock()
	defer mu.Unlock()
	if err != nil || receipt.StageID != stageID ||
		receipt.SourceID != 42 || receipt.Revision != 7 ||
		receipt.Size != int64(len(body)) || receipt.SHA256 != sha ||
		receipt.SnapshotSHA256 != generationSHA ||
		posted != 1 || uploaded != 1 || queried != 1 || physicallyChecked != 1 || cancelled != 0 ||
		!bytes.Equal(upload, body) {
		t.Fatalf("native Agent transport not staged: receipt=%+v err=%v calls=%d/%d/%d/%d/%d",
			receipt, err, posted, uploaded, queried, physicallyChecked, cancelled)
	}
	raw, err := json.Marshal(receipt)
	if err != nil || string(raw) != "{}" {
		t.Fatalf("Agent-native staging scope leaked to JSON: %q err=%v", raw, err)
	}
}

func TestStageVerifiedNativeOriginalBytesDoesNotSendBadLocalFile(t *testing.T) {
	requests := 0
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		http.Error(w, "unexpected Server call", http.StatusForbidden)
	}))
	defer s.Close()
	config, grant, sha, _, proof := nativeByteStageFixture(t, s.URL)
	cli := client.New(s.URL, "owner")
	for _, wrong := range []struct{ path, digest string }{
		{"../escape", sha},
		{"photo.bin", strings.Repeat("a", 64)},
		{"not-member.bin", sha},
	} {
		if got, err := StageVerifiedNativeOriginalBytes(
			cli, context.Background(), config, grant, 7, proof,
			wrong.path, wrong.digest,
		); err == nil || got.StageID != "" {
			t.Fatalf("unverified original became upload: %+v %v", got, err)
		}
	}
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := StageVerifiedNativeOriginalBytes(
		cli, canceled, config, grant, 7, proof, "photo.bin", sha,
	); err == nil {
		t.Fatal("cancelled original stage accepted")
	}
	if err := localpush.RemoveRootGrant(config, grant.Server, grant.Account, grant.RootID); err != nil {
		t.Fatal(err)
	}
	if got, err := StageVerifiedNativeOriginalBytes(
		cli, context.Background(), config, grant, 7, proof, "photo.bin", sha,
	); err == nil || got.StageID != "" {
		t.Fatalf("revoked local Root staged data: %+v err=%v", got, err)
	}
	if requests != 0 {
		t.Fatalf("untrusted native file contacted Server %d times", requests)
	}
}

func TestStageVerifiedNativeOriginalBytesRejectsPhysicalRecheck(t *testing.T) {
	for _, promoted := range []bool{false, true} {
		name := "server-physical-mismatch"
		if promoted {
			name = "forged-canonical-authority"
		}
		t.Run(name, func(t *testing.T) {
			stageID := uuid.NewString()
			var expectedSize int
			var expectedSHA string
			var mu sync.Mutex
			var physicalReads, cancelled int
			replyStage := func(w http.ResponseWriter, status string, code int) {
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Cache-Control", "private, no-store")
				w.Header().Set("ETag", "\"7\"")
				w.WriteHeader(code)
				_ = json.NewEncoder(w).Encode(client.LocalPushStagingResult{
					StageID: stageID, SourceID: 42, Revision: 7,
					Size: int64(expectedSize), Status: status,
					ExpiresAt:       time.Now().Add(time.Hour),
					ContentVerified: false, CommitSupported: false,
					Authoritative: false, MissingInferenceSafe: false,
				})
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer owner" ||
					r.Header.Get("If-Match") != "\"7\"" ||
					r.Header.Get("X-XDrive-Device-ID") == "" ||
					r.Header.Get("X-XDrive-Device-Token") != "agent-private-only-secret" ||
					r.Header.Get("X-XDrive-Local-Root-ID") == "" ||
					r.Header.Get("X-XDrive-Local-Root-Fingerprint") == "" {
					t.Errorf("staging physical recheck lost owning-Agent credential/Root proof")
					http.Error(w, "forbidden", http.StatusForbidden)
					return
				}
				switch {
				case r.Method == http.MethodPost &&
					r.URL.Path == "/api/v1/sources/42/local-staging":
					replyStage(w, "reserved", http.StatusCreated)
				case r.Method == http.MethodPut &&
					r.URL.Path == "/api/v1/sources/42/local-staging/"+stageID+"/content":
					body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
					digest := sha256.Sum256(body)
					if err != nil || len(body) != expectedSize ||
						hex.EncodeToString(digest[:]) != expectedSHA {
						t.Errorf("native staged bytes missing or mismatched: bytes=%d err=%v", len(body), err)
					}
					replyStage(w, "staged", http.StatusOK)
				case r.Method == http.MethodGet &&
					r.URL.Path == "/api/v1/sources/42/local-staging/"+stageID:
					replyStage(w, "staged", http.StatusOK)
				case r.Method == http.MethodGet &&
					r.URL.Path == "/api/v1/sources/42/local-staging/"+stageID+"/content-preflight":
					mu.Lock()
					physicalReads++
					mu.Unlock()
					w.Header().Set("Content-Type", "application/json")
					w.Header().Set("Cache-Control", "private, no-store")
					w.Header().Set("ETag", "\"7\"")
					_, _ = fmt.Fprintf(w,
						"{\"stage_id\":%q,\"source_id\":42,\"revision\":7,\"size\":%d,\"physical_staging_matched\":%t,\"content_verified\":false,\"commit_supported\":false,\"authoritative\":%t,\"missing_inference_safe\":false}",
						stageID, expectedSize, promoted, promoted)
				case r.Method == http.MethodDelete &&
					r.URL.Path == "/api/v1/sources/42/local-staging/"+stageID:
					mu.Lock()
					cancelled++
					mu.Unlock()
					w.Header().Set("Cache-Control", "private, no-store")
					w.WriteHeader(http.StatusNoContent)
				default:
					t.Errorf("unexpected owning-Agent temporary-stage operation: %s %s", r.Method, r.URL.Path)
					http.NotFound(w, r)
				}
			}))
			defer server.Close()
			config, grant, sha, original, proof := nativeByteStageFixture(t, server.URL)
			expectedSize, expectedSHA = len(original), sha
			receipt, err := StageVerifiedNativeOriginalBytes(
				client.New(server.URL, "owner"), context.Background(),
				config, grant, 7, proof, "photo.bin", sha,
			)
			mu.Lock()
			defer mu.Unlock()
			if err == nil || receipt.StageID != "" ||
				physicalReads != 1 || cancelled != 1 {
				t.Fatalf("unsafe Server bytes became Agent receipt: %+v err=%v physical=%d cancelled=%d",
					receipt, err, physicalReads, cancelled)
			}
		})
	}
}
