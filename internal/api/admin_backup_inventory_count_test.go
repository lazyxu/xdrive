package api

import "testing"

// The Host can count more canonical generations than it sends as bounded
// full metadata in one authenticated admin poll. Legacy Host stays usable.
func TestBackupAdminInventoryCountIsBoundedAndBackwardCompatible(t *testing.T) {
	server, dir := readyBackupAdminTestServer(t)
	var inventory backupAdminInventory
	if err := readSafeBackupAdminJSON(dir, "backup-admin-inventory.json", 128<<10, &inventory); err != nil {
		t.Fatal(err)
	}
	if !server.backupAdminState().Supported {
		t.Fatal("legacy Host without count fields must remain usable")
	}
	intPtr := func(v int) *int { return &v }
	boolPtr := func(v bool) *bool { return &v }
	tests := []struct {
		name      string
		total     *int
		truncated *bool
		valid     bool
	}{
		{"known complete", intPtr(2), boolPtr(false), true},
		{"known truncated", intPtr(123), boolPtr(true), true},
		{"smaller than visible", intPtr(1), boolPtr(false), false},
		{"false hidden flag", intPtr(123), boolPtr(false), false},
		{"invented hidden flag", intPtr(2), boolPtr(true), false},
		{"oversized count", intPtr(1000001), boolPtr(true), false},
		{"missing total", nil, boolPtr(true), false},
		{"missing truncated", intPtr(123), nil, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			inventory.TotalSnapshots = tc.total
			inventory.Truncated = tc.truncated
			writeBackupTestJSON(t, dir, "backup-admin-inventory.json", inventory)
			page := server.backupAdminState()
			if page.Supported != tc.valid {
				t.Fatalf("untrusted inventory count unexpectedly accepted/rejected: %+v", page)
			}
			if tc.valid && page.Inventory.TotalSnapshots != nil && *page.Inventory.TotalSnapshots != *tc.total {
				t.Fatalf("authenticated count was lost: %+v", page.Inventory)
			}
		})
	}
}
