package diagnostics

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRedaction(t *testing.T) {
	home, _ := os.UserHomeDir()
	in := home + string(os.PathSeparator) + "xDrive authorization: bearer abc123 refresh_token=secret"
	got := RedactDetail(in)
	if strings.Contains(got, "abc123") || strings.Contains(got, "secret") {
		t.Fatalf("secret leaked: %q", got)
	}
	if home != "" && strings.Contains(got, filepath.Clean(home)) {
		t.Fatalf("home leaked: %q", got)
	}
}

func TestMaskUser(t *testing.T) {
	if got := MaskUser("xuliang"); got != "xu***" {
		t.Fatalf("mask=%q", got)
	}
}

func TestStructuredReportRedaction(t *testing.T) {
	home, _ := os.UserHomeDir()
	report := NewReport([]Check{{
		Name:   "failure",
		Status: Fail,
		Detail: home + string(os.PathSeparator) + " authorization: bearer super-secret",
	}})
	redacted := Redacted(report)
	if len(redacted.Checks) != 1 {
		t.Fatalf("checks=%+v", redacted.Checks)
	}
	detail := redacted.Checks[0].Detail
	if strings.Contains(detail, "super-secret") || (home != "" && strings.Contains(detail, filepath.Clean(home))) {
		t.Fatalf("structured diagnostic leaked sensitive detail: %q", detail)
	}
}

func TestReportSummaryAndFormat(t *testing.T) {
	report := NewReport([]Check{
		{Name: "a", Status: Pass, Detail: "ok"},
		{Name: "b", Status: Warn, Detail: "watch"},
		{Name: "c", Status: Fail, Detail: "bad"},
	})
	if report.Summary.Pass != 1 || report.Summary.Warn != 1 || report.Summary.Fail != 1 {
		t.Fatalf("summary=%+v", report.Summary)
	}
	text := FormatText(report)
	if !strings.Contains(text, "[PASS]") || !strings.Contains(text, "summary: 1 pass, 1 warn, 1 fail") {
		t.Fatalf("formatted report=%q", text)
	}
}

func TestDiskSpaceStatusRequiresLowPercentageAndLowAbsoluteCapacity(t *testing.T) {
	const gib = uint64(1024 * 1024 * 1024)
	const tib = uint64(1024 * gib)

	tests := []struct {
		name  string
		free  uint64
		total uint64
		want  string
	}{
		{name: "large disk with useful absolute headroom", free: 80 * gib, total: 1536 * gib, want: Pass},
		{name: "low ratio and low absolute headroom", free: 10 * gib, total: 1536 * gib, want: Warn},
		{name: "small disk below ten percent", free: 8 * gib, total: 100 * gib, want: Warn},
		{name: "small disk above ten percent", free: 15 * gib, total: 100 * gib, want: Pass},
		{name: "twenty GiB boundary remains usable", free: 20 * gib, total: tib, want: Pass},
		{name: "unknown total does not warn", free: 0, total: 0, want: Pass},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := diskSpaceStatus(tt.free, tt.total); got != tt.want {
				t.Fatalf("diskSpaceStatus(%d, %d)=%q want %q", tt.free, tt.total, got, tt.want)
			}
		})
	}
}

func TestWithChecksRecalculatesSummary(t *testing.T) {
	report := NewReport([]Check{{Name: "a", Status: Pass, Detail: "ok"}})
	report = WithChecks(report, Check{Name: "b", Status: Fail, Detail: "bad"})
	if len(report.Checks) != 2 || report.Summary.Pass != 1 || report.Summary.Fail != 1 {
		t.Fatalf("report=%+v", report)
	}
}
