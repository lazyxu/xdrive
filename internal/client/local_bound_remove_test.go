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
	if removed, err := cli.RemoveLocalBoundSource(context.Background(), 42, 7, proof); err != nil || removed.ID != 0 || calls != 1 {
		t.Fatalf("own hard removal failed: %+v %v, calls=%d", removed, err, calls)
	}
	if _, err := cli.RemoveLocalBoundSource(context.Background(), 42, 0, proof); err == nil || calls != 1 {
		t.Fatalf("invalid revision sent a request: %v calls=%d", err, calls)
	}
}


func TestRemoveLocalBoundSourceReturnsArchiveWithoutAuthorizingRootCleanup(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete || r.URL.Path != "/api/v1/sources/42" ||
			r.Header.Get("If-Match") != "\""+"7"+"\"" ||
			r.Header.Get("X-XDrive-Device-ID") != "device-A" ||
			r.Header.Get("X-XDrive-Device-Token") != "secret-A" ||
			r.Header.Get("X-XDrive-Local-Root-ID") != "root-A" ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != "fingerprint-A" {
			t.Error("native ownership proof missing")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":42,"revision":8,"kind":"local_folder","direction":"push","status":"archived"}`))
	}))
	defer srv.Close()
	cli := New(srv.URL, "owner")
	removed, err := cli.RemoveLocalBoundSource(context.Background(), 42, 7, LocalBoundSourceProof{
		DeviceID: "device-A", DeviceToken: "secret-A",
		RootID: "root-A", RootFingerprint: "fingerprint-A",
	})
	if err != nil || removed.ID != 42 || removed.Status != "archived" || removed.Revision != 8 {
		t.Fatalf("archive-on-delete response was not preserved: %+v err=%v", removed, err)
	}
}
