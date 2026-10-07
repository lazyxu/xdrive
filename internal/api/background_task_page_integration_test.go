package api

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestBackgroundTaskPageKeepsActiveWorkAheadOfHistory(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(6)
	sqlDB.SetMaxIdleConns(2)
	t.Cleanup(func() { _ = sqlDB.Close() })

	if err := resetMediaDerivativeTestSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.Source{},
		&meta.SyncRun{},
		&meta.FileOperation{},
		&meta.BackgroundRuntimePresence{},
		&meta.BackgroundOwnerCancellation{},
		&meta.PhotoIntelligenceReanalyzeIntent{},
		&meta.SystemMaintenanceRun{},
	); err != nil {
		t.Fatal(err)
	}

	user := meta.User{
		Username:       "background-page-user",
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID:   user.ID,
		Name:      "Page Source",
		Kind:      "yike_photos",
		Direction: meta.SourceDirectionPull,
		SyncMode:  meta.SourceSyncModeBackup,
		RunMode:   meta.SourceRunModeSync,
		Status:    meta.SourceStatusActive,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC().Truncate(time.Microsecond)
	active := meta.SyncRun{
		ID:        "00000000-0000-0000-0000-000000000001",
		SourceID:  source.ID,
		Trigger:   meta.SyncRunTriggerScheduled,
		Status:    meta.SyncRunStatusRunning,
		StartedAt: now.Add(-24 * time.Hour),
		CreatedAt: now.Add(-24 * time.Hour),
		UpdatedAt: now.Add(-24 * time.Hour),
	}
	if err := db.Create(&active).Error; err != nil {
		t.Fatal(err)
	}

	for index, age := range []time.Duration{
		time.Minute,
		2 * time.Minute,
		3 * time.Minute,
	} {
		run := meta.SyncRun{
			ID: []string{
				"00000000-0000-0000-0000-000000000101",
				"00000000-0000-0000-0000-000000000102",
				"00000000-0000-0000-0000-000000000103",
			}[index],
			SourceID:   source.ID,
			Trigger:    meta.SyncRunTriggerScheduled,
			Status:     meta.SyncRunStatusCompleted,
			StartedAt:  now.Add(-age - time.Second),
			FinishedAt: backgroundTaskPageTimePtr(now.Add(-age)),
			CreatedAt:  now.Add(-age - time.Second),
			UpdatedAt:  now.Add(-age),
		}
		if err := db.Create(&run).Error; err != nil {
			t.Fatal(err)
		}
	}

	server := &Server{DB: db}
	ownerID := user.ID
	first, err := server.backgroundTaskPage(
		context.Background(),
		&ownerID,
		user.ID,
		false,
		2,
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if backgroundTaskByID(
		first.CurrentItems,
		"sync-run:"+active.ID,
	) == nil {
		t.Fatalf("active run missing from current_items: %+v", first)
	}
	if len(first.HistoryItems) != 2 || first.NextCursor == "" {
		t.Fatalf("first history page=%+v want 2 items + cursor", first)
	}

	cursor, err := decodeBackgroundTaskHistoryCursor(first.NextCursor)
	if err != nil {
		t.Fatal(err)
	}
	second, err := server.backgroundTaskPage(
		context.Background(),
		&ownerID,
		user.ID,
		false,
		2,
		cursor,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.CurrentItems) != 0 {
		t.Fatalf("cursor page unexpectedly repeated current items: %+v", second.CurrentItems)
	}
	if len(second.HistoryItems) != 1 || second.NextCursor != "" {
		t.Fatalf("second history page=%+v want final single item", second)
	}

	seen := map[string]bool{}
	for _, task := range append(
		append([]backgroundTaskDTO{}, first.HistoryItems...),
		second.HistoryItems...,
	) {
		if seen[task.ID] {
			t.Fatalf("history task repeated across cursor pages: %s", task.ID)
		}
		seen[task.ID] = true
	}
	if len(seen) != 3 {
		t.Fatalf("history ids=%v want 3 terminal SyncRuns", seen)
	}
}

func TestBackgroundTaskAdminHistoryCursorStableAcrossDomains(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(6)
	sqlDB.SetMaxIdleConns(2)
	t.Cleanup(func() { _ = sqlDB.Close() })

	if err := resetMediaDerivativeTestSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.Source{},
		&meta.SyncRun{},
		&meta.FileOperation{},
		&meta.BackgroundRuntimePresence{},
		&meta.BackgroundOwnerCancellation{},
		&meta.PhotoIntelligenceReanalyzeIntent{},
		&meta.SystemMaintenanceRun{},
	); err != nil {
		t.Fatal(err)
	}

	user := meta.User{
		Username:       "background-page-admin-owner",
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID:   user.ID,
		Name:      "Cursor Source",
		Kind:      "yike_photos",
		Direction: meta.SourceDirectionPull,
		SyncMode:  meta.SourceSyncModeBackup,
		RunMode:   meta.SourceRunModeSync,
		Status:    meta.SourceStatusActive,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}

	stamp := time.Now().UTC().Truncate(time.Microsecond)
	finished := stamp
	operation := meta.FileOperation{
		ID:         "00000000-0000-0000-0000-000000000201",
		OwnerID:    user.ID,
		Type:       meta.FileOperationTypeCopy,
		Status:     meta.FileOperationStatusCompleted,
		ItemsJSON:  "[]",
		FinishedAt: &finished,
		CreatedAt:  stamp.Add(-time.Second),
		UpdatedAt:  stamp,
	}
	if err := db.Create(&operation).Error; err != nil {
		t.Fatal(err)
	}
	run := meta.SyncRun{
		ID:         "00000000-0000-0000-0000-000000000202",
		SourceID:   source.ID,
		Trigger:    meta.SyncRunTriggerScheduled,
		Status:     meta.SyncRunStatusCompleted,
		StartedAt:  stamp.Add(-time.Second),
		FinishedAt: &finished,
		CreatedAt:  stamp.Add(-time.Second),
		UpdatedAt:  stamp,
	}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}

	server := &Server{DB: db}
	first, err := server.backgroundTaskPage(
		context.Background(),
		nil,
		user.ID,
		true,
		1,
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.HistoryItems) != 1 ||
		first.HistoryItems[0].ID != "file-operation:"+operation.ID ||
		first.NextCursor == "" {
		t.Fatalf("first admin history page=%+v", first)
	}
	cursor, err := decodeBackgroundTaskHistoryCursor(first.NextCursor)
	if err != nil {
		t.Fatal(err)
	}
	second, err := server.backgroundTaskPage(
		context.Background(),
		nil,
		user.ID,
		true,
		1,
		cursor,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.HistoryItems) != 1 ||
		second.HistoryItems[0].ID != "sync-run:"+run.ID ||
		second.NextCursor != "" {
		t.Fatalf("second admin history page=%+v", second)
	}
}

func TestBackgroundTaskHistoryCursorRejectsMalformedValues(t *testing.T) {
	if _, err := decodeBackgroundTaskHistoryCursor("not-a-cursor"); err == nil {
		t.Fatal("malformed background task cursor was accepted")
	}
}

func backgroundTaskPageTimePtr(value time.Time) *time.Time {
	return &value
}
