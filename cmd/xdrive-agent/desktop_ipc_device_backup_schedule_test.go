package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/sourceschedule"
)

type localScheduleManagerFake struct {
	*fakeDesktopIPCController
	sourceID uint64
	revision uint64
	spec     sourceschedule.Spec
}

func (f *localScheduleManagerFake) CloudLocalBoundBackupSchedule(_ context.Context, sourceID uint64) (client.LocalBoundBackupSchedule, error) {
	f.sourceID = sourceID
	return client.LocalBoundBackupSchedule{
		SourceID: sourceID, Revision: 7, ScheduleType: "manual",
	}, nil
}

func (f *localScheduleManagerFake) CloudSetLocalBoundBackupSchedule(_ context.Context, sourceID, revision uint64, spec sourceschedule.Spec) (client.LocalBoundBackupSchedule, error) {
	f.sourceID, f.revision, f.spec = sourceID, revision, spec
	return client.LocalBoundBackupSchedule{
		SourceID: sourceID, Revision: revision + 1,
		ScheduleType: spec.Type, ScheduleExpression: spec.Expression, ScheduleTimezone: spec.Timezone,
	}, nil
}

func TestDesktopIPCLocalSchedulePrivateReadAndSavedOnlyUpdate(t *testing.T) {
	f := &localScheduleManagerFake{fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1}}
	h := newDesktopIPCHandler(f, "secret", func() {})
	good := desktopIPCRequest(t, h, http.MethodGet, "/v1/device-backups/local-schedule?source_id=42", "")
	if good.Code != http.StatusOK || f.sourceID != 42 ||
		good.Header().Get("Cache-Control") != "private, no-store" ||
		!strings.Contains(good.Body.String(), "\"schedule_type\":\"manual\"") {
		t.Fatalf("private schedule read failed: %d %s", good.Code, good.Body.String())
	}
	for _, secret := range []string{"root_id", "device_token", "root_fingerprint", "local_path", "ignore_rules", "checkpoint"} {
		if strings.Contains(good.Body.String(), secret) {
			t.Fatalf("private schedule DTO leaked %s", secret)
		}
	}
	for _, bad := range []string{"/v1/device-backups/local-schedule", "/v1/device-backups/local-schedule?source_id=0"} {
		if got := desktopIPCRequest(t, h, http.MethodGet, bad, ""); got.Code != http.StatusBadRequest {
			t.Fatalf("invalid schedule read accepted: %s status=%d", bad, got.Code)
		}
	}

	valid := "{\"source_id\":42,\"revision\":7,\"schedule_type\":\"cron\",\"schedule_expression\":\"0 3 * * *\",\"schedule_timezone\":\"UTC\"}"
	update := desktopIPCRequest(t, h, http.MethodPatch, "/v1/device-backups/local-schedule", valid)
	if update.Code != http.StatusOK || f.sourceID != 42 || f.revision != 7 ||
		f.spec.Type != "cron" || f.spec.Expression != "0 3 * * *" || f.spec.Timezone != "UTC" {
		t.Fatalf("own Agent saved schedule failed: %d %s", update.Code, update.Body.String())
	}
	if update.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatal("saved schedule must not be cached")
	}
	for _, bad := range []string{
		"{\"source_id\":0,\"revision\":7,\"schedule_type\":\"manual\",\"schedule_expression\":\"\",\"schedule_timezone\":\"\"}",
		"{\"source_id\":42,\"revision\":0,\"schedule_type\":\"manual\",\"schedule_expression\":\"\",\"schedule_timezone\":\"\"}",
		"{\"source_id\":42,\"revision\":7,\"schedule_type\":\"cron\",\"schedule_expression\":\"0 3 * *\",\"schedule_timezone\":\"UTC\"}",
		"{\"source_id\":42,\"revision\":7,\"schedule_type\":\"cron\",\"schedule_expression\":\"0 3 * * *\",\"schedule_timezone\":\"Invalid/Zone\"}",
		"{\"source_id\":42,\"revision\":7,\"schedule_type\":\"interval\",\"schedule_expression\":\"10s\",\"schedule_timezone\":\"\"}",
		"{\"source_id\":42,\"revision\":7,\"schedule_type\":\"manual\",\"schedule_expression\":\"\",\"schedule_timezone\":\"\",\"device_id\":\"spoofed\"}",
		"{\"source_id\":42,\"revision\":7,\"schedule_type\":\"manual\",\"schedule_expression\":\"\",\"schedule_timezone\":\"\",\"root_id\":\"spoofed\"}",
	} {
		got := desktopIPCRequest(t, h, http.MethodPatch, "/v1/device-backups/local-schedule", bad)
		if got.Code != http.StatusBadRequest {
			t.Fatalf("invalid private schedule accepted: %.85s, status=%d", bad, got.Code)
		}
	}
	anon := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/v1/device-backups/local-schedule?source_id=42", nil)
	anon.RemoteAddr = "127.0.0.1:43210"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, anon)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous local schedule read accepted: %d", rec.Code)
	}
}

func TestDesktopIPCLocalScheduleNoGenericSourceFallback(t *testing.T) {
	h := newDesktopIPCHandler(&fakeDesktopIPCController{revision: 1}, "secret", func() {})
	for _, tc := range []struct {
		method, path, body string
	}{
		{http.MethodGet, "/v1/device-backups/local-schedule?source_id=42", ""},
		{http.MethodPatch, "/v1/device-backups/local-schedule", "{\"source_id\":42,\"revision\":7,\"schedule_type\":\"manual\",\"schedule_expression\":\"\",\"schedule_timezone\":\"\"}"},
	} {
		got := desktopIPCRequest(t, h, tc.method, tc.path, tc.body)
		if got.Code != http.StatusNotImplemented {
			t.Fatalf("generic Source fallback allowed %s: %d", tc.method, got.Code)
		}
	}
}
