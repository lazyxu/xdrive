package client

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRemoveLocalBoundSourceRequiresOwningDeviceRootAndRevision(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != http.MethodDelete || r.URL.Path != "/api/v1/sources/42" ||
			r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("If-Match") != "\"7\"" ||
			r.Header.Get("X-XDrive-Device-ID") != "device-A" ||
			r.Header.Get("X-XDrive-Device-Token") != "secret-A" ||
			r.Header.Get("X-XDrive-Local-Root-ID") != "root-A" ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != "fingerprint-A" {
			t.Error("native ownership proof missing")
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()
	cli := New(srv.URL, "owner")
	proof := LocalBoundSourceProof{
		DeviceID: "device-A", DeviceToken: "secret-A",
		RootID: "root-A", RootFingerprint: "fingerprint-A",
	}
	if err := cli.RemoveLocalBoundSource(context.Background(), 42, 7, proof); err != nil || calls != 1 {
		t.Fatalf("own removal failed: %v, calls=%d", err, calls)
	}
	if err := cli.RemoveLocalBoundSource(context.Background(), 42, 0, proof); err == nil || calls != 1 {
		t.Fatalf("invalid revision sent a request: %v calls=%d", err, calls)
	}
}
