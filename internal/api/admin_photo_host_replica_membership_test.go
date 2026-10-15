package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestPhotoHostReplicaMembershipFailsClosedWithoutBackend(t *testing.T) {
	if got := (&Server{}).photoHostReplicaMembershipBlocker(context.Background()); got != "unverified" {
		t.Fatalf("missing DB returned %q", got)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if got := (&Server{}).photoHostReplicaMembershipBlocker(ctx); got != "unverified" {
		t.Fatalf("canceled DB returned %q", got)
	}
	b, err := json.Marshal(adminPhotoHostPreflightDTO{ReplicaMembershipState: "blocked"})
	if err != nil || !strings.Contains(string(b), `"replica_membership_blocker_state":"blocked"`) ||
		strings.Contains(string(b), "instance_id") ||
		strings.Contains(string(b), "owner_id") ||
		strings.Contains(string(b), "heartbeat_at") {
		t.Fatalf("replica identity escaped sanitized preflight: %s, %v", b, err)
	}
}

func TestPhotoHostReplicaMembershipPostgresConservative(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL not configured")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "photo_host_membership_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{DB: db}
	assert := func(t *testing.T, expected string) {
		t.Helper()
		if got := s.photoHostReplicaMembershipBlocker(context.Background()); got != expected {
			t.Fatalf("member heartbeat blocker = %q, expected %q", got, expected)
		}
	}
	// Old deployment without the new migration MUST NOT imply safety.
	assert(t, "unverified")
	if err := db.AutoMigrate(&meta.PhotoHostReplicaPresence{}); err != nil {
		t.Fatal(err)
	}
	assert(t, "unverified") // Empty roster is not full coverage.
	now := time.Now().UTC().Truncate(time.Microsecond)
	id := "opaque-runtime-" + uuid.NewString()
	fresh := meta.PhotoHostReplicaPresence{
		InstanceID: id, StartedAt: now.Add(-time.Minute),
		HeartbeatAt: now, ExpiresAt: now.Add(photoHostReplicaPresenceTTL),
	}
	if err := publishPhotoHostReplicaPresence(context.Background(), db, fresh); err != nil {
		t.Fatal(err)
	}
	assert(t, "unverified") // Even one live Server cannot attest the whole fleet.

	// Heartbeat refresh must not rewrite the session's original start time.
	repeated := fresh
	repeated.StartedAt = now.Add(time.Hour)
	repeated.HeartbeatAt = now.Add(time.Second)
	repeated.ExpiresAt = now.Add(photoHostReplicaPresenceTTL + time.Second)
	if err := publishPhotoHostReplicaPresence(context.Background(), db, repeated); err != nil {
		t.Fatal(err)
	}
	var saved meta.PhotoHostReplicaPresence
	if err := db.Where("instance_id = ?", id).Take(&saved).Error; err != nil {
		t.Fatal(err)
	}
	if !saved.StartedAt.Equal(fresh.StartedAt) ||
		!saved.HeartbeatAt.Equal(repeated.HeartbeatAt) {
		t.Fatalf("unexpected immutable session/heartbeat: %+v", saved)
	}
	var total int64
	if err := db.Model(&meta.PhotoHostReplicaPresence{}).Count(&total).Error; err != nil || total != 1 {
		t.Fatalf("one row per process session expected: %d %v", total, err)
	}

	// A vanished previously observed Server is an actual NEGATIVE signal.
	stale := fresh
	stale.InstanceID = "vanished-" + uuid.NewString()
	stale.ExpiresAt = now.Add(-time.Second)
	if err := publishPhotoHostReplicaPresence(context.Background(), db, stale); err != nil {
		t.Fatal(err)
	}
	assert(t, "blocked")
	// If a vanished Server comes back, that observation is no longer a veto.
	stale.HeartbeatAt = now
	stale.ExpiresAt = now.Add(photoHostReplicaPresenceTTL)
	if err := publishPhotoHostReplicaPresence(context.Background(), db, stale); err != nil {
		t.Fatal(err)
	}
	assert(t, "unverified")
	// A bounded record from a very old deployment is no current veto, but
	// its absence can NEVER become positive "safe to stop" evidence.
	old := stale
	old.InstanceID = "pruned-" + uuid.NewString()
	old.HeartbeatAt = now.Add(-photoHostReplicaRetention - time.Hour)
	old.ExpiresAt = now.Add(-time.Hour)
	if err := publishPhotoHostReplicaPresence(context.Background(), db, old); err != nil {
		t.Fatal(err)
	}
	assert(t, "unverified")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if got := s.photoHostReplicaMembershipBlocker(ctx); got != "unverified" {
		t.Fatalf("canceled DB returned %q", got)
	}
	if err := db.Migrator().DropTable(&meta.PhotoHostReplicaPresence{}); err != nil {
		t.Fatal(err)
	}
	assert(t, "unverified")
}
