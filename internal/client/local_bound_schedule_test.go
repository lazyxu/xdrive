package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/lazyxu/xdrive/internal/sourceschedule"
)

func TestLocalBoundSchedulePrivateReadAndSavedOnlyWrite(t *testing.T) {
	requests := 0
	saved := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("X-XDrive-Device-ID") != "device-A" ||
			r.Header.Get("X-XDrive-Device-Token") != "agent-secret" ||
			r.Header.Get("X-XDrive-Local-Root-ID") != "root-A" ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != "fingerprint-A" {
			t.Error("schedule request omitted native Root or device authorization")
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case http.MethodGet:
			if r.URL.Path != "/api/v1/sources/42/local-schedule" {
				t.Error("private local schedule read borrowed generic Source endpoint")
			}
			if saved {
				_, _ = w.Write([]byte("{\"source_id\":42,\"revision\":8,\"schedule_type\":\"cron\",\"schedule_expression\":\"0 3 * * *\",\"schedule_timezone\":\"Asia/Singapore\"}"))
			} else {
				_, _ = w.Write([]byte("{\"source_id\":42,\"revision\":7,\"schedule_type\":\"manual\",\"schedule_expression\":\"\",\"schedule_timezone\":\"\"}"))
			}
		case http.MethodPatch:
			if r.URL.Path != "/api/v1/sources/42" || r.Header.Get("If-Match") != "\"7\"" {
				t.Error("local schedule write missing revision")
			}
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil ||
				len(body) != 3 || body["schedule_type"] != "cron" ||
				body["schedule_expression"] != "0 3 * * *" ||
				body["schedule_timezone"] != "Asia/Singapore" {
				t.Errorf("local schedule PATCH sent unrelated Source fields: %+v err=%v", body, err)
			}
			saved = true
			// Generic Source responses remain schedule-redacted.
			_, _ = w.Write([]byte("{\"id\":42,\"revision\":8,\"kind\":\"local_folder\",\"direction\":\"push\",\"status\":\"paused\"}"))
		default:
			t.Errorf("unexpected private schedule HTTP method: %s", r.Method)
		}
	}))
	defer server.Close()

	cli := New(server.URL, "owner")
	proof := LocalBoundSourceProof{
		DeviceID: "device-A", DeviceToken: "agent-secret",
		RootID: "root-A", RootFingerprint: "fingerprint-A",
	}
	if _, err := cli.LocalBoundSchedule(context.Background(), 0, proof); err == nil || requests != 0 {
		t.Fatalf("zero Source ID dispatched read: err=%v count=%d", err, requests)
	}
	initial, err := cli.LocalBoundSchedule(context.Background(), 42, proof)
	if err != nil || initial.SourceID != 42 || initial.Revision != 7 || initial.ScheduleType != "manual" {
		t.Fatalf("private local schedule read failed: %+v err=%v", initial, err)
	}
	for _, invalid := range []sourceschedule.Spec{
		{Type: "interval", Expression: "30s"},
		{Type: "cron", Expression: "0 3 * *"},
		{Type: "cron", Expression: "0 3 * * *", Timezone: "Bad/Zone"},
		{Type: ""},
	} {
		if _, err := cli.SetLocalBoundSchedule(context.Background(), 42, 7, invalid, proof); err == nil {
			t.Fatalf("invalid saved schedule accepted: %+v", invalid)
		}
	}
	if _, err := cli.SetLocalBoundSchedule(context.Background(), 42, 0, sourceschedule.Spec{Type: "manual"}, proof); err == nil ||
		requests != 1 {
		t.Fatalf("invalid revision reached Server: err=%v count=%d", err, requests)
	}
	out, err := cli.SetLocalBoundSchedule(context.Background(), 42, 7, sourceschedule.Spec{
		Type: "cron", Expression: "0 3 * * *", Timezone: "Asia/Singapore",
	}, proof)
	if err != nil || !saved || requests != 3 || out.SourceID != 42 || out.Revision != 8 ||
		out.ScheduleType != "cron" || out.ScheduleTimezone != "Asia/Singapore" {
		t.Fatalf("saved-only private schedule failed: %+v err=%v requests=%d", out, err, requests)
	}
}
