package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSetLocalBoundBackupModeRequiresNativeProofAndOnlyChangesMode(t *testing.T) {
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
			t.Error("backup mode update omitted native Root, device or revision proof")
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil ||
			len(payload) != 1 || payload["sync_mode"] != "mirror" {
			t.Errorf("mode PATCH contains unexpected Source mutations: %+v %v", payload, err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("{\"id\":42,\"revision\":8,\"name\":\"backup\",\"kind\":\"local_folder\",\"direction\":\"push\",\"sync_mode\":\"mirror\",\"status\":\"paused\"}"))
	}))
	defer server.Close()
	cli := New(server.URL, "owner")
	proof := LocalBoundSourceProof{
		DeviceID: "device-A", DeviceToken: "agent-private-credential",
		RootID: "root-A", RootFingerprint: "fingerprint-A",
	}
	for _, invalid := range []string{"", "scan", "Mirror", "delete"} {
		if _, err := cli.SetLocalBoundBackupMode(context.Background(), 42, 7, invalid, proof); err == nil {
			t.Fatalf("invalid backup mode accepted: %q", invalid)
		}
	}
	if _, err := cli.SetLocalBoundBackupMode(context.Background(), 0, 7, "mirror", proof); err == nil || requests != 0 {
		t.Fatalf("invalid Source reached Server: %v requests=%d", err, requests)
	}
	source, err := cli.SetLocalBoundBackupMode(context.Background(), 42, 7, "mirror", proof)
	if err != nil || source.ID != 42 || source.SyncMode != "mirror" || source.Revision != 8 || requests != 1 {
		t.Fatalf("own Agent mode update failed: %+v err=%v requests=%d", source, err, requests)
	}
}
