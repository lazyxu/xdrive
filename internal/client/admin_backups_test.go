package client

import "testing"

func TestAdminServerBackupSnapshotPageTenThousandBound(t *testing.T) {
	for _, tc := range []struct {
		offset, limit int
		ok            bool
	}{
		{0, 1, true},
		{100, 50, true},
		{1000, 100, true}, // Legacy Host v1 boundary.
		{1001, 50, true},
		{9950, 100, true},
		{10000, 1, true}, // Legal request; truncated Host responds with a conflict.
		{10001, 1, false},
		{-1, 50, false},
		{0, 0, false},
		{0, 101, false},
	} {
		if got := validAdminServerBackupSnapshotPage(tc.offset, tc.limit); got != tc.ok {
			t.Fatalf("offset=%d limit=%d accepted=%v want=%v", tc.offset, tc.limit, got, tc.ok)
		}
	}
}
