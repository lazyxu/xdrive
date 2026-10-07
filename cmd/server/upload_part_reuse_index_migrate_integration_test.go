package main

import (
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestMigrateInstallsReusedUploadSourceStorageIndex(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}

	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	baseSQL, err := baseDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	baseSQL.SetMaxOpenConns(2)
	baseSQL.SetMaxIdleConns(0)
	t.Cleanup(func() { _ = baseSQL.Close() })

	schema := "migrate_upload_reused_source_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(2)
	sqlDB.SetMaxIdleConns(0)
	t.Cleanup(func() { _ = sqlDB.Close() })

	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}

	type indexRow struct {
		IndexDef string `gorm:"column:indexdef"`
	}
	var rows []indexRow
	if err := db.Raw(`
SELECT indexdef
FROM pg_indexes
WHERE schemaname = current_schema()
  AND tablename = 'xd_upload_parts'
  AND indexname = 'idx_xd_upload_parts_reused_source_storage'
`).Scan(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("reused-source index rows=%d want=1", len(rows))
	}

	definition := strings.ToLower(rows[0].IndexDef)
	for _, fragment := range []string{
		"source_storage_key",
		"where",
		"reused = true",
	} {
		if !strings.Contains(definition, fragment) {
			t.Fatalf("reused-source index definition missing %q: %s", fragment, rows[0].IndexDef)
		}
	}
}
