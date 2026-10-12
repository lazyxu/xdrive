package main

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestDesktopAdminAuditRangeValidation(t *testing.T) {
	valid := client.AdminAuditRangeQuery{
		Limit: 100, Offset: 0, Action: "admin.user.create", Result: "success", Actor: "owner",
	}
	if !validDesktopAdminAuditRange(valid) {
		t.Fatal("expected bounded audit query to pass")
	}
	for _, query := range []client.AdminAuditRangeQuery{
		{Limit: 0}, {Limit: 201}, {Limit: 10, Offset: -1},
		{Limit: 10, Result: "pending"},
		{Limit: 10, Action: string(make([]byte, 81))},
		{Limit: 10, Actor: string(make([]byte, 65))},
	} {
		if validDesktopAdminAuditRange(query) {
			t.Fatalf("invalid query accepted: %+v", query)
		}
	}
}
