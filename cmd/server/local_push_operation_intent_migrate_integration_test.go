package main

import (
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestMigratePrivateLocalPushOperationIntentsRemainEmpty(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL required")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "migrate_local_op_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error })
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := parsed.Query()
	q.Set("search_path", schema)
	parsed.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := migrate(db); err != nil {
			t.Fatal(err)
		}
		if !db.Migrator().HasTable(&meta.LocalPushOperationIntent{}) {
			t.Fatal("private operation intent table missing")
		}
		if !db.Migrator().HasTable(&meta.LocalPushOperationTerminalReceipt{}) ||
			!db.Migrator().HasIndex(&meta.LocalPushOperationTerminalReceipt{}, "idx_xd_local_push_terminal_generation") {
			t.Fatal("private immutable operation terminal receipt schema missing")
		}
		if !db.Migrator().HasTable(&meta.LocalPushOperationStageBinding{}) ||
			!db.Migrator().HasIndex(&meta.LocalPushOperationStageBinding{}, "idx_xd_local_push_stage_generation") ||
			!db.Migrator().HasIndex(&meta.LocalPushOperationStageBinding{}, "idx_xd_local_push_stage_operation") {
			t.Fatal("private Stage/Operation immutable indexes missing")
		}
		var stageBindingCount int64
		if err := db.Model(&meta.LocalPushOperationStageBinding{}).
			Count(&stageBindingCount).Error; err != nil || stageBindingCount != 0 {
			t.Fatalf("migration created unauthorized Stage binding: %d %v", stageBindingCount, err)
		}
		if !db.Migrator().HasTable(&meta.LocalPushFirstLeafOperationCommit{}) ||
			!db.Migrator().HasIndex(&meta.LocalPushFirstLeafOperationCommit{}, "idx_xd_local_push_first_leaf_commit_stage") ||
			!db.Migrator().HasIndex(&meta.LocalPushFirstLeafOperationCommit{}, "idx_xd_local_push_first_leaf_commit_generation") {
			t.Fatal("private first-leaf operation SQL commit indexes missing")
		}
		var commitCount int64
		if err := db.Model(&meta.LocalPushFirstLeafOperationCommit{}).
			Count(&commitCount).Error; err != nil || commitCount != 0 {
			t.Fatalf("migration invented a device backup SQL commit: %d %v", commitCount, err)
		}
		var terminalCount int64
		if err := db.Model(&meta.LocalPushOperationTerminalReceipt{}).Count(&terminalCount).Error; err != nil || terminalCount != 0 {
			t.Fatalf("migration invented terminal backup evidence: count=%d err=%v", terminalCount, err)
		}
		var count int64
		if err := db.Model(&meta.LocalPushOperationIntent{}).Count(&count).Error; err != nil || count != 0 {
			t.Fatalf("migration auto-activated a local backup: count=%d err=%v", count, err)
		}
	}
}
