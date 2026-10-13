package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
)

func TestPreflightLocalPushPhysicalStagingCredentialAndUnsafeResponses(t *testing.T) {
	const sourceID, revision = uint64(17), uint64(7)
	const size = int64(321)
	stageID := uuid.NewString()
	proof := LocalBoundSourceProof{
		DeviceID: uuid.NewString(), DeviceToken: "private-device-test-token",
		RootID: uuid.NewString(), RootFingerprint: strings.Repeat("a", 64),
	}
	var mode atomic.Value
	mode.Store("")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet ||
			r.URL.Path != "/api/v1/sources/17/local-staging/"+stageID+"/content-preflight" ||
			r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("If-Match") != "\"7\"" ||
			r.Header.Get("X-XDrive-Device-ID") != proof.DeviceID ||
			r.Header.Get("X-XDrive-Device-Token") != proof.DeviceToken ||
			r.Header.Get("X-XDrive-Local-Root-ID") != proof.RootID ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != proof.RootFingerprint {
			t.Errorf("private staging preflight lost device/Root/Source scope")
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Set("ETag", "\"7\"")
		current := mode.Load().(string)
		if current == "cache" {
			w.Header().Set("Cache-Control", "public")
		}
		if current == "revision" {
			w.Header().Set("ETag", "\"8\"")
		}
		response := map[string]any{
			"source_id": sourceID, "revision": revision,
			"stage_id": stageID, "size": size,
			"physical_staging_matched": true,
			"content_verified":         false,
			"commit_supported":         false,
			"authoritative":            false,
			"missing_inference_safe":   false,
		}
		switch current {
		case "wrong-stage":
			response["stage_id"] = uuid.NewString()
		case "wrong-size":
			response["size"] = size + 1
		case "wrong-source":
			response["source_id"] = sourceID + 1
		case "physical-false":
			response["physical_staging_matched"] = false
		case "commit-true":
			response["commit_supported"] = true
		case "no-content-flag":
			delete(response, "content_verified")
		case "no-physical-flag":
			delete(response, "physical_staging_matched")
		case "authoritative-true":
			response["authoritative"] = true
		case "unsafe-missing":
			response["missing_inference_safe"] = true
		case "unknown":
			response["unexpected_field"] = "x"
		}
		_ = json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()
	cli := New(server.URL, "owner")
	call := func() (LocalPushPhysicalStagingPreflight, error) {
		return cli.PreflightLocalPushStagingPhysical(
			context.Background(), sourceID, revision, proof, stageID, size,
		)
	}
	result, err := call()
	if err != nil || result.StageID != stageID || !result.PhysicalStagingMatched ||
		result.ContentVerified || result.Authoritative || result.CommitSupported ||
		result.MissingInferenceSafe {
		t.Fatalf("safe physical staging readback refused: %+v %v", result, err)
	}
	for _, bad := range []string{
		"cache", "revision", "wrong-stage", "wrong-size", "wrong-source",
		"physical-false", "commit-true", "no-content-flag",
		"no-physical-flag", "authoritative-true", "unsafe-missing", "unknown",
	} {
		mode.Store(bad)
		if unsafe, err := call(); err == nil || unsafe.PhysicalStagingMatched {
			t.Fatalf("private physical staging accepted %s: %+v %v", bad, unsafe, err)
		}
	}
}

func TestPreflightLocalPushPhysicalStagingRejectsUnboundRequest(t *testing.T) {
	cli := New("http://127.0.0.1:0", "unused")
	proof := LocalBoundSourceProof{}
	stageID := uuid.NewString()
	if got, err := cli.PreflightLocalPushStagingPhysical(context.Background(),
		7, 1, proof, stageID, 1); err == nil || got.PhysicalStagingMatched {
		t.Fatal("unbound device attempted a physical Server lookup")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if got, err := cli.PreflightLocalPushStagingPhysical(ctx,
		7, 1, proof, stageID, 1); err == nil || got.PhysicalStagingMatched {
		t.Fatal("cancelled unbound physical lookup returned success")
	}
}
