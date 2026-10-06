package main

import (
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

func TestMigrateCreatesBackgroundRuntimePresence(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "migrate_runtime_presence_" +
		strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(
		fmt.Sprintf(`CREATE SCHEMA "%s"`, schema),
	).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = baseDB.Exec(
			fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema),
		).Error
	})

	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := u.Query()
	query.Set("search_path", schema)
	u.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	if !db.Migrator().HasTable(&meta.BackgroundRuntimePresence{}) {
		t.Fatal("background runtime presence table was not created")
	}

	now := time.Now().UTC()
	row := meta.BackgroundRuntimePresence{
		InstanceID:    "server-a",
		TaskID:        "runtime:user:42:media.thumbnail",
		Kind:          "media.thumbnail",
		Scope:         "user",
		OwnerID:       42,
		State:         "running",
		Trigger:       "system_event",
		Initiator:     "system",
		Priority:      0,
		Resource:      "media_cpu",
		ActiveCount:   1,
		RunningCount:  1,
		TaskUpdatedAt: now,
		ExpiresAt:     now.Add(time.Second),
	}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	duplicate := row
	if err := db.Create(&duplicate).Error; err == nil {
		t.Fatal("duplicate instance/task runtime presence was accepted")
	}
}
