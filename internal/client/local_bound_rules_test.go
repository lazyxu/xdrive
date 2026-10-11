package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLocalBoundRulesPrivateReadAndProofedWrite(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("X-XDrive-Device-ID") != "device-A" ||
			r.Header.Get("X-XDrive-Device-Token") != "private-device-token" ||
			r.Header.Get("X-XDrive-Local-Root-ID") != "root-A" ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != "fingerprint-A" {
			t.Error("local rules request missing owner, device or Root proof")
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case http.MethodGet:
			if r.URL.Path != "/api/v1/sources/42/local-rules" {
				t.Error("private read must not use generic Source endpoint")
			}
			_, _ = w.Write([]byte("{\"source_id\":42,\"revision\":7,\"ignore_rules\":\"*.tmp\\n!keep.tmp\"}"))
		case http.MethodPatch:
			if r.URL.Path != "/api/v1/sources/42" || r.Header.Get("If-Match") != "\"7\"" {
				t.Error("local rule write missing Source ID or If-Match revision")
			}
			var input map[string]any
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil || len(input) != 1 ||
				input["ignore_rules"] != "*.cache\n!keep.cache" {
				t.Errorf("local rule PATCH changed any field beyond ignore_rules: %+v err=%v", input, err)
			}
			// Generic Source DTO is redacted by design; client must use its
			// own validated successful revision and submitted rules.
			_, _ = w.Write([]byte("{\"id\":42,\"revision\":8,\"kind\":\"local_folder\",\"direction\":\"push\",\"status\":\"paused\"}"))
		default:
			t.Errorf("unexpected local rules method %s", r.Method)
		}
	}))
	defer server.Close()

	cli := New(server.URL, "owner")
	proof := LocalBoundSourceProof{
		DeviceID: "device-A", DeviceToken: "private-device-token",
		RootID: "root-A", RootFingerprint: "fingerprint-A",
	}
	if _, err := cli.LocalBoundRules(context.Background(), 0, proof); err == nil || requests != 0 {
		t.Fatalf("invalid Source dispatched private read: %v count=%d", err, requests)
	}
	loaded, err := cli.LocalBoundRules(context.Background(), 42, proof)
	if err != nil || loaded.SourceID != 42 || loaded.Revision != 7 || loaded.IgnoreRules != "*.tmp\n!keep.tmp" {
		t.Fatalf("private rules read failed: %+v err=%v", loaded, err)
	}
	if _, err := cli.SetLocalBoundRules(context.Background(), 42, 0, "x", proof); err == nil || requests != 1 {
		t.Fatalf("invalid revision dispatched mutation: err=%v count=%d", err, requests)
	}
	saved, err := cli.SetLocalBoundRules(context.Background(), 42, 7, "*.cache\n!keep.cache", proof)
	if err != nil || requests != 2 || saved.SourceID != 42 ||
		saved.Revision != 8 || saved.IgnoreRules != "*.cache\n!keep.cache" {
		t.Fatalf("private rules update failed: %+v err=%v count=%d", saved, err, requests)
	}
}
