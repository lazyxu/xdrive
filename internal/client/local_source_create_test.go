package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
