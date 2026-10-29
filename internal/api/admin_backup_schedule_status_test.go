package api

import "testing"

func TestBackupAdminScheduleStatusStrictShape(t *testing.T) {
	for _, tc := range []struct {
		name  string
		state string
		expr  string
		valid bool
	}{
		{"confirmed", "registered", "0 3 * * *", true},
		{"every five", "not_detected", "*/5 * * * *", true},
		{"macro", "registered", "@daily", true},
		{"none", "not_configured", "", true},
		{"unreadable", "unknown", "", true},
		{"stale", "mismatch", "0 3 * * *", true},
		{"forged enabled", "registered", "", false},
		{"forged not configured", "not_configured", "0 3 * * *", false},
		{"bad enum", "enabled", "0 3 * * *", false},
		{"host command", "registered", "0 3 * * * ; rm -rf", false},
		{"path", "registered", "/var/backups", false},
		{"long", "registered", "0 3 * * * 01234567890123456789012345678901234567890123456789012345678901234567890", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status := &backupAdminScheduleStatus{
				Protocol: "xdrive-host-backup-schedule-v1",
				Source:   "installer_crontab",
				State:    tc.state, Expression: tc.expr,
			}
			if got := validBackupAdminScheduleStatus(status); got != tc.valid {
				t.Fatalf("valid=%v, expected=%v", got, tc.valid)
			}
			status.Source = "other_schedule"
			if validBackupAdminScheduleStatus(status) {
				t.Fatal("untrusted schedule source accepted")
			}
		})
	}
	if !validBackupAdminScheduleStatus(nil) {
		t.Fatal("old Host status without schedule receipt must remain compatible")
	}
}
