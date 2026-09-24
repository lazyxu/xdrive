//go:build windows

package main

import (
	"strings"
	"testing"

	xupdate "github.com/lazyxu/xdrive/internal/update"
)

func TestWindowsUpdateTransactionDoctorCheck(t *testing.T) {
	tests := []struct {
		name       string
		state      xupdate.InstallStatus
		wantStatus string
		wantDetail string
	}{
		{
			name: "success",
			state: xupdate.InstallStatus{
				State: "success", TargetVersion: "snapshot-abc123456789",
				UpdatedAt: "2026-09-24T12:34:56Z",
				Message:   "C:\\Users\\secret\\xDrive", LogPath: "C:\\Users\\secret\\last.log",
			},
			wantStatus: doctorPass,
			wantDetail: "success -> snapshot-abc123456789 @ 2026-09-24T12:34:56Z",
		},
		{
			name: "rolled back",
			state: xupdate.InstallStatus{
				State: "rolled_back", TargetVersion: "v1.2.3",
				UpdatedAt: "2026-09-24T12:34:56Z", RolledBack: true,
			},
			wantStatus: doctorWarn,
			wantDetail: "rolled_back -> v1.2.3 @ 2026-09-24T12:34:56Z",
		},
		{
			name: "failed",
			state: xupdate.InstallStatus{
				State: "failed", TargetVersion: "v2.0.0",
				Message: "token=super-secret", LogPath: "C:\\Users\\secret\\last.log",
			},
			wantStatus: doctorFail,
			wantDetail: "failed -> v2.0.0",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := windowsUpdateTransactionCheckFromStatus(tc.state)
			if got.Status != tc.wantStatus || got.Detail != tc.wantDetail {
				t.Fatalf("check=%+v want status=%s detail=%q", got, tc.wantStatus, tc.wantDetail)
			}
			if strings.Contains(got.Detail, "secret") || strings.Contains(got.Detail, "Users") {
				t.Fatalf("transaction detail leaked message/path: %q", got.Detail)
			}
		})
	}
}
