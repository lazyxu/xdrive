package api

import (
	"context"
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

func TestSourceRunFailureRetentionKeepsRunSummaries(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "source_failure_retention_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.Source{}, &meta.SourceItem{},
		&meta.SyncRun{}, &meta.SourceRunFailure{},
	); err != nil {
		t.Fatal(err)
	}

	user := meta.User{Username: "retention-user", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	target := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&target).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID: user.ID, Name: "retention-source", Kind: "synology_photos",
		Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusActive,
		Revision: 1, TargetNodeID: &target.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	oldRun := meta.SyncRun{
		ID: uuid.NewString(), SourceID: source.ID, SourceRevision: 1,
		TargetNodeID: &target.ID, Mode: meta.SourceRunModeSync,
		Trigger: meta.SyncRunTriggerManual, Status: meta.SyncRunStatusPartial,
		StartedAt: now.Add(-72 * time.Hour),
	}
	recentRun := meta.SyncRun{
		ID: uuid.NewString(), SourceID: source.ID, SourceRevision: 1,
		TargetNodeID: &target.ID, Mode: meta.SourceRunModeSync,
		Trigger: meta.SyncRunTriggerManual, Status: meta.SyncRunStatusPartial,
		StartedAt: now.Add(-time.Hour),
	}
	if err := db.Create(&[]meta.SyncRun{oldRun, recentRun}).Error; err != nil {
		t.Fatal(err)
	}
	oldItem := meta.SourceItem{
		SourceID: source.ID, ExternalID: "old", Kind: meta.SourceItemKindFile,
		Path: "old.jpg", State: meta.SourceItemStateError, LastSeenRunID: oldRun.ID,
		LastSeenAt: now.Add(-72 * time.Hour), LastError: "old failure",
	}
	recentItem := meta.SourceItem{
		SourceID: source.ID, ExternalID: "recent", Kind: meta.SourceItemKindFile,
		Path: "recent.jpg", State: meta.SourceItemStateError, LastSeenRunID: recentRun.ID,
		LastSeenAt: now.Add(-time.Hour), LastError: "recent failure",
	}
	if err := db.Create(&oldItem).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&recentItem).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&[]meta.SourceRunFailure{
		{RunID: oldRun.ID, SourceID: source.ID, SourceItemID: oldItem.ID, ExternalID: "old", Kind: meta.SourceItemKindFile, Path: "old.jpg", Error: "old failure", FailedAt: now.Add(-72 * time.Hour)},
		{RunID: recentRun.ID, SourceID: source.ID, SourceItemID: recentItem.ID, ExternalID: "recent", Kind: meta.SourceItemKindFile, Path: "recent.jpg", Error: "recent failure", FailedAt: now.Add(-time.Hour)},
	}).Error; err != nil {
		t.Fatal(err)
	}

	server := &Server{DB: db, SourceRunFailureRetention: 24 * time.Hour}
	if err := server.cleanupSourceRunFailureHistory(context.Background()); err != nil {
		t.Fatal(err)
	}

	var failures int64
	if err := db.Model(&meta.SourceRunFailure{}).Count(&failures).Error; err != nil {
		t.Fatal(err)
	}
	if failures != 1 {
		t.Fatalf("failure rows=%d want=1", failures)
	}
	var retained meta.SourceRunFailure
	if err := db.First(&retained).Error; err != nil {
		t.Fatal(err)
	}
	if retained.RunID != recentRun.ID {
		t.Fatalf("retained run=%s want=%s", retained.RunID, recentRun.ID)
	}
	var runs int64
	if err := db.Model(&meta.SyncRun{}).Count(&runs).Error; err != nil {
		t.Fatal(err)
	}
	if runs != 2 {
		t.Fatalf("run summaries=%d want=2", runs)
	}
}
