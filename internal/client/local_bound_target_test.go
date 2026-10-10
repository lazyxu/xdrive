package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRetargetLocalBoundSourceCarriesNativeProofAndOnlyTarget(t *testing.T) {
	const targetID uint64 = 81
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Method != http.MethodPatch || r.URL.Path != "/api/v1/sources/42" ||
			r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("If-Match") != "\"7\"" ||
			r.Header.Get("X-XDrive-Device-ID") != "device-A" ||
			r.Header.Get("X-XDrive-Device-Token") != "agent-private-credential" ||
			r.Header.Get("X-XDrive-Local-Root-ID") != "root-A" ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != "fingerprint-A" {
			t.Error("missing native Root, device or revision proof on target update")
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil ||
			len(payload) != 1 || payload["target_node_id"] != float64(targetID) {
			t.Errorf("local target PATCH must not change any other Source field: %+v %v", payload, err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":42,"revision":8,"name":"backup","kind":"local_folder","direction":"push","sync_mode":"backup","status":"paused","target_node_id":81,"target_path":"Archive"}`))
	}))
	defer server.Close()
	c := New(server.URL, "owner")
	proof := LocalBoundSourceProof{
		DeviceID: "device-A", DeviceToken: "agent-private-credential",
		RootID: "root-A", RootFingerprint: "fingerprint-A",
	}
	if _, err := c.RetargetLocalBoundSource(context.Background(), 42, 7, 0, proof); err == nil || requests != 0 {
		t.Fatalf("invalid target dispatched a request: %v, %d", err, requests)
	}
	out, err := c.RetargetLocalBoundSource(context.Background(), 42, 7, targetID, proof)
	if err != nil || requests != 1 || out.ID != 42 || out.Revision != 8 ||
		out.TargetNodeID == nil || *out.TargetNodeID != targetID {
		t.Fatalf("local target update failed: %+v %v requests=%d", out, err, requests)
	}
}
