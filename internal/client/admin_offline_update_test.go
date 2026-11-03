package client

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOfflineImportClientRejectsUntrustedPathAndDigestBeforeRequest(t *testing.T) {
	if ValidOfflineImportID("../../etc") || ValidOfflineImportID(strings.Repeat("F", 32)) ||
		ValidOfflineImportFile("evil.sh") || ValidOfflineImportFile("../manifest.json") ||
		!ValidOfflineImportFile("xdrive-app-aaaaaaaaaaaa.tar.gz") ||
		!ValidOfflineImportFile("xdrive-offline-linux-amd64") {
		t.Fatal("offline identity regex widened unexpectedly")
	}
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		calls++
	}))
	defer server.Close()
	c := New(server.URL, "secret")
	ctx := context.Background()
	if _, err := c.OfflineImportGet(ctx, "../../outside"); err == nil {
		t.Fatal("unsafe import ID reached Server")
	}
	if err := c.OfflineImportRegister(ctx, strings.Repeat("a", 32), "installer.sh", 123, ""); err == nil {
		t.Fatal("unsafe filename reached Server")
	}
	if _, err := c.StartOfflineServerUpdate(ctx, strings.Repeat("a", 32),
		"bad", strings.Repeat("b", 64), false); err == nil {
		t.Fatal("invalid independent trust values accepted")
	}
	payload := []byte("real data")
	if err := c.OfflineImportChunk(ctx, strings.Repeat("a", 32), "manifest.json",
		0, payload, strings.Repeat("0", 64)); err == nil {
		t.Fatal("chunk with wrong checksum accepted")
	}
	if calls != 0 {
		t.Fatalf("invalid client inputs reached remote Server: %d", calls)
	}
}

func TestOfflineImportClientFixedTransportPreservesAuthAndByteHash(t *testing.T) {
	const id = "0123456789abcdef0123456789abcdef"
	const name = "manifest.json"
	body := []byte("offline bytes")
	sha := sha256.Sum256(body)
	digest := hex.EncodeToString(sha[:])
	var chunkSeen, activateSeen bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" {
			t.Errorf("authenticated Server token missing")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/api/v1/admin/update/offline/imports/"+id+"/files/"+name+"/chunks/0":
			if r.Method != http.MethodPut ||
				r.Header.Get("Content-Type") != "application/octet-stream" ||
				r.Header.Get("X-XDrive-Chunk-SHA256") != digest {
				t.Errorf("invalid bounded offline chunk request")
			}
			raw, err := io.ReadAll(io.LimitReader(r.Body, OfflineImportChunkBytes+1))
			if err != nil || !bytes.Equal(raw, body) {
				t.Errorf("offline chunk bytes changed: %v", err)
			}
			chunkSeen = true
			_, _ = w.Write([]byte(`{"ok":true}`))
		case "/api/v1/admin/update":
			if r.Method != http.MethodPost {
				t.Errorf("invalid offline activation verb")
			}
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Errorf("invalid JSON activation: %v", err)
			}
			if payload["offline_id"] != id ||
				payload["trusted_manifest_sha256"] != digest ||
				payload["trusted_installer_sha256"] != strings.Repeat("b", 64) ||
				payload["source"] != "offline" || payload["channel"] != "master" ||
				payload["backup_file_data"] != true {
				t.Errorf("untrusted activation arguments: %v", payload)
			}
			activateSeen = true
			_, _ = w.Write([]byte(`{"supported":true,"state":"queued","source":"offline","channel":"master"}`))
		default:
			t.Errorf("unexpected arbitrary route: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()
	c := New(srv.URL, "secret")
	ctx := context.Background()
	if err := c.OfflineImportChunk(ctx, id, name, 0, body, digest); err != nil {
		t.Fatal(err)
	}
	state, err := c.StartOfflineServerUpdate(ctx, id, digest, strings.Repeat("b", 64), true)
	if err != nil {
		t.Fatal(err)
	}
	if !chunkSeen || !activateSeen || state.State != "queued" || state.Source != "offline" {
		t.Fatal("fixed offline Host update transport was not preserved")
	}
}
