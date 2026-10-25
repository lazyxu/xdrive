package api

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestStorageOptimizationAdvisoryUsesDurableAdminTask(t *testing.T) {
	kind := meta.SystemMaintenanceKindStorageOptimization
	if !systemMaintenanceInteractiveKind(kind) {
		t.Fatal("advisory task not exposed to administrators")
	}
	if systemMaintenancePhase(kind) != meta.SystemMaintenancePhaseStorageOptimization {
		t.Fatal("advisory phase missing")
	}
	if systemMaintenanceLeaderKey(kind) == "" {
		t.Fatal("advisory would run without cross-server maintenance lease")
	}
	ref, ok := parseBackgroundTaskRef("system-maintenance:" + kind)
	if !ok || ref.kind != kind || ref.domain != "system_maintenance" {
		t.Fatalf("advisory task not routed through existing Task Center: %+v", ref)
	}
	if !backgroundTaskActionAllowed(systemMaintenanceControlActions(kind, meta.SystemMaintenanceStatusSuccess), backgroundTaskActionRun) {
		t.Fatal("completed advisory cannot be repeated after more data is synchronized")
	}
	if !backgroundTaskActionAllowed(systemMaintenanceControlActions(kind, meta.SystemMaintenanceStatusRunning), backgroundTaskActionCancel) {
		t.Fatal("running advisory should remain cancellable")
	}
}
