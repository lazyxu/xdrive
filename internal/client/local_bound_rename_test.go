package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRenameLocalBoundSourceRequiresDeviceRootAndRevisionProof(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != http.MethodPatch || r.URL.Path != "/api/v1/sources/42" ||
			r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("If-Match") != "\"7\"" ||
			r.Header.Get("X-XDrive-Device-ID") != "device-A" ||
			r.Header.Get("X-XDrive-Device-Token") != "secret-A" ||
			r.Header.Get("X-XDrive-Local-Root-ID") != "root-A" ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != "fingerprint-A" {
			t.Error("missing native root/credential/revision proof")
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || len(payload) != 1 || payload["name"] != "renamed" {
			t.Errorf("rename must change only name: %+v %v", payload, err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":42,"revision":8,"name":"renamed","kind":"local_folder","direction":"push","status":"paused"}`))
	}))
	defer server.Close()
	cli := New(server.URL, "owner")
	got, err := cli.RenameLocalBoundSource(context.Background(), 42, 7, "renamed", LocalBoundSourceProof{
		DeviceID: "device-A", DeviceToken: "secret-A", RootID: "root-A", RootFingerprint: "fingerprint-A",
	})
	if err != nil || calls != 1 || got.ID != 42 || got.Revision != 8 {
		t.Fatalf("rename: %+v %v calls=%d", got, err, calls)
	}
}
