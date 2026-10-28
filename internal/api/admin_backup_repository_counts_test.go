package api

import (
	"testing"
)

func TestBackupAdminRepositoryCountMustMatchHostTotal(t *testing.T) {
	server, dir := readyBackupAdminTestServer(t)
	var original backupAdminInventory
	if err := readSafeBackupAdminJSON(dir, "backup-admin-inventory.json", 128<<10, &original); err != nil {
		t.Fatal(err)
	}
	total := 2
	truncated := false
	valid := []backupAdminRepositoryCount{
		{ID: "v1", SnapshotCount: 1},
		{ID: "v2-default", SnapshotCount: 1},
		{ID: "v2-configured", SnapshotCount: 0},
	}
	tests := []struct {
		name string
		counts *[]backupAdminRepositoryCount
		total *int
		ok bool
	}{
		{"legacy Host without breakdown", nil, nil, true},
		{"valid counts", &valid, &total, true},
		{"unknown namespace", &[]backupAdminRepositoryCount{
			{ID: "v1", SnapshotCount: 1},
			{ID: "v2-other", SnapshotCount: 1},
			{ID: "v2-configured", SnapshotCount: 0},
		}, &total, false},
		{"mismatched sum", &[]backupAdminRepositoryCount{
			{ID: "v1", SnapshotCount: 0},
			{ID: "v2-default", SnapshotCount: 1},
			{ID: "v2-configured", SnapshotCount: 0},
		}, &total, false},
		{"negative count", &[]backupAdminRepositoryCount{
			{ID: "v1", SnapshotCount: -1},
			{ID: "v2-default", SnapshotCount: 3},
			{ID: "v2-configured", SnapshotCount: 0},
		}, &total, false},
		{"missing total", &valid, nil, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			inv := original
			inv.Repositories = tc.counts
			inv.TotalSnapshots = tc.total
			if tc.total != nil { inv.Truncated = &truncated } else { inv.Truncated = nil }
			writeBackupTestJSON(t, dir, "backup-admin-inventory.json", inv)
			page := server.backupAdminState()
			if page.Supported != tc.ok {
				t.Fatalf("untrusted repository summary accepted: %+v", page)
			}
		})
	}
}
