//go:build linux || windows

package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
)

func localPushAutoDueFixture() (client.LocalBoundBackupSchedule, localpush.CommonBatchCheckpoint, time.Time) {
	last := time.Date(2026, 10, 20, 10, 0, 0, 0, time.UTC)
	schedule := client.LocalBoundBackupSchedule{
		SourceID: 42, Revision: 7, ScheduleType: "interval",
		ScheduleExpression: "6h",
	}
	checkpoint := localpush.CommonBatchCheckpoint{
		SourceID: 42, SourceRevision: 7, State: "partial",
		UpdatedAt: last, ConfirmedFiles: 1, InspectedFiles: 1,
	}
	return schedule, checkpoint, last
}

func TestLocalPushAutoOnlyAfterOwnVerifiedPreviousPartial(t *testing.T) {
	spec, cp, last := localPushAutoDueFixture()
	due, err := localPushAutomaticDue(spec, cp, last.Add(5*time.Hour))
	if err != nil || due {
		t.Fatalf("too-early automatic run admitted: due=%t err=%v", due, err)
	}
	due, err = localPushAutomaticDue(spec, cp, last.Add(6*time.Hour))
	if err != nil || !due {
		t.Fatalf("configured six-hour interval was not due: due=%t err=%v", due, err)
	}
	for _, state := range []string{"running", "paused", "cancelled", "uncertain"} {
		t.Run(state, func(t *testing.T) {
			unsafe := cp
			unsafe.State = state
			due, err := localPushAutomaticDue(spec, unsafe, last.Add(48*time.Hour))
			if err != nil || due {
				t.Fatalf("old %s run automatically bypassed original reconciliation: due=%t err=%v", state, due, err)
			}
		})
	}
	unsafe := cp
	unsafe.UncertainFiles = 1
	if due, err := localPushAutomaticDue(spec, unsafe, last.Add(48*time.Hour)); err != nil || due {
		t.Fatalf("unverified SQL receipt automatically re-enqueued: due=%t err=%v", due, err)
	}
	manual := spec
	manual.ScheduleType, manual.ScheduleExpression = "manual", ""
	if due, err := localPushAutomaticDue(manual, cp, last.Add(48*time.Hour)); err != nil || due {
		t.Fatalf("explicit manual mode triggered an automatic run: due=%t err=%v", due, err)
	}
	disabled := spec
	disabled.ScheduleType, disabled.ScheduleExpression = "", ""
	if due, err := localPushAutomaticDue(disabled, cp, last.Add(48*time.Hour)); err != nil || due {
		t.Fatalf("unsaved legacy schedule was silently enabled: due=%t err=%v", due, err)
	}
	wrong := cp
	wrong.SourceRevision++
	if due, err := localPushAutomaticDue(spec, wrong, last.Add(48*time.Hour)); err == nil || due {
		t.Fatalf("old-Source-revision checkpoint armed automatic run: due=%t err=%v", due, err)
	}
	claim := cp
	claim.BackupComplete = true
	if due, err := localPushAutomaticDue(spec, claim, last.Add(48*time.Hour)); err == nil || due {
		t.Fatalf("forged full-backup claim armed automatic run: due=%t err=%v", due, err)
	}
	invalid := spec
	invalid.ScheduleExpression = "0s"
	if due, err := localPushAutomaticDue(invalid, cp, last.Add(48*time.Hour)); err == nil || due {
		t.Fatalf("invalid low-interval schedule ran automatically: due=%t err=%v", due, err)
	}
}

func TestLocalPushAutoCronRespectsIANAZoneAndNeverUsesBrowserTime(t *testing.T) {
	schedule, checkpoint, _ := localPushAutoDueFixture()
	schedule.ScheduleType = "cron"
	schedule.ScheduleExpression = "0 9 * * *"
	schedule.ScheduleTimezone = "Asia/Tokyo"
	checkpoint.UpdatedAt = time.Date(2026, 10, 20, 0, 1, 0, 0, time.UTC) // 09:01 JST
	early := time.Date(2026, 10, 20, 23, 59, 0, 0, time.UTC)
	if due, err := localPushAutomaticDue(schedule, checkpoint, early); err != nil || due {
		t.Fatalf("next-day local-clock cron fired early: due=%t err=%v", due, err)
	}
	due, err := localPushAutomaticDue(schedule, checkpoint, early.Add(time.Minute))
	if err != nil || !due {
		t.Fatalf("next-day 09:00 JST cron never became due: due=%t err=%v", due, err)
	}
}

func TestLocalPushAutoDiscoversOnlyPaginatedOwnerDeviceBackupIDs(t *testing.T) {
	const deviceID = "7a0e3c2c-89a3-428b-841e-afa0f949707e"
	var requests int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet ||
			r.URL.Path != "/api/v1/device-backups/folders" ||
			r.URL.Query().Get("device_id") != deviceID ||
			r.URL.Query().Get("limit") != strconv.Itoa(localPushAutoPageSize) {
			http.Error(w, "unscoped device backup discovery", http.StatusForbidden)
			return
		}
		requests++
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Query().Get("after_source_id") {
		case "":
			_ = json.NewEncoder(w).Encode(client.DeviceBackupFolderPage{
				Folders: []client.DeviceBackupFolder{
					{SourceID: 11, SyncMode: "backup"},
					{SourceID: 12, SyncMode: "mirror"},
				},
				HasMore: true, NextAfterSourceID: 12,
			})
		case "12":
			_ = json.NewEncoder(w).Encode(client.DeviceBackupFolderPage{
				Folders: []client.DeviceBackupFolder{{SourceID: 15, SyncMode: "backup"}},
			})
		default:
			http.Error(w, "incorrect cursor", http.StatusBadRequest)
		}
	}))
	defer srv.Close()
	api := client.New(srv.URL, "synthetic-owner-token")
	ids, err := localPushAutoOwnedFolderIDs(context.Background(), api, deviceID)
	if err != nil || requests != 2 || len(ids) != 2 || ids[0] != 11 || ids[1] != 15 {
		t.Fatalf("auto discovery escaped verified owner device page: ids=%v requests=%d err=%v", ids, requests, err)
	}
}

func TestLocalPushAutoRejectsMalformedOwnerDevicePage(t *testing.T) {
	const deviceID = "7a0e3c2c-89a3-428b-841e-afa0f949707e"
	for _, tc := range []struct {
		name string
		body string
	}{
		{"missing-continuation", `{"folders":[{"source_id":3,"sync_mode":"backup"}],"has_more":true,"next_after_source_id":0}`},
		{"duplicate-source", `{"folders":[{"source_id":3,"sync_mode":"backup"},{"source_id":3,"sync_mode":"backup"}],"has_more":false}`},
		{"zero-source", `{"folders":[{"source_id":0,"sync_mode":"backup"}],"has_more":false}`},
		{"untrusted-mode", `{"folders":[{"source_id":5,"sync_mode":"delete"}],"has_more":false}`},
		{"false-terminal-cursor", `{"folders":[{"source_id":5,"sync_mode":"backup"}],"has_more":false,"next_after_source_id":5}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(strings.TrimSpace(tc.body)))
			}))
			defer srv.Close()
			api := client.New(srv.URL, "synthetic-owner-token")
			if ids, err := localPushAutoOwnedFolderIDs(context.Background(), api, deviceID); err == nil {
				t.Fatalf("invalid device page authorised partial scheduling: %v", ids)
			}
		})
	}
}

func TestLocalPushAutoCooldownTracksCheckpointProgress(t *testing.T) {
	attempt := time.Date(2026, 10, 20, 10, 0, 0, 0, time.UTC)
	if !localPushAutoAdmissionCoolingDown(attempt, attempt.Add(-time.Minute), attempt.Add(2*time.Minute)) {
		t.Fatal("an unchanged checkpoint should throttle a repeated failed admission")
	}
	if localPushAutoAdmissionCoolingDown(attempt, attempt.Add(time.Second), attempt.Add(2*time.Minute)) {
		t.Fatal("a newly verified terminal checkpoint must clear the admission cooldown")
	}
	if localPushAutoAdmissionCoolingDown(attempt, attempt.Add(-time.Minute), attempt.Add(16*time.Minute)) {
		t.Fatal("failure cooldown must expire")
	}
	if localPushAutoAdmissionCoolingDown(time.Time{}, attempt, attempt) {
		t.Fatal("the first eligible attempt must not be throttled")
	}

	schedule, checkpoint, _ := localPushAutoDueFixture()
	schedule.ScheduleExpression = "1m"
	checkpoint.UpdatedAt = attempt.Add(time.Second) // terminal verified attempt after admission
	now := attempt.Add(62 * time.Second)
	due, err := localPushAutomaticDue(schedule, checkpoint, now)
	if err != nil || !due || localPushAutoAdmissionCoolingDown(attempt, checkpoint.UpdatedAt, now) {
		t.Fatalf("valid 1m interval must remain eligible after prior success: due=%t err=%v", due, err)
	}
}

// Multiple 1m Sources must not let the lowest ID monopolize all future ticks.
// Source revision churn must not reset its fairness position, and another
// Owner's attempts must never affect this owning Agent's order.
func TestLocalPushAutoFairOrderAcrossSourcesAndRevisions(t *testing.T) {
	ids := []uint64{4, 9, 11}
	original := append([]uint64(nil), ids...)
	now := time.Date(2026, 10, 24, 4, 0, 0, 0, time.UTC)
	prefix := "https://server.example\x00owner\x00"
	attempts := map[string]time.Time{
		prefix + "4\x007": now,
		prefix + "9\x007": now.Add(-time.Minute),
		"https://server.example\x00other-owner\x0011\x007": now.Add(-time.Hour),
	}
	assertOrder := func(want []uint64) {
		t.Helper()
		got := localPushAutoFairOrder(ids, attempts, "https://server.example", "owner")
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("source fairness: got=%v want=%v", got, want)
		}
		if !reflect.DeepEqual(ids, original) {
			t.Fatalf("owner-scoped Source identifiers mutated: %v", ids)
		}
	}
	assertOrder([]uint64{11, 9, 4})
	// Source 11 gets a turn; 9 is now the oldest attempted source.
	attempts[prefix+"11\x007"] = now.Add(time.Minute)
	assertOrder([]uint64{9, 4, 11})
	// Source 9 changes revision; its last attempt still determines fairness.
	attempts[prefix+"9\x008"] = now.Add(2 * time.Minute)
	assertOrder([]uint64{4, 11, 9})
	// Corrupt or foreign attempts cannot bias current Owner admission.
	attempts[prefix+"not-a-source\x009"] = now.Add(3 * time.Minute)
	attempts[prefix+"4\x00invalid"] = now.Add(4 * time.Minute)
	attempts[prefix+"4\x009\x00junk"] = now.Add(5 * time.Minute)
	assertOrder([]uint64{4, 11, 9})
}
