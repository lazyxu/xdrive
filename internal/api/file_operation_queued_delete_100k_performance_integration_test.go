package api

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// TestFileOperationQueuedDeleteExecutor100K exercises the real durable
// FileOperation DELETE executor, including per-subtree Share revocation.
// This is not a request-scoped HTTP cancellation or CAS physical delete test.
func TestFileOperationQueuedDeleteExecutor100K(t *testing.T) {
	if os.Getenv("XD_FILEOP_QUEUED_DELETE_100K_PERF") != "1" {
		t.Skip("enable XD_FILEOP_QUEUED_DELETE_100K_PERF=1")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL not configured")
	}
	expectFixed := os.Getenv("XD_FILEOP_QUEUED_DELETE_100K_EXPECT_FIXED") == "1"
	db := fileExplorerMediaPerfDatabase(t, dsn).Session(&gorm.Session{Logger: logger.Discard})
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.File{},
		&meta.Share{}, &meta.FileOperation{}); err != nil {
		t.Fatal(err)
	}
	user := meta.User{
		Username: "queued-delete-100k-owner", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	folder := meta.Node{
		ParentID: &root.ID, Name: "selected-100k",
		Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1,
	}
	sibling := meta.Node{
		ParentID: &root.ID, Name: "unselected",
		Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1,
	}
	if err := db.Create(&folder).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&sibling).Error; err != nil {
		t.Fatal(err)
	}
	const files = 100000
	seedStarted := time.Now()
	if err := db.Exec(`
INSERT INTO xd_nodes (parent_id, name, type, owner_id, revision, created_at, updated_at)
SELECT ?, 'item-' || lpad(gs::text, 6, '0') || '.bin',
       'file', ?, 1, NOW(), NOW()
FROM generate_series(1, ?) AS gs
`, folder.ID, user.ID, files).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`
INSERT INTO xd_files (node_id, size, storage_key, sha256, created_at, updated_at)
SELECT n.id, 1024, 'perf/queued-delete/' || n.id::text,
       '', NOW(), NOW()
FROM xd_nodes AS n
WHERE n.parent_id = ? AND n.owner_id = ?
`, folder.ID, user.ID).Error; err != nil {
		t.Fatal(err)
	}
	var representative meta.Node
	if err := db.Where("owner_id = ? AND parent_id = ?", user.ID, folder.ID).
		Order("id ASC").First(&representative).Error; err != nil {
		t.Fatal(err)
	}
	inScopeShare := meta.Share{
		OwnerID: user.ID, NodeID: representative.ID,
		TokenHash: strings.Repeat("a", 64),
	}
	outScopeShare := meta.Share{
		OwnerID: user.ID, NodeID: sibling.ID,
		TokenHash: strings.Repeat("b", 64),
	}
	if err := db.Create(&inScopeShare).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&outScopeShare).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("ANALYZE xd_nodes").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("ANALYZE xd_files").Error; err != nil {
		t.Fatal(err)
	}
	seedMS := float64(time.Since(seedStarted).Microseconds()) / 1000
	const bytesPerFile int64 = 1024
	operation := meta.FileOperation{
		ID: uuid.NewString(), OwnerID: user.ID,
		Type:      meta.FileOperationTypeDelete,
		Status:    meta.FileOperationStatusRunning,
		ItemsJSON: "[]", TotalItems: 1,
		TotalBytes: files * bytesPerFile,
	}
	if err := db.Create(&operation).Error; err != nil {
		t.Fatal(err)
	}
	srv := &Server{DB: db}
	refs := []batchNodeRef{{ID: folder.ID, Revision: folder.Revision}}
	var before runtime.MemStats
	runtime.ReadMemStats(&before)
	start := time.Now()
	mutationErr := srv.executeQueuedBatchDelete(context.Background(), operation, refs)
	elapsedMS := float64(time.Since(start).Microseconds()) / 1000
	var after runtime.MemStats
	runtime.ReadMemStats(&after)

	var deleted int64
	if err := db.Model(&meta.Node{}).
		Where("owner_id = ? AND deleted_at IS NOT NULL", user.ID).
		Count(&deleted).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&inScopeShare, inScopeShare.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&outScopeShare, outScopeShare.ID).Error; err != nil {
		t.Fatal(err)
	}
	var updatedOperation meta.FileOperation
	if err := db.First(&updatedOperation, "id = ?", operation.ID).Error; err != nil {
		t.Fatal(err)
	}
	result := map[string]any{
		"workload":                "real-FileOperation-executor-delete-100k",
		"expect_fixed":            expectFixed,
		"file_nodes":              files,
		"subtree_nodes":           files + 1,
		"share_inside_revoked":    inScopeShare.RevokedAt != nil,
		"share_outside_revoked":   outScopeShare.RevokedAt != nil,
		"operation_status":        updatedOperation.Status,
		"seed_ms":                 seedMS,
		"execute_ms":              elapsedMS,
		"total_alloc_delta_bytes": after.TotalAlloc - before.TotalAlloc,
		"trashed_count":           deleted,
		"error":                   fmt.Sprint(mutationErr),
	}
	body, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("FILEOP_EXECUTOR_DELETE_100K %s", body)

	if !expectFixed {
		if mutationErr == nil ||
			!strings.Contains(strings.ToLower(mutationErr.Error()), "65535") ||
			deleted != 0 || inScopeShare.RevokedAt != nil ||
			outScopeShare.RevokedAt != nil {
			t.Fatalf("baseline failed to reproduce exact 100k executor parameter overflow: %+v", result)
		}
		return
	}
	if mutationErr != nil || deleted != files+1 ||
		inScopeShare.RevokedAt == nil || outScopeShare.RevokedAt != nil ||
		updatedOperation.Status != meta.FileOperationStatusCompleted ||
		updatedOperation.ProcessedItems != 1 ||
		updatedOperation.ProcessedBytes != files*bytesPerFile ||
		updatedOperation.UndoPlanJSON == "" {
		t.Fatalf("corrected 100k executor did not preserve lifecycle/Share scope: %+v", result)
	}
	var updatedRoot meta.Node
	if err := db.First(&updatedRoot, "id = ?", folder.ID).Error; err != nil {
		t.Fatal(err)
	}
	if updatedRoot.Revision != folder.Revision+1 ||
		updatedRoot.DeletedAt == nil ||
		updatedRoot.TrashRootID == nil ||
		*updatedRoot.TrashRootID != folder.ID {
		t.Fatalf("selected root lost revision/Trash metadata: %+v", updatedRoot)
	}
	var unaffected meta.Node
	if err := db.First(&unaffected, "id = ?", sibling.ID).Error; err != nil {
		t.Fatal(err)
	}
	if unaffected.DeletedAt != nil || unaffected.TrashRootID != nil ||
		unaffected.Revision != 1 {
		t.Fatalf("unselected sibling modified by subtree delete: %+v", unaffected)
	}
	var damagedChildren int64
	if err := db.Table("xd_nodes").
		Where("owner_id = ? AND parent_id = ?", user.ID, folder.ID).
		Where("deleted_at IS NULL OR trash_root_id IS NULL OR trash_root_id <> ? OR revision <> 1", folder.ID).
		Count(&damagedChildren).Error; err != nil {
		t.Fatal(err)
	}
	if damagedChildren != 0 {
		t.Fatalf("100k delete damaged %d child Trash roots or revisions", damagedChildren)
	}
	var retainedFiles int64
	if err := db.Model(&meta.File{}).
		Joins("JOIN xd_nodes AS n ON n.id = xd_files.node_id").
		Where("n.parent_id = ? AND n.owner_id = ?", folder.ID, user.ID).
		Count(&retainedFiles).Error; err != nil {
		t.Fatal(err)
	}
	if retainedFiles != files {
		t.Fatalf("soft delete unexpectedly removed file metadata: got %d want %d", retainedFiles, files)
	}
}
