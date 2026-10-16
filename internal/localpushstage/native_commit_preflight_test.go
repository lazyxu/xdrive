//go:build linux || windows

package localpushstage

import (
	"bytes"
	"context"
	"encoding/json"
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

type nativePrecommitServerState struct {
	mu            sync.Mutex
	status        string
	expires       time.Time
	physicalOK    bool
	forgedSuccess bool
	replaceLocal  bool
	stageReads    int
	physicalReads int
	posts         int
	puts          int
}

func precommitTestReceipt(
	t *testing.T,
) (*client.Client, string, localpush.RootGrant, client.LocalBoundSourceProof,
	LocalOriginalServerStage, *nativePrecommitServerState) {
	t.Helper()
	stageID := uuid.NewString()
	state := &nativePrecommitServerState{
		status: "staged", expires: time.Now().Add(time.Hour), physicalOK: true,
	}
	var proof client.LocalBoundSourceProof
	var original []byte
	var grant localpush.RootGrant
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("If-Match") != "\"7\"" ||
			r.Header.Get("X-XDrive-Device-ID") != proof.DeviceID ||
			r.Header.Get("X-XDrive-Device-Token") != proof.DeviceToken ||
			r.Header.Get("X-XDrive-Local-Root-ID") != proof.RootID ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != proof.RootFingerprint {
			http.Error(w, "wrong owning Agent credential", http.StatusForbidden)
			return
		}
		state.mu.Lock()
		status, expiry, physicalOK := state.status, state.expires, state.physicalOK
		forged, replace := state.forgedSuccess, state.replaceLocal
		state.mu.Unlock()
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Set("ETag", "\"7\"")
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/sources/42/local-staging":
			state.mu.Lock()
			state.posts++
			state.mu.Unlock()
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(client.LocalPushStagingResult{
				SourceID: 42, Revision: 7, StageID: stageID,
				Size: int64(len(original)), Status: "reserved", ExpiresAt: expiry,
			})
		case r.Method == http.MethodPut && r.URL.Path == "/api/v1/sources/42/local-staging/"+stageID+"/content":
			state.mu.Lock()
			state.puts++
			state.mu.Unlock()
			payload, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
			if err != nil || !bytes.Equal(payload, original) {
				t.Errorf("native staging transfer bytes mismatch: %v", err)
			}
			_ = json.NewEncoder(w).Encode(client.LocalPushStagingResult{
				SourceID: 42, Revision: 7, StageID: stageID,
				Size: int64(len(original)), Status: "staged", ExpiresAt: expiry,
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/sources/42/local-staging/"+stageID:
			state.mu.Lock()
			state.stageReads++
			state.mu.Unlock()
			_ = json.NewEncoder(w).Encode(client.LocalPushStagingResult{
				SourceID: 42, Revision: 7, StageID: stageID,
				Size: int64(len(original)), Status: status, ExpiresAt: expiry,
				ContentVerified: forged, CommitSupported: forged, Authoritative: forged,
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/sources/42/local-staging/"+stageID+"/content-preflight":
			state.mu.Lock()
			state.physicalReads++
			state.mu.Unlock()
			if replace {
				// The replacement has the same byte count but a different SHA256.
				if err := os.WriteFile(filepath.Join(grant.Path, "photo.bin"),
					bytes.Repeat([]byte{0x54}, len(original)), 0o600); err != nil {
					t.Errorf("replace native original during network request: %v", err)
				}
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"source_id": uint64(42), "revision": uint64(7), "stage_id": stageID,
				"size": int64(len(original)), "physical_staging_matched": physicalOK,
				"content_verified": forged, "commit_supported": forged,
				"authoritative": forged, "missing_inference_safe": false,
			})
		default:
			t.Errorf("unexpected precommit HTTP method %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	config, root, sha, content, bound := nativeByteStageFixture(t, server.URL)
	grant, original, proof = root, content, bound
	// A second distinct inode with IDENTICAL SHA256 and length must be
	// present in the same sealed CURRENT generation, not only on disk.
	if err := os.WriteFile(filepath.Join(grant.Path, "photo-copy.bin"), original, 0o600); err != nil {
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
		t.Fatalf("two native paths not sealed in CURRENT: %+v err=%v", stats, err)
	}
	if _, err := journal.Commit(stats); err != nil {
		t.Fatal(err)
	}
	cli := client.New(server.URL, "owner")
	staged, err := StageVerifiedNativeOriginalBytes(
		cli, context.Background(), config, grant, 7, proof, "photo.bin", sha,
	)
	if err != nil || staged.StageID != stageID || staged.SnapshotSHA256 == "" ||
		staged.CurrentPathKey == "" {
		t.Fatalf("native staging before precommit failed: %+v err=%v", staged, err)
	}
	return cli, config, grant, proof, staged, state
}

func TestPrivateNativeStagePrecommitRehashesOriginalAndPhysicalStage(t *testing.T) {
	cli, config, grant, proof, staged, state := precommitTestReceipt(t)
	got, err := PreflightStagedNativeOriginalForCommit(
		cli, context.Background(), config, grant, 7, proof, staged, "photo.bin",
	)
	if err != nil || !got.NativeMatched || !got.PhysicalStageMatched ||
		got.CommitSupported || got.Authoritative || got.MissingInferenceSafe {
		t.Fatalf("native and Stage contents were not safely rechecked: %+v err=%v", got, err)
	}
	state.mu.Lock()
	statusReads, physicalReads, posts, puts := state.stageReads, state.physicalReads, state.posts, state.puts
	state.mu.Unlock()
	if statusReads != 3 || physicalReads != 2 || posts != 1 || puts != 1 {
		t.Fatalf("precommit performed unexpected mutation: status=%d physical=%d post=%d put=%d",
			statusReads, physicalReads, posts, puts)
	}
	raw, err := json.Marshal(got)
	if err != nil || string(raw) != "{}" {
		t.Fatalf("private precommit leaked authority to JSON: %q %v", raw, err)
	}
}

func TestPrivateNativeStagePrecommitFailsClosed(t *testing.T) {
	for _, kind := range []string{
		"wrong-original", "wrong-snapshot", "wrong-revision",
		"wrong-device", "revoked-root", "cancelled",
		"expired-stage", "bad-physical", "forged-authority",
		"mutated-during-network", "bad-stage-id",
		"wrong-path-key", "missing-path-key", "equal-bytes-wrong-path",
	} {
		t.Run(kind, func(t *testing.T) {
			cli, config, grant, proof, staged, state := precommitTestReceipt(t)
			ctx := context.Background()
			relativePath := "photo.bin"
			switch kind {
			case "wrong-original":
				err := os.WriteFile(filepath.Join(grant.Path, "photo.bin"),
					bytes.Repeat([]byte{0x30}, int(staged.Size)), 0o600)
				if err != nil {
					t.Fatal(err)
				}
			case "wrong-snapshot":
				staged.SnapshotSHA256 = strings.Repeat("e", 64)
			case "wrong-revision":
				staged.Revision++
			case "wrong-device":
				proof.DeviceToken = "another-device-token"
			case "revoked-root":
				if err := localpush.RemoveRootGrant(config, grant.Server, grant.Account, grant.RootID); err != nil {
					t.Fatal(err)
				}
			case "cancelled":
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(context.Background())
				cancel()
			case "expired-stage":
				state.mu.Lock()
				state.expires = time.Now().Add(-time.Minute)
				state.mu.Unlock()
			case "bad-physical":
				state.mu.Lock()
				state.physicalOK = false
				state.mu.Unlock()
			case "forged-authority":
				state.mu.Lock()
				state.forgedSuccess = true
				state.mu.Unlock()
			case "mutated-during-network":
				state.mu.Lock()
				state.replaceLocal = true
				state.mu.Unlock()
			case "bad-stage-id":
				staged.StageID = "../../arbitrary"
			case "wrong-path-key":
				staged.CurrentPathKey = strings.Repeat("e", 64)
			case "missing-path-key":
				staged.CurrentPathKey = ""
			case "equal-bytes-wrong-path":
				relativePath = "photo-copy.bin"
			}
			got, err := PreflightStagedNativeOriginalForCommit(
				cli, ctx, config, grant, 7, proof, staged, relativePath,
			)
			if err == nil || got.NativeMatched || got.PhysicalStageMatched ||
				got.CommitSupported || got.Authoritative {
				t.Fatalf("%s accepted unsafe native precommit %+v err=%v", kind, got, err)
			}
		})
	}
}

func TestPrivateNativeStagePrecommitRejectsDifferentEqualContentSourceBeforeNetwork(t *testing.T) {
	cli, config, grant, proof, staged, state := precommitTestReceipt(t)
	copyKey, err := localpush.LocalInventoryPathKey(grant, "file", "photo-copy.bin")
	if err != nil || copyKey == staged.CurrentPathKey {
		t.Fatalf("different native file paths do not have separate identity keys: %v", err)
	}
	// Prove the substituted path is in the *same* authorized CURRENT and
	// actually hashes to the *same* physical size/digest. Merely testing a
	// missing path or changed content would not detect this regression.
	copy, err := localpush.StreamCurrentInventoryFileToStaging(
		context.Background(), config, grant, staged.SnapshotSHA256,
		"photo-copy.bin", staged.SHA256, io.Discard, nil,
	)
	if err != nil || copy.SHA256 != staged.SHA256 ||
		copy.Size != staged.Size || copy.SnapshotSHA256 != staged.SnapshotSHA256 {
		t.Fatalf("same-byte alternate native file not independently verified: %+v %v", copy, err)
	}
	state.mu.Lock()
	beforeStage, beforePhysical := state.stageReads, state.physicalReads
	state.mu.Unlock()
	got, err := PreflightStagedNativeOriginalForCommit(
		cli, context.Background(), config, grant, 7, proof, staged, "photo-copy.bin",
	)
	if err == nil || got.NativeMatched || got.PhysicalStageMatched {
		t.Fatalf("different path with identical SHA256 was accepted: %+v %v", got, err)
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.stageReads != beforeStage || state.physicalReads != beforePhysical {
		t.Fatalf("wrong-source path contacted Server: Stage=%d/%d physical=%d/%d",
			state.stageReads, beforeStage, state.physicalReads, beforePhysical)
	}
}
