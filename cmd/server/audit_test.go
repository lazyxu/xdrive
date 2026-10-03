package main

import (
	"testing"

	auditpkg "github.com/lazyxu/xdrive/internal/audit"
)

func TestSupportedSystemAuditActionIncludesRepairActions(t *testing.T) {
	for _, action := range []string{
		auditpkg.ActionBackup,
		auditpkg.ActionRestore,
		auditpkg.ActionUpdate,
		auditpkg.ActionStorageRepair,
		auditpkg.ActionMediaRepair,
	} {
		if !supportedSystemAuditAction(action) {
			t.Fatalf("action %q was rejected", action)
		}
	}
	if supportedSystemAuditAction("system.unknown") {
		t.Fatal("unknown system audit action was accepted")
	}
}
