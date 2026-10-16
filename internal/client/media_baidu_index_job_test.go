package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBaiduIndexJobOwnerTransportAndIfMatch(t *testing.T) {
	var paths []string
	const receipt = `{"status":"queued","consent_revision":7,"attempts":0,"dispatch_enabled":false,"activation_state":"blocked_pending_licence_and_provider_review"}`
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer token" {
			t.Errorf("missing trusted Agent Bearer: %q", got)
		}
		if r.URL.Path != "/api/v1/media/items/42/baidu-map-index-job" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		paths = append(paths, r.Method)
		switch r.Method {
		case http.MethodGet:
			if r.Header.Get("If-Match") != "" {
				t.Error("GET must not send a revision")
			}
		case http.MethodPost:
			if got := r.Header.Get("Content-Type"); got != "application/json" {
				t.Errorf("Content-Type=%s", got)
			}
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if len(body) != 2 || body["confirm"] != true || body["expected_revision"] != float64(7) {
				t.Errorf("unsafe POST body: %+v", body)
			}
		case http.MethodDelete:
			if got := r.Header.Get("If-Match"); got != "\"7\"" {
				t.Errorf("missing revision CAS: %q", got)
			}
			if r.ContentLength != 0 {
				t.Error("DELETE must not have a body")
			}
		default:
			t.Errorf("unsafe HTTP method: %s", r.Method)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(receipt))
	}))
	defer upstream.Close()
	c := New(upstream.URL, "token")
	ctx := context.Background()
	if got, err := c.MediaBaiduIndexJob(ctx, 42); err != nil || got.Status != "queued" || got.DispatchEnabled {
		t.Fatalf("GET receipt %+v err=%v", got, err)
	}
	if got, err := c.EnqueueMediaBaiduIndexJob(ctx, 42, MediaBaiduMapIndexJobInput{ExpectedRevision: 7, Confirm: true}); err != nil || got.ConsentRevision != 7 {
		t.Fatalf("POST receipt %+v err=%v", got, err)
	}
	if got, err := c.CancelMediaBaiduIndexJob(ctx, 42, 7); err != nil || got.ActivationState != "blocked_pending_licence_and_provider_review" {
		t.Fatalf("DELETE receipt %+v err=%v", got, err)
	}
	if len(paths) != 3 {
		t.Fatalf("real HTTP requests: %v", paths)
	}
	if _, err := c.EnqueueMediaBaiduIndexJob(ctx, 42, MediaBaiduMapIndexJobInput{ExpectedRevision: 7, Confirm: false}); err == nil {
		t.Fatal("unconfirmed POST accepted")
	}
	if _, err := c.EnqueueMediaBaiduIndexJob(ctx, 0, MediaBaiduMapIndexJobInput{ExpectedRevision: 7, Confirm: true}); err == nil {
		t.Fatal("invalid primary Node ID accepted")
	}
	if _, err := c.CancelMediaBaiduIndexJob(ctx, 42, 0); err == nil {
		t.Fatal("revision-less cancellation accepted")
	}
	if len(paths) != 3 {
		t.Fatalf("validation hit Server: %v", paths)
	}
}
