package api

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestWorkerHeartbeatState(t *testing.T) {
	now := time.Date(2026, 10, 10, 6, 0, 0, 0, time.UTC)
	cases := []struct {
		name   string
		last   *meta.SourceWorkerPresence
		live   int64
		status string
	}{
		{"no worker ever observed", nil, 0, "unknown"},
		{"fresh one", &meta.SourceWorkerPresence{ExpiresAt: now.Add(time.Second)}, 1, "ready"},
		{"fresh many", &meta.SourceWorkerPresence{ExpiresAt: now.Add(time.Second)}, 3, "ready"},
		{"fresh but none counted", &meta.SourceWorkerPresence{ExpiresAt: now.Add(time.Second)}, 0, "unknown"},
		{"exactly expired", &meta.SourceWorkerPresence{ExpiresAt: now}, 0, "unavailable"},
		{"recent expired", &meta.SourceWorkerPresence{ExpiresAt: now.Add(-time.Minute)}, 0, "unavailable"},
		{"retired worker", &meta.SourceWorkerPresence{ExpiresAt: now.Add(-48 * time.Hour)}, 0, "unknown"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, detail := workerHeartbeatState(now, tc.last, tc.live)
			if got != tc.status || detail == "" {
				t.Fatalf("got %q / %q, want %q", got, detail, tc.status)
			}
		})
	}
}

func TestWorkerPresenceAdminReadPostgres(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.SourceWorkerPresence{}); err != nil {
		t.Fatal(err)
	}
	id := uuid.NewString()
	t.Cleanup(func() { _ = db.Where("instance_id = ?", id).Delete(&meta.SourceWorkerPresence{}).Error })
	now := time.Now().UTC()
	if err := db.Create(&meta.SourceWorkerPresence{
		InstanceID: id, HeartbeatAt: now, ExpiresAt: now.Add(time.Hour),
		ScanIntervalSeconds: 21600, PollIntervalSeconds: 60, MaxConcurrency: 2,
	}).Error; err != nil {
		t.Fatal(err)
	}
	status, detail := (&Server{DB: db}).sourceWorkerServiceStatus(context.Background(), now)
	if status != "ready" || !strings.Contains(detail, "Pull Worker") {
		t.Fatalf("fresh worker lease: %q / %q", status, detail)
	}
	// Only a bare liveness summary is exposed; not a user Source, host or socket.
	if strings.Contains(detail, id) || strings.Contains(detail, dsn) {
		t.Fatalf("worker instance or connection details leaked: %q", detail)
	}
}
