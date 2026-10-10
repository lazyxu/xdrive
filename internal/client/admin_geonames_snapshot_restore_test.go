package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAdminGeoNamesRestoreMissingSnapshotTransport(t *testing.T) {
	expected := AdminGeoNamesRestoreMissingInput{
		Revision: 7, ExpectedVersion: "v1:current",
		ExpectedFingerprint: "",
	}
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != http.MethodPost ||
			r.URL.Path != "/api/v1/admin/services/geonames/dataset-snapshots/restore-missing" ||
			r.Header.Get("Authorization") != "Bearer admin-restore" ||
			r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("restore transport not authorized or routed correctly")
			http.Error(w, "bad transport", http.StatusBadRequest)
			return
		}
		var input AdminGeoNamesRestoreMissingInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil || input != expected {
			t.Errorf("restore lost source/revision fencing: %+v err=%v", input, err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"revision":7,"effective_revision":7,"apply_state":"applied","active_dataset_source":"snapshot","missing_archive_state":"present-unverified","restore_missing_enabled":false,"restore_missing_hint":"restored"}`))
	}))
	defer srv.Close()
	cli := New(srv.URL, "admin-restore")
	got, err := cli.RestoreMissingAdminGeoNamesSnapshot(context.Background(), expected)
	if err != nil || calls != 1 || got.Revision != 7 ||
		got.EffectiveRevision != 7 || got.ApplyState != "applied" ||
		got.ActiveDatasetSource != "snapshot" || got.MissingArchiveState != "present-unverified" ||
		got.RestoreMissingEnabled {
		t.Fatalf("GeoNames restore response was lost across transport: %+v err=%v calls=%d", got, err, calls)
	}
}
