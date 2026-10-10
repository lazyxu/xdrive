package client

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLocalSourceDraftsRequiresEnrollmentHeadersAndCursor(t *testing.T) {
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/device-backups/local-drafts" ||
			r.URL.Query().Get("limit") != "7" || r.URL.Query().Get("after_id") != "31" {
			t.Errorf("incorrect device draft request: %s %s", r.Method, r.URL.String())
		}
		if r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("X-XDrive-Device-ID") != "device-A" ||
			r.Header.Get("X-XDrive-Device-Token") != "agent-enrollment-secret" {
			t.Error("local Source draft request missing authenticated native enrollment")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"source_id":32,"name":"draft","revision":1,"created_at":"2026-10-10T00:00:00Z"}],"has_more":true,"next_after_id":32}`))
	}))
	defer server.Close()
	c := New(server.URL, "owner")
	got, err := c.LocalSourceDrafts(context.Background(), "device-A", "agent-enrollment-secret", 7, 31)
	if err != nil || requestCount != 1 || len(got.Items) != 1 || got.Items[0].SourceID != 32 ||
		!got.HasMore || got.NextAfterID != 32 {
		t.Fatalf("unexpected native local draft response: %+v %v", got, err)
	}
}
