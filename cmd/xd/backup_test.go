package main

import (
	"bytes"
	"context"
	"errors"
	"flag"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

type fakeBackupOnceRunner struct {
	start localbackupipc.Summary
	next  localbackupipc.Summary
	polls int
	err   error
}

func (f *fakeBackupOnceRunner) Start(_ context.Context, id uint64) (localbackupipc.Summary, error) {
	if f.start.SourceID != id {
		return localbackupipc.Summary{}, errors.New("wrong source")
	}
	return f.start, f.err
}
func (f *fakeBackupOnceRunner) Status(_ context.Context, id uint64) (localbackupipc.Summary, error) {
	f.polls++
	return f.next, f.err
}

func TestBackupCLIOptionScopeRejectsExplicitDefaultValuedFlags(t *testing.T) {
	tests := []struct {
		action  string
		option  string
		allowed bool
	}{
		{"list", "", true},
		{"list", "--source=0", false},
		{"list", "--poll=2s", false},
		{"once", "--poll=2s", true},
		{"once", "--every=", false},
		{"once", "--run-now=false", false},
		{"auto", "--every=6h", true},
		{"auto", "--run-now=false", true},
		{"auto", "--poll=2s", false},
		{"schedule", "--manual=false", true},
		{"status", "--source=42", true},
		{"status", "--poll=2s", false},
		{"history", "--cron=", false},
		{"cancel", "--every=", false},
		{"init", "--run-now=false", true},
		{"init", "--source=0", false},
		{"bind", "--source=42", true},
		{"bind", "--target-id=0", false},
		{"drafts", "--name=", false},
	}
	for _, tc := range tests {
		t.Run(tc.action+"/"+tc.option, func(t *testing.T) {
			fs := flag.NewFlagSet("backup "+tc.action, flag.ContinueOnError)
			fs.Uint64("source", 0, "")
			fs.Duration("poll", backupPollDefault, "")
			fs.String("every", "", "")
			fs.String("cron", "", "")
			fs.String("timezone", "", "")
			fs.Bool("manual", false, "")
			fs.Bool("run-now", false, "")
			fs.String("name", "", "")
			fs.String("path", "", "")
			fs.Uint64("target-id", 0, "")
			var args []string
			if tc.option != "" {
				args = []string{tc.option}
			}
			if err := fs.Parse(args); err != nil {
				t.Fatal(err)
			}
			err := validateBackupCLIFlags(fs, tc.action)
			if (err == nil) != tc.allowed {
				t.Fatalf("backup %s %q: allowed=%v error=%v", tc.action, tc.option, tc.allowed, err)
			}
		})
	}
}

func TestBackupSourceSelectorRequiresScopeExceptForIndex(t *testing.T) {
	if !validBackupSourceSelector("list", 0, false) {
		t.Fatal("xd backup list without --source must be accepted")
	}
	if validBackupSourceSelector("list", 42, true) ||
		validBackupSourceSelector("list", 0, true) {
		t.Fatal("xd backup list must reject explicit Source selectors")
	}
	if validBackupSourceSelector("once", 0, false) ||
		validBackupSourceSelector("auto", 0, false) ||
		validBackupSourceSelector("status", 0, true) ||
		validBackupSourceSelector("cancel", 9007199254740992, true) {
		t.Fatal("unscoped or unsafe Source operation accepted")
	}
	if !validBackupSourceSelector("once", 42, true) ||
		!validBackupSourceSelector("auto", 42, true) ||
		!validBackupSourceSelector("status", 42, true) {
		t.Fatal("explicit, valid Source operation was rejected")
	}
}

func TestBackupOnceCallsSharedOwnerRunnerAndWaitsForTerminal(t *testing.T) {
	r := &fakeBackupOnceRunner{
		start: localbackupipc.Summary{SourceID: 42, State: "running", Running: true},
		next: localbackupipc.Summary{SourceID: 42, Revision: 3, State: "partial",
			InspectedFiles: 3, ConfirmedFiles: 2, SkippedFiles: 1},
	}
	var output bytes.Buffer
	if err := runBackupOnce(context.Background(), r, 42, 250*time.Millisecond, &output); err != nil {
		t.Fatal(err)
	}
	if r.polls != 1 || !strings.Contains(output.String(), "uploaded=2") ||
		!strings.Contains(output.String(), "unchanged=1") ||
		strings.Contains(output.String(), "backup_complete") {
		t.Fatalf("once did not use the shared per-file Agent result: %q polls=%d", output.String(), r.polls)
	}
}

func TestBackupOnceDoesNotClaimUnsupportedOrUncertainComplete(t *testing.T) {
	for name, changed := range map[string]func(*localbackupipc.Summary){
		"unsupported": func(s *localbackupipc.Summary) { s.UnsupportedFiles = 1; s.InspectedFiles = 2 },
		"uncertain":   func(s *localbackupipc.Summary) { s.State = "uncertain"; s.UncertainFiles = 1 },
		"paused":      func(s *localbackupipc.Summary) { s.State = "paused" },
		"cancelled":   func(s *localbackupipc.Summary) { s.State = "cancelled" },
	} {
		t.Run(name, func(t *testing.T) {
			result := localbackupipc.Summary{SourceID: 9, Revision: 1, State: "partial",
				InspectedFiles: 1, ConfirmedFiles: 1}
			changed(&result)
			if err := backupTerminalResult(result); err == nil {
				t.Fatal("invalid file-level terminal outcome was reported as success")
			}
		})
	}
}

func TestBackupScheduleNormalizationUsesExistingServerRules(t *testing.T) {
	valid := []struct {
		action, every, cron, timezone string
		manual                        bool
		wantType, wantExpression      string
	}{
		{"auto", "", "", "", false, "interval", "6h"},
		{"auto", "1h", "", "", false, "interval", "1h"},
		{"schedule", "24h", "", "", false, "interval", "24h"},
		{"auto", "", "0 2 * * *", "Asia/Tokyo", false, "cron", "0 2 * * *"},
		{"schedule", "", "", "", true, "manual", ""},
	}
	for _, tc := range valid {
		spec, err := parseBackupSchedule(tc.action, tc.every, tc.cron, tc.timezone, tc.manual)
		if err != nil || spec.Type != tc.wantType || spec.Expression != tc.wantExpression {
			t.Fatalf("wrong normalized schedule %+v: %+v %v", tc, spec, err)
		}
	}
	invalid := []struct {
		action, every, cron, timezone string
		manual                        bool
	}{
		{"schedule", "", "", "", false},
		{"auto", "1h", "0 2 * * *", "", false},
		{"auto", "1h", "", "Asia/Tokyo", false},
		{"auto", "", "", "Asia/Tokyo", false},
		{"auto", "0s", "", "", false},
		{"auto", "", "not cron", "Asia/Tokyo", false},
		{"auto", "6h", "", "", true},
	}
	for _, tc := range invalid {
		if _, err := parseBackupSchedule(tc.action, tc.every, tc.cron, tc.timezone, tc.manual); err == nil {
			t.Fatalf("invalid schedule accepted: %+v", tc)
		}
	}
}

func TestBackupCLIUsesOnlySourceIDsAndAgentBinaryOverride(t *testing.T) {
	for _, value := range []string{"", "0", "-2", "abc", "9007199254740992"} {
		if _, err := parseBackupSourceID(value); err == nil {
			t.Fatalf("invalid Source selector accepted: %q", value)
		}
	}
	if got, err := parseBackupSourceID("42"); err != nil || got != 42 {
		t.Fatalf("valid Source selector rejected: %d %v", got, err)
	}
	t.Setenv("XD_AGENT_PATH", "/custom/owning/xdrive-agent")
	candidates := owningAgentCandidates()
	if len(candidates) != 1 || candidates[0] != "/custom/owning/xdrive-agent" {
		t.Fatalf("explicit local agent override ignored: %v", candidates)
	}
}
