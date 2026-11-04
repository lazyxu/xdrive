package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
)

type localReadyScheduleFake struct {
	*localScheduleManagerFake
}

func (f *localReadyScheduleFake) CloudLocalBoundBackupSchedule(_ context.Context, id uint64) (
	client.LocalBoundBackupSchedule, error,
) {
	next := time.Date(2026, 11, 4, 6, 0, 0, 0, time.UTC)
	return client.LocalBoundBackupSchedule{
		SourceID: id, Revision: 7, ScheduleType: "interval",
		ScheduleExpression: "6h", AutoReadiness: "checkpoint_ready",
		NextScheduledAt: &next,
	}, nil
}

func TestDesktopIPCExistingScheduleCarriesRedactedAgentRuleTime(t *testing.T) {
	fake := &localReadyScheduleFake{
		localScheduleManagerFake: &localScheduleManagerFake{
			fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1},
		},
	}
	handler := newDesktopIPCHandler(fake, "secret", func() {})
	request := desktopIPCRequest(t, handler, http.MethodGet,
		"/v1/device-backups/local-schedule?source_id=42", "")
	if request.Code != http.StatusOK {
		t.Fatalf("original schedule IPC rejected redacted current rule: HTTP %d %s",
			request.Code, request.Body.String())
	}
	var received client.LocalBoundBackupSchedule
	if err := json.Unmarshal(request.Body.Bytes(), &received); err != nil ||
		received.SourceID != 42 || received.Revision != 7 ||
		received.AutoReadiness != "checkpoint_ready" ||
		received.NextScheduledAt == nil ||
		!received.NextScheduledAt.Equal(time.Date(2026, 11, 4, 6, 0, 0, 0, time.UTC)) {
		t.Fatalf("owning-Agent private due rule lost across authenticated IPC: %+v %v", received, err)
	}
	for _, forbidden := range []string{"root_id", "root_fingerprint", "device_token", "local_path", "session_id", "operation_id"} {
		if strings.Contains(request.Body.String(), forbidden) {
			t.Fatalf("Agent IPC projected private data %q", forbidden)
		}
	}
}
