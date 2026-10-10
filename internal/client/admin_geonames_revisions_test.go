package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAdminGeoNamesRevisionHistoryAndRollbackTransport(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("Authorization") != "Bearer admin-session" {
			t.Error("administrator session not forwarded")
		}
		if r.URL.Path == "/api/v1/admin/services/geonames/revisions" && r.Method == http.MethodGet {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"items":[{"revision":0,"max_distance_km":5,"origin":"environment","created_at":"2026-10-10T00:00:00Z"}]}`))
			return
		}
		if r.URL.Path == "/api/v1/admin/services/geonames/rollback" && r.Method == http.MethodPost {
			if r.Header.Get("Content-Type") != "application/json" {
				t.Error("rollback JSON content-type was not sent")
			}
			var data AdminGeoNamesRollbackInput
			if err := json.NewDecoder(r.Body).Decode(&data); err != nil ||
				data.Revision != 2 || data.TargetRevision != 0 {
				t.Errorf("rollback request lost revision fencing: %+v (%v)", data, err)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"dataset_configured":true,"reload_supported":true,"source":"saved","current_version":"test-version","max_distance_km":5,"effective_max_distance_km":5,"editable":true,"revision":3,"apply_state":"applied","requires_restart":false}`))
			return
		}
		t.Errorf("unexpected GeoNames endpoint: %s %s", r.Method, r.URL.Path)
		http.NotFound(w, r)
	}))
	defer server.Close()

	cli := New(server.URL, "admin-session")
	page, err := cli.AdminGeoNamesRevisions(context.Background())
	if err != nil || len(page.Items) != 1 || page.Items[0].Revision != 0 ||
		page.Items[0].MaxDistanceKM != 5 {
		t.Fatalf("history transport: %+v err=%v", page, err)
	}
	config, err := cli.RollbackAdminGeoNames(context.Background(),
		AdminGeoNamesRollbackInput{Revision: 2, TargetRevision: 0})
	if err != nil || config.Revision != 3 || config.ApplyState != "applied" ||
		config.MaxDistanceKM != 5 || config.EffectiveDistance != 5 {
		t.Fatalf("rollback transport: %+v err=%v", config, err)
	}
	if calls != 2 {
		t.Fatalf("want 2 admin requests, got %d", calls)
	}
}
