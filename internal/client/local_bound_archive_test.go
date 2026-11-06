package client

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestArchiveAndRestoreLocalBoundSourceRequireDeviceRootAndRevision(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("X-XDrive-Device-ID") != "device-A" ||
			r.Header.Get("X-XDrive-Device-Token") != "secret-A" ||
			r.Header.Get("X-XDrive-Local-Root-ID") != "root-A" ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != "fingerprint-A" {
			t.Error("native device and Root proof missing")
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/sources/42/archive":
			if r.Method != http.MethodPost || r.Header.Get("If-Match") != "\""+"7"+"\"" {
				t.Errorf("archive method/revision mismatch: %s %s", r.Method, r.Header.Get("If-Match"))
			}
			_, _ = w.Write([]byte(`{"id":42,"revision":8,"kind":"local_folder","direction":"push","status":"archived"}`))
		case "/api/v1/sources/42/restore":
			if r.Method != http.MethodPost || r.Header.Get("If-Match") != "\""+"8"+"\"" {
				t.Errorf("restore method/revision mismatch: %s %s", r.Method, r.Header.Get("If-Match"))
			}
			_, _ = w.Write([]byte(`{"id":42,"revision":9,"kind":"local_folder","direction":"push","status":"paused"}`))
		default:
			t.Errorf("unexpected route: %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	cli := New(server.URL, "owner")
	proof := LocalBoundSourceProof{
		DeviceID: "device-A", DeviceToken: "secret-A",
		RootID: "root-A", RootFingerprint: "fingerprint-A",
	}
	archived, err := cli.ArchiveLocalBoundSource(context.Background(), 42, 7, proof)
	if err != nil || archived.Status != "archived" || archived.Revision != 8 {
		t.Fatalf("archive result: %+v err=%v", archived, err)
	}
	restored, err := cli.RestoreLocalBoundSource(context.Background(), 42, 8, proof)
	if err != nil || restored.Status != "paused" || restored.Revision != 9 {
		t.Fatalf("restore result: %+v err=%v", restored, err)
	}
	if calls != 2 {
		t.Fatalf("expected two authenticated requests, got %d", calls)
	}
	if _, err := cli.ArchiveLocalBoundSource(context.Background(), 0, 7, proof); err == nil || calls != 2 {
		t.Fatalf("invalid Source ID sent an archive request: calls=%d err=%v", calls, err)
	}
	if _, err := cli.RestoreLocalBoundSource(context.Background(), 42, 0, proof); err == nil || calls != 2 {
		t.Fatalf("invalid revision sent a restore request: calls=%d err=%v", calls, err)
	}
}
