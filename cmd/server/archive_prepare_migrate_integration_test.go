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

func TestMigrateCreatesArchivePrepareRuns(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "migrate_archive_prepare_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error
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
	if !db.Migrator().HasTable(&meta.ArchivePrepareRun{}) {
		t.Fatal("archive prepare run table was not created")
	}
	if !db.Migrator().HasTable(&meta.DownloadProgress{}) {
		t.Fatal("native download progress table was not created")
	}
	user := meta.User{
		Username:       "archive-prepare-migrate",
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	run := meta.ArchivePrepareRun{
		ID:               uuid.NewString(),
		OwnerID:          user.ID,
		RequestedIDsJSON: "[1]",
		Status:           meta.ArchivePrepareStatusQueued,
		ExpiresAt:        time.Now().UTC().Add(time.Hour),
	}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
}
