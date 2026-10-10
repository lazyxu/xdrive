package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAdminGeoNamesSnapshotStageTransportNeverClaimsApply(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path == "/api/v1/admin/services/geonames" && r.Method == http.MethodGet {
			if r.Header.Get("Authorization") != "Bearer snapshot-admin" {
				t.Error("GeoNames admin config lost session authorization")
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"dataset_configured":true,"source":"saved","revision":7,"current_version":"v1:current","snapshot_supported":true,"snapshot_requirement":"operator directory","snapshot_history_known":true,"snapshots":[{"fingerprint":"abc123","resolver_version":"v1:staged","checked_radius_km":7.5,"checked_revision":7,"total_bytes":1200,"created_at":"2026-10-10T00:00:00Z","locally_present":true}],"replica_apply_state":"pending","observed_instances":2,"applied_instances":1,"dataset_versions":[{"version":"v1:current","count":1}]}`))
			return
		}
		if r.URL.Path != "/api/v1/admin/services/geonames/dataset-snapshots" ||
			r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer snapshot-admin" ||
			r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("unexpected GeoNames stage request %s %s (headers %v)", r.Method, r.URL.Path, r.Header)
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		var input AdminGeoNamesSnapshotInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil ||
			input.Revision != 7 || input.ExpectedVersion != "v1:current" {
			t.Errorf("GeoNames staging lost optimistic revision: %+v (%v)", input, err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"staged":true,"applied":false,"snapshot":{"fingerprint":"abc123","resolver_version":"v1:staged","checked_radius_km":7.5,"checked_revision":7,"total_bytes":1200,"created_at":"2026-10-10T00:00:00Z","locally_present":true}}`))
	}))
	defer server.Close()
	cli := New(server.URL, "snapshot-admin")
	out, err := cli.StageAdminGeoNamesSnapshot(context.Background(),
		AdminGeoNamesSnapshotInput{Revision: 7, ExpectedVersion: "v1:current"})
	if err != nil || !out.Staged || out.Applied ||
		!out.Snapshot.LocallyPresent || out.Snapshot.Fingerprint != "abc123" ||
		out.Snapshot.CheckedRevision != 7 || out.Snapshot.TotalBytes != 1200 {
		t.Fatalf("staging HTTP client contract incorrect: %+v err=%v", out, err)
	}
	config, err := cli.AdminGeoNamesConfig(context.Background())
	if err != nil || !config.SnapshotSupported || !config.SnapshotHistoryKnown ||
		config.SnapshotRequirement != "operator directory" ||
		len(config.Snapshots) != 1 || config.Snapshots[0].Fingerprint != out.Snapshot.Fingerprint ||
		!config.Snapshots[0].LocallyPresent || config.Snapshots[0].CheckedRevision != 7 ||
		config.ReplicaApplyState != "pending" || config.ObservedInstances != 2 ||
		config.AppliedInstances != 1 || len(config.DatasetVersions) != 1 {
		t.Fatalf("GeoNames status fields lost through Go Client Desktop Agent bridge: %+v, err %v", config, err)
	}
	if calls != 2 {
		t.Fatalf("expected stage and status requests, got %d", calls)
	}
}
