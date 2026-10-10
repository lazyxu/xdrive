package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAdminGeoNamesTemporaryDatasetApplyClientTransport(t *testing.T) {
	const endpoint = "/api/v1/admin/services/geonames/dataset-snapshots/apply"
	expected := AdminGeoNamesDatasetApplyInput{
		Revision:            9,
		ExpectedVersion:     "v1:previous",
		ExpectedFingerprint: "old-fingerprint",
		Target:              "deployment",
	}
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != endpoint || r.Method != http.MethodPost ||
			r.Header.Get("Authorization") != "Bearer admin-dataset-apply" ||
			r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("unexpected GeoNames apply request: %s %s", r.Method, r.URL.Path)
			http.Error(w, "bad transport", http.StatusBadRequest)
			return
		}
		var input AdminGeoNamesDatasetApplyInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil || input != expected {
			t.Errorf("dataset apply lost revision or current source fingerprint: %+v (%v)", input, err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"dataset_configured":true,"source":"saved","current_version":"v1:mounted","max_distance_km":8,"effective_max_distance_km":8,"revision":9,"apply_state":"applied","active_dataset_source":"deployment","active_dataset_fingerprint":"","active_dataset_persistent":true,"snapshot_apply_supported":true,"snapshot_supported":true,"snapshot_history_known":true}`))
	}))
	defer server.Close()
	c := New(server.URL, "admin-dataset-apply")
	result, err := c.ApplyAdminGeoNamesDataset(context.Background(), expected)
	if err != nil || result.CurrentVersion != "v1:mounted" ||
		result.ActiveDatasetSource != "deployment" || result.ActiveDatasetFingerprint != "" ||
		!result.ActiveDatasetPersistent || !result.SnapshotApplySupported || calls != 1 {
		t.Fatalf("applied status lost in Go Client/Desktop transport: %+v err=%v calls=%d", result, err, calls)
	}
}
