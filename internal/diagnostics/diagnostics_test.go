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

func TestWithChecksRecalculatesSummary(t *testing.T) {
	report := NewReport([]Check{{Name: "a", Status: Pass, Detail: "ok"}})
	report = WithChecks(report, Check{Name: "b", Status: Fail, Detail: "bad"})
	if len(report.Checks) != 2 || report.Summary.Pass != 1 || report.Summary.Fail != 1 {
		t.Fatalf("report=%+v", report)
	}
}
