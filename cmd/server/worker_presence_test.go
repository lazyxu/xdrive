package main

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestPublishSourceWorkerPresencePostgres(t *testing.T) {
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
	now := time.Now().UTC().Truncate(time.Second)
	cfg := sourceWorkerPresenceConfig{scanInterval: 6 * time.Hour, pollInterval: time.Minute, maxConcurrency: 2}
	if err := publishSourceWorkerPresence(context.Background(), db, id, cfg, now); err != nil {
		t.Fatal(err)
	}
	cfg.pollInterval = 30 * time.Second
	cfg.maxConcurrency = 4
	if err := publishSourceWorkerPresence(context.Background(), db, id, cfg, now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	var presence meta.SourceWorkerPresence
	if err := db.Where("instance_id = ?", id).Take(&presence).Error; err != nil {
		t.Fatal(err)
	}
	if presence.ScanIntervalSeconds != 21600 || presence.PollIntervalSeconds != 30 || presence.MaxConcurrency != 4 ||
		!presence.HeartbeatAt.Equal(now.Add(time.Second)) ||
		!presence.ExpiresAt.Equal(now.Add(time.Second).Add(sourceWorkerPresenceTTL)) {
		t.Fatalf("upserted lease does not reflect effective Worker settings: %+v", presence)
	}
	var count int64
	if err := db.Model(&meta.SourceWorkerPresence{}).Where("instance_id = ?", id).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("expected one upserted Worker lease, got %d", count)
	}
}
