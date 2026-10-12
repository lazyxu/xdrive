package api

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPhotoHostPreflightIsReadOnlyAndNeverAuthorizesApply(t *testing.T) {
	healthy := photoIntelligenceHostStatus{State: "healthy", ProfileConfigured: true}
	control := photoHostControlStatus{Supported: true, State: "idle"}
	cases := []struct {
		name            string
		desired         photoHostDesired
		host            photoIntelligenceHostStatus
		hostObserved    bool
		control         photoHostControlStatus
		controlObserved bool
		queueClear      bool
		action          string
		localComplete   bool
	}{
		{"unmanaged", photoHostDesired{}, healthy, true, control, true, true, "unset", false},
		{"desired-disable", photoHostDesired{Revision: 2}, healthy, true, control, true, true, "disable", false},
		{"healthy-enable", photoHostDesired{Revision: 2, Enabled: true}, healthy, true, control, true, true, "enable", true},
		{"stopped-enable", photoHostDesired{Revision: 3, Enabled: true}, photoIntelligenceHostStatus{State: "stopped"}, true, control, true, true, "enable", true},
		{"unknown-host", photoHostDesired{Revision: 2, Enabled: true}, healthy, false, control, true, true, "enable", false},
		{"old-runner", photoHostDesired{Revision: 2, Enabled: true}, healthy, true, control, false, true, "enable", false},
		{"queued-request", photoHostDesired{Revision: 2, Enabled: true}, healthy, true, control, true, false, "enable", false},
		{"running-control", photoHostDesired{Revision: 2, Enabled: true}, healthy, true, photoHostControlStatus{Supported: true, State: "running"}, true, true, "enable", false},
		{"unhealthy", photoHostDesired{Revision: 2, Enabled: true}, photoIntelligenceHostStatus{State: "unhealthy"}, true, control, true, true, "enable", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			report := photoHostPreflight(tc.desired, tc.host, tc.hostObserved, tc.control, tc.controlObserved, tc.queueClear)
			if report.Action != tc.action || report.LocalChecksComplete != tc.localComplete ||
				report.ApplySupported || len(report.Checks) != 7 || report.DesiredRevision != tc.desired.Revision {
				t.Fatalf("unsafe preflight result: %+v", report)
			}
			if report.Checks[5].ID != "admin-dispatch" || report.Checks[5].State != "blocked" {
				t.Fatalf("preflight falsely granted administrator host control: %+v", report)
			}
		})
	}
}

func TestPhotoHostPreflightQueueFailsClosed(t *testing.T) {
	dir := t.TempDir()
	s := &Server{HostControlDir: dir}
	if !s.photoHostLocalQueueClear() {
		t.Fatal("an empty operator-controlled directory should be locally clear")
	}
	for _, file := range []string{"photo-host-control-request.json", "photo-host-control-active.json", "photo-host-control-recovery"} {
		p := filepath.Join(dir, file)
		if err := os.WriteFile(p, []byte("{}"), 0600); err != nil {
			t.Fatal(err)
		}
		if s.photoHostLocalQueueClear() {
			t.Fatalf("queued or active %s ignored", file)
		}
		if err := os.Remove(p); err != nil {
			t.Fatal(err)
		}
	}
	outside := filepath.Join(t.TempDir(), "target")
	if err := os.WriteFile(outside, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(dir, "photo-host-control-request.json")); err != nil {
		t.Fatal(err)
	}
	if s.photoHostLocalQueueClear() {
		t.Fatal("symlink queue ignored")
	}
	if (&Server{}).photoHostLocalQueueClear() {
		t.Fatal("unconfigured bridge looked clear")
	}
}
