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
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestPhotoHostRuntimeWorkBlockerNeverReturnsSafeForAbsentDB(t *testing.T) {
	// Model/owner/task data must never leak into the administrator response.
	raw, err := json.Marshal(adminPhotoHostPreflightDTO{RuntimeWorkBlockerState: "blocked"})
	if err != nil || !strings.Contains(string(raw), `"runtime_work_blocker_state":"blocked"`) ||
		strings.Contains(string(raw), "owner_id") || strings.Contains(string(raw), "task_id") ||
		strings.Contains(string(raw), "instance_id") {
		t.Fatal("runtime work identity escaped administrator DTO")
	}
	if got := (&Server{}).photoHostRuntimeWorkBlocker(context.Background()); got != "unverified" {
		t.Fatalf("missing server database reported %q", got)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if got := (&Server{}).photoHostRuntimeWorkBlocker(ctx); got != "unverified" {
		t.Fatalf("canceled runtime read reported %q", got)
	}
}

func TestPhotoHostRuntimeWorkBlockerReadOnlyPostgres(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL not configured")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "photo_host_runtime_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	server := &Server{DB: db}
	// Unavailable/legacy table does NOT attest no jobs.
	if got := server.photoHostRuntimeWorkBlocker(context.Background()); got != "unverified" {
		t.Fatalf("legacy runtime table reported %q", got)
	}
	if err := db.Exec(
		"CREATE TABLE xd_background_runtime_presence (" +
			"kind TEXT NOT NULL, state TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, " +
			"active_count BIGINT NOT NULL DEFAULT 0, queued_count BIGINT NOT NULL DEFAULT 0, " +
			"running_count BIGINT NOT NULL DEFAULT 0)",
	).Error; err != nil {
		t.Fatal(err)
	}
	for _, index := range []string{
		"CREATE INDEX ON xd_background_runtime_presence (expires_at)",
		"CREATE INDEX ON xd_background_runtime_presence (kind)",
		"CREATE INDEX ON xd_background_runtime_presence (state)",
	} {
		if err := db.Exec(index).Error; err != nil {
			t.Fatal(err)
		}
	}

	assert := func(t *testing.T, want string) {
		t.Helper()
		if got := server.photoHostRuntimeWorkBlocker(context.Background()); got != want {
			t.Fatalf("runtime presence = %q, want %q", got, want)
		}
	}
	now := time.Now().UTC()
	insert := func(kind, state string, expires time.Time, active, queued, running int) {
		t.Helper()
		if err := db.Exec(
			"INSERT INTO xd_background_runtime_presence (kind,state,expires_at,active_count,queued_count,running_count) VALUES (?,?,?,?,?,?)",
			kind, state, expires, active, queued, running,
		).Error; err != nil {
			t.Fatal(err)
		}
	}
	clear := func() {
		t.Helper()
		if err := db.Exec("DELETE FROM xd_background_runtime_presence").Error; err != nil {
			t.Fatal(err)
		}
	}
	assert(t, "unverified")
	// Unrelated jobs, stale presence and completed jobs never certify a safe
	// shutdown; they also must not be reported as current ML work.
	insert("sync.folder", "running", now.Add(time.Minute), 1, 0, 1)
	assert(t, "unverified")
	clear()
	insert("photo.face", "running", now.Add(-time.Minute), 1, 0, 1)
	assert(t, "unverified")
	clear()
	insert("photo.face", "completed", now.Add(time.Minute), 0, 0, 0)
	assert(t, "unverified")
	clear()

	for _, tc := range []struct {
		name    string
		kind    string
		state   string
		active  int
		queued  int
		running int
	}{
		{"face-running", "photo.face", "running", 1, 0, 1},
		{"smart-queued", "photo.smart_search", "queued", 1, 1, 0},
		{"semantic-cancelling", "photo.semantic_search", "cancelling", 1, 0, 1},
		{"cluster-count-only", "photo.person_cluster", "unknown", 2, 1, 1},
		{"place-running", "photo.place", "running", 1, 0, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			insert(tc.kind, tc.state, now.Add(time.Minute),
				tc.active, tc.queued, tc.running)
			assert(t, "blocked")
			clear()
			assert(t, "unverified")
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if got := server.photoHostRuntimeWorkBlocker(ctx); got != "unverified" {
		t.Fatalf("canceled runtime presence read = %q", got)
	}
}
