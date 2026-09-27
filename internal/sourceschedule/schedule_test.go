package sourceschedule

import (
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestNormalizeSchedules(t *testing.T) {
	if got, err := Normalize("interval", "6h", "ignored"); err != nil || got != (Spec{Type: TypeInterval, Expression: "6h"}) {
		t.Fatalf("interval spec=%+v err=%v", got, err)
	}
	if got, err := Normalize("cron", "0 3 * * *", "Asia/Shanghai"); err != nil ||
		got != (Spec{Type: TypeCron, Expression: "0 3 * * *", Timezone: "Asia/Shanghai"}) {
		t.Fatalf("cron spec=%+v err=%v", got, err)
	}
	for _, tc := range []Spec{
		{Type: TypeInterval, Expression: "30s"},
		{Type: TypeInterval, Expression: "bad"},
		{Type: TypeCron, Expression: "0 3 * *", Timezone: "UTC"},
		{Type: TypeCron, Expression: "0 3 * * *", Timezone: "Mars/Olympus"},
	} {
		if _, err := Normalize(tc.Type, tc.Expression, tc.Timezone); err == nil {
			t.Fatalf("invalid schedule accepted: %+v", tc)
		}
	}
}

func TestDueIntervalAndManualOverride(t *testing.T) {
	now := time.Date(2026, 9, 27, 12, 0, 0, 0, time.UTC)
	last := now.Add(-5 * time.Hour)
	source := meta.Source{ScheduleType: TypeInterval, ScheduleExpression: "6h", LastRunAt: &last}
	if due, err := Due(source, now, DefaultInterval); err != nil || due {
		t.Fatalf("5h source due=%v err=%v", due, err)
	}
	last = now.Add(-6 * time.Hour)
	source.LastRunAt = &last
	if due, err := Due(source, now, DefaultInterval); err != nil || !due {
		t.Fatalf("6h source due=%v err=%v", due, err)
	}
	manual := now.Add(-time.Minute)
	source.LastRunAt = &now
	source.RunRequestedAt = &manual
	if due, err := Due(source, now, DefaultInterval); err != nil || !due {
		t.Fatalf("manual source due=%v err=%v", due, err)
	}
}

func TestDueCronUsesTimezoneAndDSTSafeSchedule(t *testing.T) {
	last := time.Date(2026, 9, 26, 19, 30, 0, 0, time.UTC) // 03:30 next day in Shanghai
	source := meta.Source{
		ScheduleType: TypeCron, ScheduleExpression: "0 3 * * *", ScheduleTimezone: "Asia/Shanghai",
		LastRunAt: &last,
	}
	before := time.Date(2026, 9, 27, 18, 59, 59, 0, time.UTC)
	if due, err := Due(source, before, DefaultInterval); err != nil || due {
		t.Fatalf("cron source early due=%v err=%v", due, err)
	}
	at := time.Date(2026, 9, 27, 19, 0, 0, 0, time.UTC)
	if due, err := Due(source, at, DefaultInterval); err != nil || !due {
		t.Fatalf("cron source at schedule due=%v err=%v", due, err)
	}
}

func TestLegacyScheduleUsesFallback(t *testing.T) {
	now := time.Date(2026, 9, 27, 12, 0, 0, 0, time.UTC)
	last := now.Add(-2 * time.Hour)
	source := meta.Source{LastRunAt: &last}
	if due, err := Due(source, now, 90*time.Minute); err != nil || !due {
		t.Fatalf("legacy source due=%v err=%v", due, err)
	}
}
