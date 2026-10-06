package api

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/fileoperationwake"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestFileOperationWorkerUsesPostgresWakeup(t *testing.T) {
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

	if err := db.Migrator().DropTable(
		&meta.FileOperation{},
		&meta.Share{},
		&meta.File{},
		&meta.Node{},
		&meta.User{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{},
		&meta.Node{},
		&meta.File{},
		&meta.Share{},
		&meta.FileOperation{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_parent_name
		 ON xd_nodes(owner_id, parent_id, lower(name))
		 WHERE parent_id IS NOT NULL AND deleted_at IS NULL`,
	).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_root_owner
		 ON xd_nodes(owner_id) WHERE parent_id IS NULL`,
	).Error; err != nil {
		t.Fatal(err)
	}
	if err := fileoperationwake.InstallPostgreSQLTrigger(db); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	listener := fileoperationwake.Listen(ctx, dsn, nil)
	select {
	case <-listener.Ready:
	case <-time.After(5 * time.Second):
		t.Fatal("file operation wake listener did not become ready")
	}

	user := meta.User{
		Username:       "file-operation-wakeup-owner",
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{
		Name:     "",
		Type:     meta.NodeTypeDir,
		OwnerID:  user.ID,
		Revision: 1,
	}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	fileNode := meta.Node{
		ParentID: &root.ID,
		Name:     "notify-delete.txt",
		Type:     meta.NodeTypeFile,
		OwnerID:  user.ID,
		Revision: 1,
	}
	if err := db.Create(&fileNode).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{
		NodeID:     fileNode.ID,
		Size:       7,
		StorageKey: "test/notify-delete.txt",
	}).Error; err != nil {
		t.Fatal(err)
	}

	server := &Server{
		DB:                   db,
		FileOperationWakeups: listener.Wakeups,
	}
	server.StartFileOperationWorker(ctx)

	operation, err := server.enqueueFileOperation(
		context.Background(),
		user.ID,
		meta.FileOperationTypeDelete,
		[]batchNodeRef{{
			ID:       fileNode.ID,
			Revision: fileNode.Revision,
		}},
		0,
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		current, err := server.loadOwnedFileOperation(
			context.Background(),
			user.ID,
			operation.ID,
		)
		if err != nil {
			t.Fatal(err)
		}
		if current.Status == meta.FileOperationStatusCompleted {
			return
		}
		if current.Status == meta.FileOperationStatusFailed ||
			current.Status == meta.FileOperationStatusCancelled {
			t.Fatalf("operation ended unexpectedly: %+v", current)
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf(
		"queued operation was not processed within 1s; fallback interval is %s",
		fileOperationFallbackInterval,
	)
}
