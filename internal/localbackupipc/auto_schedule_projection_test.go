package localbackupipc

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestAgentScheduleReadinessWireIsOptionalBoundedAndNeverAuthorizesWrites(t *testing.T) {
	const sourceID = uint64(42)
	due := time.Date(2026, 11, 4, 6, 0, 0, 0, time.UTC)
	base := Schedule{
		SourceID: sourceID, Revision: 7,
		ScheduleType: "interval", ScheduleExpression: "6h",
	}
	// Original Desktop, xd and older Agent peers remain source-compatible.
	if !ValidateSchedule(base, sourceID) {
		t.Fatal("legacy owning-Agent schedule was rejected")
	}
	ready := base
	ready.AutoReadiness = "checkpoint_ready"
	ready.NextScheduledAt = &due
	if !ValidateSchedule(ready, sourceID) || ValidateSchedule(ready, 43) {
		t.Fatal("current Owner's bounded private scheduled due failed wire validation")
	}
	data, err := json.Marshal(ready)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) == "" || !strings.Contains(string(data), `"auto_readiness":`) ||
		!strings.Contains(string(data), `"next_scheduled_at":`) {
		t.Fatal("verified Agent readiness did not survive private IPC encoding")
	}
	var back Schedule
	if err := json.Unmarshal(data, &back); err != nil || !ValidateSchedule(back, sourceID) ||
		back.NextScheduledAt == nil || !back.NextScheduledAt.Equal(due) {
		t.Fatalf("private Agent schedule roundtrip lost due metadata: %+v %v", back, err)
	}
	for _, tc := range []struct {
		name string
		edit func(*Schedule)
	}{
		{"wrong_source", func(s *Schedule) { s.SourceID++ }},
		{"unknown_readiness", func(s *Schedule) { s.AutoReadiness = "full_backup_complete" }},
		{"ready_without_rule_due", func(s *Schedule) { s.NextScheduledAt = nil }},
		{"zero_rule_due", func(s *Schedule) { value := time.Time{}; s.NextScheduledAt = &value }},
		{"not_ready_with_due", func(s *Schedule) { s.AutoReadiness = "review_required" }},
		{"manual_with_ready", func(s *Schedule) { s.ScheduleType = "manual" }},
		{"unconfigured_with_ready", func(s *Schedule) { s.ScheduleType = "" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			bad := ready
			tc.edit(&bad)
			if ValidateSchedule(bad, sourceID) {
				t.Fatalf("forged DSM schedule readiness accepted: %+v", bad)
			}
		})
	}
	for _, code := range []string{
		"not_enabled", "manual", "ineligible_source", "checkpoint_unverified",
		"review_required", "unavailable",
	} {
		status := base
		status.AutoReadiness = code
		status.NextScheduledAt = nil
		switch code {
		case "not_enabled":
			status.ScheduleType, status.ScheduleExpression = "", ""
		case "manual":
			status.ScheduleType, status.ScheduleExpression = "manual", ""
		}
		if !ValidateSchedule(status, sourceID) {
			t.Fatalf("valid non-ready Agent status rejected: %q", code)
		}
	}
}
