package client

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDiscardLocalSourceDraftUsesAgentCredentialAndRevision(t *testing.T) {
	const secret = "agent-local-draft-creator-secret-00000000001"
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != http.MethodDelete || r.URL.Path != "/api/v1/sources/42/local-draft" {
			t.Errorf("unexpected local draft request %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer owner-token" ||
			r.Header.Get("If-Match") != `"3"` ||
			r.Header.Get("X-XDrive-Device-ID") != "device-a" ||
			r.Header.Get("X-XDrive-Device-Token") != secret {
			t.Errorf("local draft deletion lost owner, revision or exact device proof")
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	client := New(server.URL, "owner-token")
	if err := client.DiscardLocalSourceDraft(context.Background(), 42, 3, "device-a", secret); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatalf("expected one private local draft request, got %d", calls)
	}
}
