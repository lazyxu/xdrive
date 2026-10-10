package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAdminPhotoAutoRevisionHistoryAndRollbackTransport(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("Authorization") != "Bearer admin-session" {
			t.Error("administrator session was not forwarded")
		}
		switch {
		case r.URL.Path == "/api/v1/admin/services/photo-intelligence/revisions" && r.Method == http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"items":[{"revision":0,"auto_enabled":true,"kinds":{"face":true,"smart":true,"semantic":true,"person_cluster":true},"origin":"default","created_at":"2026-10-10T00:00:00Z"}]}`))
		case r.URL.Path == "/api/v1/admin/services/photo-intelligence/rollback" && r.Method == http.MethodPost:
			if r.Header.Get("Content-Type") != "application/json" {
				t.Error("rollback request must use JSON")
			}
			var input AdminPhotoAutoRollbackInput
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil ||
				input.Revision != 3 || input.TargetRevision != 0 {
				t.Errorf("rollback revision fencing was lost: %+v (%v)", input, err)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"auto_enabled":true,"effective_auto_enabled":true,"kinds":{"face":true,"smart":true,"semantic":true,"person_cluster":true},"effective_kinds":{"face":true,"smart":true,"semantic":true,"person_cluster":true},"revision":4,"effective_revision":4,"source":"saved","apply_state":"applied","editable":true,"requires_restart":false}`))
		default:
			t.Errorf("unexpected Photo Intelligence path: %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	cli := New(server.URL, "admin-session")
	page, err := cli.AdminPhotoAutoRevisions(context.Background())
	if err != nil || len(page.Items) != 1 || page.Items[0].Revision != 0 ||
		!page.Items[0].AutoEnabled || !page.Items[0].Kinds.Face {
		t.Fatalf("Photo Intelligence revision transport: %+v err=%v", page, err)
	}
	config, err := cli.RollbackAdminPhotoAuto(context.Background(),
		AdminPhotoAutoRollbackInput{Revision: 3, TargetRevision: 0})
	if err != nil || config.Revision != 4 || config.ApplyState != "applied" ||
		config.Kinds == nil || !config.Kinds.Semantic || !config.EffectiveAutoEnabled {
		t.Fatalf("Photo Intelligence rollback transport: %+v err=%v", config, err)
	}
	if calls != 2 {
		t.Fatalf("want 2 privileged requests, got %d", calls)
	}
}
