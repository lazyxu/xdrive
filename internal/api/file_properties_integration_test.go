package api

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func setupFilePropertiesTestDB(t *testing.T) (*gorm.DB, *Server, meta.User, meta.User, meta.Node) {
	t.Helper()
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
	t.Cleanup(func() {
		_ = sqlDB.Close()
	})
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.File{}); err != nil {
		t.Fatal(err)
	}
	suffix := time.Now().UnixNano()
	userA := meta.User{
		Username:       fmt.Sprintf("properties-a-%d", suffix),
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	userB := meta.User{
		Username:       fmt.Sprintf("properties-b-%d", suffix),
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&userA).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&userB).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: userA.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	return db, &Server{DB: db}, userA, userB, root
}

func createFilePropertiesDir(t *testing.T, db *gorm.DB, uid, parentID uint64, name string) meta.Node {
	t.Helper()
	node := meta.Node{ParentID: &parentID, Name: name, Type: meta.NodeTypeDir, OwnerID: uid, Revision: 1}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	return node
}

func createFilePropertiesFile(t *testing.T, db *gorm.DB, uid, parentID uint64, name string, size int64) meta.Node {
	t.Helper()
	node := meta.Node{ParentID: &parentID, Name: name, Type: meta.NodeTypeFile, OwnerID: uid, Revision: 1}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{
		NodeID:     node.ID,
		Size:       size,
		StorageKey: fmt.Sprintf("properties/%d/%s", node.ID, name),
	}).Error; err != nil {
		t.Fatal(err)
	}
	return node
}

func TestFilePropertiesStatsDeduplicateNestedSelection(t *testing.T) {
	db, srv, userA, userB, root := setupFilePropertiesTestDB(t)
	parent := createFilePropertiesDir(t, db, userA.ID, root.ID, "parent")
	nested := createFilePropertiesDir(t, db, userA.ID, parent.ID, "nested")
	fileA := createFilePropertiesFile(t, db, userA.ID, parent.ID, "a.bin", 4)
	fileB := createFilePropertiesFile(t, db, userA.ID, nested.ID, "b.bin", 7)

	stats, err := srv.computeFilePropertiesStats(
		context.Background(),
		userA.ID,
		[]batchNodeRef{
			{ID: parent.ID, Revision: parent.Revision},
			{ID: nested.ID, Revision: nested.Revision},
			{ID: fileB.ID, Revision: fileB.Revision},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if stats.SelectedCount != 3 ||
		stats.EffectiveRootCount != 1 ||
		stats.TotalBytes != 11 ||
		stats.FileCount != 2 ||
		stats.FolderCount != 1 {
		t.Fatalf("unexpected recursive properties stats: %+v", stats)
	}

	if _, err := srv.computeFilePropertiesStats(
		context.Background(),
		userA.ID,
		[]batchNodeRef{{ID: fileA.ID, Revision: fileA.Revision + 1}},
	); err == nil {
		t.Fatal("stale revision unexpectedly succeeded")
	} else {
		var failure *batchMutationFailure
		if !errors.As(err, &failure) || failure.Code != "revision_conflict" {
			t.Fatalf("stale revision error=%v", err)
		}
	}

	foreignRoot := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: userB.ID, Revision: 1}
	if err := db.Create(&foreignRoot).Error; err != nil {
		t.Fatal(err)
	}
	foreign := createFilePropertiesFile(t, db, userB.ID, foreignRoot.ID, "foreign.bin", 99)
	if _, err := srv.computeFilePropertiesStats(
		context.Background(),
		userA.ID,
		[]batchNodeRef{{ID: foreign.ID, Revision: foreign.Revision}},
	); err == nil {
		t.Fatal("cross-owner properties unexpectedly succeeded")
	} else {
		var failure *batchMutationFailure
		if !errors.As(err, &failure) || failure.Code != "node_not_found" {
			t.Fatalf("cross-owner error=%v", err)
		}
	}
}

func TestFilePropertiesStatsHonorsCancelledContext(t *testing.T) {
	db, srv, userA, _, root := setupFilePropertiesTestDB(t)
	file := createFilePropertiesFile(t, db, userA.ID, root.ID, "cancel.bin", 1)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := srv.computeFilePropertiesStats(
		ctx,
		userA.ID,
		[]batchNodeRef{{ID: file.ID, Revision: file.Revision}},
	)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled properties stats error=%v want context.Canceled", err)
	}
}
