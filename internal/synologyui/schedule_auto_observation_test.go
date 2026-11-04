package synologyui

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

func TestDSMExistingScheduleCGIRedactsAndForwardsOnlyAgentRuleDue(t *testing.T) {
	g, agent := newFixture(t)
	due := time.Date(2026, 11, 4, 6, 0, 0, 0, time.UTC)
	agent.savedSchedule = localbackupipc.Schedule{
		SourceID: 42, Revision: 7, ScheduleType: "interval",
		ScheduleExpression: "6h",
		AutoReadiness: "checkpoint_ready", NextScheduledAt: &due,
	}
	read := func() *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet,
			"https://nas.example:5001"+DSMCGIPath+"?op=schedule&source_id=42", nil)
		req.Header.Set("Cookie", "id=dsm-session")
		rec := httptest.NewRecorder()
		CGIHandler(g).ServeHTTP(rec, req)
		return rec
	}
	received := read()
	if received.Code != http.StatusOK || agent.runs != 0 || agent.controls != 0 ||
		agent.scheduleWrites != 0 {
		t.Fatalf("CGI read was not a strict current-Owner observation: %d", received.Code)
	}
	var decoded localbackupipc.Schedule
	if err := json.Unmarshal(received.Body.Bytes(), &decoded); err != nil ||
		!localbackupipc.ValidateSchedule(decoded, 42) ||
		decoded.AutoReadiness != "checkpoint_ready" ||
		decoded.NextScheduledAt == nil || !decoded.NextScheduledAt.Equal(due) {
		t.Fatalf("DSM lost the existing Agent schedule wire state: %+v %v", decoded, err)
	}
	for _, forbidden := range []string{
		"device_token", "root_fingerprint", "session_id", "checkpoint",
		"local_path", "operation_id", "full_backup", "private",
	} {
		if strings.Contains(strings.ToLower(received.Body.String()), forbidden) {
			t.Fatalf("DSM schedule exposed private state %q", forbidden)
		}
	}
	// A forged Agent response must not reach the browser as an authenticated
	// plan, and the HTTP error may not leak original details.
	agent.savedSchedule.NextScheduledAt = nil
	invalid := read()
	if invalid.Code == http.StatusOK || strings.Contains(invalid.Body.String(), "checkpoint_ready") {
		t.Fatal("unverified due rule crossed the DSM CGI boundary")
	}
	agent.savedSchedule.NextScheduledAt = &due
	g.Authenticate = func(context.Context) (string, error) { return "foreign-dsm-user", nil }
	denied := read()
	if denied.Code != http.StatusForbidden ||
		strings.Contains(denied.Body.String(), "checkpoint_ready") {
		t.Fatal("foreign DSM principal read private Agent readiness")
	}
}
