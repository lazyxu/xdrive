package client

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCreateLocalSourceSendsAgentCredentials(t *testing.T) {
	const secret = "device-secret-created-in-the-Agent-00000001"
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/sources" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if r.Header.Get("Authorization") != "Bearer account-token" ||
			r.Header.Get("X-XDrive-Device-ID") != "device-A" ||
			r.Header.Get("X-XDrive-Device-Token") != secret {
			t.Errorf("missing native credential or authenticated account")
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil ||
			payload["kind"] != "local_folder" || payload["direction"] != "push" {
			t.Errorf("invalid payload: %+v: %v", payload, err)
		}
		if _, supplied := payload["target_node_id"]; supplied {
			t.Errorf("local Push creation must leave target selection to the Server: %+v", payload)
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":42,"name":"backup","kind":"local_folder","direction":"push","status":"paused","revision":1,"target_node_id":77,"target_managed":true,"target_path":"同步文件夹/Push/device_123456789abc/backup"}`))
	}))
	defer server.Close()
	client := New(server.URL, "account-token")
	out, err := client.CreateLocalSource(context.Background(), CreateSourceInput{
		Name: "backup", Kind: "local_folder", Direction: "push",
	}, "device-A", secret)
	if err != nil || out.ID != 42 || out.TargetNodeID == nil || *out.TargetNodeID != 77 ||
		!out.TargetManaged || out.TargetPath == "" || requests != 1 {
		t.Fatalf("local source create: %+v, %v, requests %d", out, err, requests)
	}
}

func TestCreateLocalSourceLegacyServerConfigurationRejection(t *testing.T) {
	const legacyMessage = "Valid Source configuration is required."
	const deviceID = "device-A"
	const deviceSecret = "device-secret-stored-only-in-owning-Agent"
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/sources" {
			t.Errorf("unexpected source creation request %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer account-token" ||
			r.Header.Get("X-XDrive-Device-ID") != deviceID ||
			r.Header.Get("X-XDrive-Device-Token") != deviceSecret {
			t.Error("local Source creation must carry authenticated Owner and owning Agent device proof")
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("decode local source request: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		for key, expected := range map[string]string{
			"name": "下载", "kind": "local_folder", "direction": "push",
			"sync_mode": "backup", "run_mode": "sync", "schedule_type": "manual",
		} {
			if payload[key] != expected {
				t.Errorf("unexpected %s in local source request: %v", key, payload[key])
			}
		}
		if _, supplied := payload["target_node_id"]; supplied {
			t.Error("never retry a legacy Server with an arbitrary user-selected cloud target")
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"Valid Source configuration is required."}`))
	}))
	defer server.Close()

	cli := New(server.URL, "account-token")
	created, err := cli.CreateLocalSource(context.Background(), CreateSourceInput{
		Name: "下载", Kind: "local_folder", Direction: "push",
		SyncMode: "backup", RunMode: "sync", ScheduleType: "manual",
	}, deviceID, deviceSecret)
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Status != http.StatusBadRequest ||
		apiErr.Msg != legacyMessage || !strings.Contains(err.Error(), legacyMessage) {
		t.Fatalf("legacy configuration denial was not preserved: %v", err)
	}
	if created.ID != 0 || created.TargetNodeID != nil || requests != 1 {
		t.Fatalf("legacy denial must not claim a created draft or retry with a different target: source=%+v requests=%d", created, requests)
	}
}
