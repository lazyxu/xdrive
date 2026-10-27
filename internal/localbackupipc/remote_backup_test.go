package localbackupipc

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRemoteBackupCapabilityAndBoundedReadOnlyIPC(t *testing.T) {
	reads := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reads++
		if r.Header.Get("Authorization") != "Bearer "+strings.Repeat("a", 64) || r.Method != http.MethodGet {
			t.Error("unprotected or writable Agent IPC")
			http.Error(w, "unauthorized", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/device-backups":
			if r.URL.RawQuery != "" {
				t.Error("unexpected device read query")
			}
			_, _ = w.Write([]byte(`{"devices":[{"id":"10000000-0000-4000-8000-000000000001","name":"Remote","platform":"linux","connection_state":"offline","revoked":false,"folders":[]}],"has_more":false,"has_more_folders":false}`))
		case "/v1/device-backups/runs":
			if r.URL.Query().Get("source_id") != "42" || r.URL.Query().Get("limit") != "20" ||
				r.URL.Query().Get("offset") != "0" {
				t.Error("unexpected Owner history query")
			}
			_, _ = w.Write([]byte(`{"items":[{"id":"run.1","source_id":42}],"has_more":false}`))
		default:
			t.Errorf("unapproved Agent endpoint: %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	c := &Client{baseURL: server.URL, token: strings.Repeat("a", 64), http: server.Client()}
	if _, err := c.DeviceBackupOverview(context.Background()); err == nil {
		t.Fatal("missing capability admitted remote read")
	}
	if _, err := c.DeviceBackupRuns(context.Background(), 42, 20, 0); err == nil {
		t.Fatal("missing capability admitted remote history")
	}
	if reads != 0 {
		t.Fatal("missing capability contacted Agent")
	}
	c.capabilities = []string{"device-backup-read"}
	if result, err := c.DeviceBackupOverview(context.Background()); err != nil ||
		len(result.Devices) != 1 || result.Devices[0].Name != "Remote" {
		t.Fatalf("Owner overview failed: %+v %v", result, err)
	}
	if result, err := c.DeviceBackupRuns(context.Background(), 42, 20, 0); err != nil ||
		len(result.Items) != 1 || result.Items[0].SourceID != 42 {
		t.Fatalf("Owner history failed: %+v %v", result, err)
	}
	for _, invalid := range []struct {
		source        uint64
		limit, offset int
	}{
		{0, 20, 0}, {MaxSafeSourceID + 1, 20, 0}, {42, 0, 0},
		{42, 21, 0}, {42, 20, -1}, {42, 20, 100000},
	} {
		if _, err := c.DeviceBackupRuns(context.Background(), invalid.source, invalid.limit, invalid.offset); err == nil {
			t.Fatal("invalid Owner selector admitted")
		}
	}
	if reads != 2 {
		t.Fatalf("unapproved native Agent calls: %d", reads)
	}
}
