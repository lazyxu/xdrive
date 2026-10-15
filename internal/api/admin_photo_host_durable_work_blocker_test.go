package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestPhotoHostDurableWorkBlockerFailsClosedWithoutDatabase(t *testing.T) {
	// The administrator receives only a categorical veto, not identifiers,
	// owner paths, task bytes, raw database status or activity counts.
	raw, err := json.Marshal(adminPhotoHostPreflightDTO{DurableWorkBlockerState: "blocked"})
	if err != nil || !strings.Contains(string(raw), `"durable_work_blocker_state":"blocked"`) ||
		strings.Contains(string(raw), "owner_id") || strings.Contains(string(raw), "task_id") {
		t.Fatal("private durable photo work leaked through public preflight")
	}
	if got := (&Server{}).photoHostDurableWorkBlocker(context.Background()); got != "unverified" {
		t.Fatalf("missing database claims durable drain state: %q", got)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if got := (&Server{}).photoHostDurableWorkBlocker(ctx); got != "unverified" {
		t.Fatalf("canceled observation claims durable drain state: %q", got)
	}
}

func TestPhotoHostDurableWorkBlockerPostgresNegativeOnly(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL not configured")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "photo_host_drain_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		"CREATE TABLE xd_photo_analysis_states (id BIGINT PRIMARY KEY, state VARCHAR(16) NOT NULL)",
		"CREATE TABLE xd_photo_person_cluster_states (owner_id BIGINT PRIMARY KEY, state VARCHAR(16) NOT NULL)",
		"CREATE TABLE xd_photo_creative_generations (id TEXT PRIMARY KEY, state VARCHAR(16) NOT NULL)",
		"CREATE INDEX ON xd_photo_analysis_states (state)",
		"CREATE INDEX ON xd_photo_person_cluster_states (state)",
		"CREATE INDEX ON xd_photo_creative_generations (state)",
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatal(err)
		}
	}
	server := &Server{DB: db}
	assert := func(t *testing.T, want string) {
		t.Helper()
		got := server.photoHostDurableWorkBlocker(context.Background())
		if got != want {
			t.Fatalf("durable-work negative observation = %q, want %q", got, want)
		}
	}
	// Zero rows is NOT fleet idle, ever.
	assert(t, "unverified")
	tests := []struct {
		name   string
		insert string
	}{
		{
			name:   "running-analysis",
			insert: "INSERT INTO xd_photo_analysis_states (id,state) VALUES (1,'running')",
		},
		{
			name:   "running-person-cluster",
			insert: "INSERT INTO xd_photo_person_cluster_states (owner_id,state) VALUES (1,'running')",
		},
		{
			name:   "queued-creative",
			insert: "INSERT INTO xd_photo_creative_generations (id,state) VALUES ('first','queued')",
		},
		{
			name:   "running-creative",
			insert: "INSERT INTO xd_photo_creative_generations (id,state) VALUES ('second','running')",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if err := db.Exec(tc.insert).Error; err != nil {
				t.Fatal(err)
			}
			assert(t, "blocked")
			for _, table := range []string{
				"xd_photo_analysis_states",
				"xd_photo_person_cluster_states",
				"xd_photo_creative_generations",
			} {
				if err := db.Exec("DELETE FROM " + table).Error; err != nil {
					t.Fatal(err)
				}
			}
			assert(t, "unverified")
		})
	}
	if err := db.Exec("INSERT INTO xd_photo_analysis_states (id,state) VALUES (2,'ready')").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO xd_photo_creative_generations (id,state) VALUES ('completed','completed')").Error; err != nil {
		t.Fatal(err)
	}
	assert(t, "unverified")

	// A missing old table is unknown, never a positive drain certificate.
	if err := db.Exec("DROP TABLE xd_photo_creative_generations").Error; err != nil {
		t.Fatal(err)
	}
	assert(t, "unverified")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if got := server.photoHostDurableWorkBlocker(ctx); got != "unverified" {
		t.Fatalf("canceled DB probe reported %q", got)
	}
}
