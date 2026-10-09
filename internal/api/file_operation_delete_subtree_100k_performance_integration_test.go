package api

import (
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// TestFileOperationSoftDeleteSubtree100K measures the production 100k-leaf SQL
// mutation and preserves a first-red failure rather than confusing an error
// latency with successful delete throughput.
func TestFileOperationSoftDeleteSubtree100K(t *testing.T) {
	if os.Getenv("XD_FILEOP_DELETE_100K_PERF") != "1" {
		t.Skip("enable XD_FILEOP_DELETE_100K_PERF=1")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	expectFixed := os.Getenv("XD_FILEOP_DELETE_100K_EXPECT_FIXED") == "1"
	db := fileExplorerMediaPerfDatabase(t, dsn).Session(&gorm.Session{Logger: logger.Discard})
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.File{}); err != nil {
		t.Fatal(err)
	}
	user := meta.User{Username: "delete-100k-owner", PasswordHash: "not-used", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	folder := meta.Node{Name: "selected-100k", Type: meta.NodeTypeDir, OwnerID: user.ID, ParentID: &root.ID, Revision: 1}
	if err := db.Create(&folder).Error; err != nil {
		t.Fatal(err)
	}
	outside := meta.Node{ParentID: &root.ID, Name: "outside-selection", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&outside).Error; err != nil {
		t.Fatal(err)
	}
	const logicalCount = 100000
	seedStart := time.Now()
	if err := db.Exec(`
INSERT INTO xd_nodes (parent_id, name, type, owner_id, revision, created_at, updated_at)
SELECT ?, 'file-' || lpad(gs::text, 6, '0') || '.bin', 'file', ?, 1, NOW(), NOW()
FROM generate_series(1, ?) AS gs
`, folder.ID, user.ID, logicalCount).Error; err != nil {
		t.Fatal(err)
	}
	var childIDs []uint64
	if err := db.Model(&meta.Node{}).Where("parent_id = ? AND owner_id = ?", folder.ID, user.ID).
		Order("id").Pluck("id", &childIDs).Error; err != nil {
		t.Fatal(err)
	}
	if len(childIDs) != logicalCount {
		t.Fatalf("expected %d child nodes, got %d", logicalCount, len(childIDs))
	}
	subtreeIDs := append([]uint64{folder.ID}, childIDs...)
	seedMS := float64(time.Since(seedStart).Microseconds()) / 1000
	before := runtime.MemStats{}
	runtime.ReadMemStats(&before)
	start := time.Now()
	rootUpdated := false
	err := db.Transaction(func(tx *gorm.DB) error {
		updated, updateErr := markFileOperationDeleteSubtreeTx(
			tx, user.ID, folder.ID, folder.Revision, subtreeIDs, time.Now(),
		)
		rootUpdated = updated
		return updateErr
	})
	elapsedMS := float64(time.Since(start).Microseconds()) / 1000
	after := runtime.MemStats{}
	runtime.ReadMemStats(&after)
	var trashed int64
	if countErr := db.Model(&meta.Node{}).Where("owner_id = ? AND deleted_at IS NOT NULL", user.ID).
		Count(&trashed).Error; countErr != nil {
		t.Fatal(countErr)
	}
	result := map[string]any{
		"workload":                "real-postgres-mark-soft-delete-100k",
		"logical_file_nodes":      logicalCount,
		"subtree_ids":             len(subtreeIDs),
		"expect_fixed":            expectFixed,
		"seed_ms":                 seedMS,
		"mutation_ms":             elapsedMS,
		"root_updated":            rootUpdated,
		"trashed_count":           trashed,
		"total_alloc_delta_bytes": after.TotalAlloc - before.TotalAlloc,
		"error":                   fmt.Sprint(err),
	}
	data, marshalErr := json.Marshal(result)
	if marshalErr != nil {
		t.Fatal(marshalErr)
	}
	t.Logf("FILEOP_DELETE_SUBTREE_100K %s", data)
	if !expectFixed {
		if err == nil || !strings.Contains(strings.ToLower(err.Error()), "65535") || trashed != 0 {
			t.Fatalf("original 100k delete did not reproduce expected PostgreSQL bind overflow: %+v", result)
		}
		return
	}
	if err != nil || !rootUpdated || trashed != logicalCount+1 {
		t.Fatalf("corrected 100k soft-delete did not finish: %+v", result)
	}
	var updatedRoot meta.Node
	if err := db.Unscoped().First(&updatedRoot, folder.ID).Error; err != nil {
		t.Fatal(err)
	}
	if updatedRoot.Revision != folder.Revision+1 || updatedRoot.DeletedAt == nil ||
		updatedRoot.TrashRootID == nil || *updatedRoot.TrashRootID != folder.ID {
		t.Fatalf("root revision/deleted/Trash status incorrect: %+v", updatedRoot)
	}
	var incorrectChildren int64
	if err := db.Table("xd_nodes").
		Where("owner_id = ? AND parent_id = ?", user.ID, folder.ID).
		Where("deleted_at IS NULL OR trash_root_id IS NULL OR trash_root_id <> ? OR revision <> 1", folder.ID).
		Count(&incorrectChildren).Error; err != nil {
		t.Fatal(err)
	}
	if incorrectChildren != 0 {
		t.Fatalf("%d children lost Trash identity or had unintended revision changes", incorrectChildren)
	}
	var unaffected meta.Node
	if err := db.First(&unaffected, outside.ID).Error; err != nil {
		t.Fatal(err)
	}
	if unaffected.DeletedAt != nil || unaffected.TrashRootID != nil || unaffected.Revision != 1 {
		t.Fatalf("sibling outside selected subtree was modified: %+v", unaffected)
	}
}
