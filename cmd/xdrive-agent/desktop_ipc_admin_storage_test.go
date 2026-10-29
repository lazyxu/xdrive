package main

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestDesktopAdminStorageFixedOperations(t *testing.T) {
	for _, req := range []client.AdminStorageRequest{
		{Operation: "stats"}, {Operation: "health"}, {Operation: "optimization-advice"}, {Operation: "history", Days: 30},
		{Operation: "history", Days: 90}, {Operation: "history", Days: 180},
		{Operation: "verification-runs", Limit: 20},
		{Operation: "verification-runs", Limit: 50, Cursor: "18446744073709551615"},
		{Operation: "legacy", Limit: 20}, {Operation: "unreferenced", Limit: 20},
		{Operation: "staging", Limit: 20}, {Operation: "cleanup-runs", Limit: 20},
		{Operation: "cleanup-failures", RunID: 1, Limit: 100},
		{Operation: "cleanup-staging"}, {Operation: "cleanup-cache", Kind: "media_thumbnail"},
	} {
		if !validDesktopAdminStorageRequest(req) {
			t.Fatalf("expected fixed operation: %+v", req)
		}
	}
	for _, req := range []client.AdminStorageRequest{
		{Operation: "arbitrary-url"}, {Operation: "history", Days: 365},
		{Operation: "cleanup-cache", Kind: "all-files"},
		{Operation: "cleanup-failures", RunID: 0, Limit: 20},
		{Operation: "legacy", Limit: 0}, {Operation: "stats", Cursor: string(make([]byte, 2049))},
		{Operation: "verification-runs", Limit: 0},
		{Operation: "verification-runs", Limit: 51},
		{Operation: "verification-runs", Limit: 20, Cursor: "01"},
		{Operation: "verification-runs", Limit: 20, Cursor: "18446744073709551616"},
		{Operation: "verification-runs", Limit: 20, Cursor: "../../etc"},
		{Operation: "verification-runs", Limit: 20, Days: 30},
	} {
		if validDesktopAdminStorageRequest(req) {
			t.Fatalf("invalid operation accepted: %+v", req)
		}
	}
}
