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
		var payload CreateSourceInput
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload.Kind != "local_folder" || payload.Direction != "push" {
			t.Errorf("invalid payload: %+v: %v", payload, err)
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":42,"name":"backup","kind":"local_folder","direction":"push","status":"paused","revision":1}`))
	}))
	defer server.Close()
	client := New(server.URL, "account-token")
	out, err := client.CreateLocalSource(context.Background(), CreateSourceInput{
		Name: "backup", Kind: "local_folder", Direction: "push", TargetNodeID: 1,
	}, "device-A", secret)
	if err != nil || out.ID != 42 || requests != 1 {
		t.Fatalf("local source create: %+v, %v, requests %d", out, err, requests)
	}
}
