package main

import (
	"net/url"
	"testing"
)

func TestAdminBackupSnapshotPageQueryRejectsUnboundedAndUnsafeInputs(t *testing.T) {
	for _, tc := range []struct {
		raw    string
		offset int
		limit  int
		ok     bool
	}{
		{"offset=100&limit=50", 100, 50, true},
		{"offset=1000&limit=100", 1000, 100, true},
		{"offset=1001&limit=50", 1001, 50, true},
		{"offset=9950&limit=100", 9950, 100, true},
		{"offset=10000&limit=100", 10000, 100, true},
		{"offset=0&limit=1", 0, 1, true},
		{"offset=-1&limit=20", 0, 0, false},
		{"offset=10001&limit=20", 0, 0, false},
		{"offset=99999&limit=20", 0, 0, false},
		{"offset=0&limit=0", 0, 0, false},
		{"offset=0&limit=101", 0, 0, false},
		{"offset=0&limit=1.0", 0, 0, false},
		{"offset=0&limit=20&path=/etc", 0, 0, false},
		{"offset=0&offset=10&limit=20", 0, 0, false},
		{"offset=0", 0, 0, false},
		{"limit=20", 0, 0, false},
		{"offset=%2B1&limit=20", 0, 0, false},
		{"offset=1&limit=20&command=rm", 0, 0, false},
	} {
		values, err := url.ParseQuery(tc.raw)
		if err != nil {
			t.Fatalf("invalid test query: %v", err)
		}
		offset, limit, ok := boundedAdminBackupSnapshotPageQuery(values)
		if offset != tc.offset || limit != tc.limit || ok != tc.ok {
			t.Fatalf("query=%q received offset=%d limit=%d ok=%v", tc.raw, offset, limit, ok)
		}
	}
}
