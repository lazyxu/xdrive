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

func TestMigrateInstallsFileExplorerTypeSortIndex(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}

	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "migrate_fileexplorer_type_sort_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error
	}()

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

	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	// Migration must remain idempotent because every Server start runs migrate.
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
  AND tablename = 'xd_nodes'
  AND indexname = 'idx_xd_nodes_children_type'
`).Scan(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("type-sort index rows=%d want=1", len(rows))
	}

	definition := strings.ToLower(rows[0].IndexDef)
	for _, fragment := range []string{
		"owner_id",
		"parent_id",
		"case",
		"strpos",
		"regexp_replace",
		"lower",
		"deleted_at is null",
	} {
		if !strings.Contains(definition, fragment) {
			t.Fatalf("type-sort index definition missing %q: %s", fragment, rows[0].IndexDef)
		}
	}
}
