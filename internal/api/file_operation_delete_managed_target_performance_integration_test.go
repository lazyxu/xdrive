package api

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestDeleteManagedTargetProtectionLoadsOwnerTargetsOnce(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}

	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Discard})
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

	schema := "fileop_delete_managed_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	counter := &fileOperationSQLCounter{Interface: logger.Discard}
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{Logger: counter})
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

	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.Source{}); err != nil {
		t.Fatal(err)
	}
	user := meta.User{
		Username:       "file-operation-delete-managed-owner",
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}

	const rootCount = 120
	nodes := make([]meta.Node, 0, rootCount)
	for index := 0; index < rootCount; index++ {
		parentID := root.ID
		nodes = append(nodes, meta.Node{
			ParentID: &parentID,
			Name:     fmt.Sprintf("dir-%03d", index),
			Type:     meta.NodeTypeDir,
			OwnerID:  user.ID,
			Revision: 1,
		})
	}
	if err := db.Create(&nodes).Error; err != nil {
		t.Fatal(err)
	}

	protectedID := nodes[57].ID
	source := meta.Source{
		OwnerID:      user.ID,
		Name:         "managed-yike",
		Kind:         yikeSourceKind,
		Direction:    meta.SourceDirectionPull,
		SyncMode:     meta.SourceSyncModeBackup,
		RunMode:      meta.SourceRunModeSync,
		Status:       meta.SourceStatusActive,
		TargetNodeID: &protectedID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}

	counter.start()
	targets, err := loadYikeManagedTargetIDsDB(context.Background(), db, user.ID)
	statementCount := counter.stop()
	if err != nil {
		t.Fatal(err)
	}
	if statementCount != 2 {
		t.Fatalf("managed target load SQL statements=%d want=2 (schema probe + target load)", statementCount)
	}
	if len(targets) != 1 {
		t.Fatalf("managed target count=%d want=1", len(targets))
	}

	for index, node := range nodes {
		protected := yikeManagedTargetInIDs(targets, []uint64{node.ID})
		want := index == 57
		if protected != want {
			t.Fatalf("root %d protected=%t want=%t", index, protected, want)
		}
	}

	if err := db.Migrator().DropTable(&meta.Source{}); err != nil {
		t.Fatal(err)
	}
	counter.start()
	targets, err = loadYikeManagedTargetIDsDB(context.Background(), db, user.ID)
	coreOnlyStatements := counter.stop()
	if err != nil {
		t.Fatal(err)
	}
	if coreOnlyStatements != 1 {
		t.Fatalf("core-only managed target load SQL statements=%d want=1 schema probe", coreOnlyStatements)
	}
	if len(targets) != 0 {
		t.Fatalf("core-only managed targets=%v want empty", targets)
	}
}

func TestDeleteExecutorUsesSelectionWideManagedTargetLoad(t *testing.T) {
	source, err := os.ReadFile("file_operations.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	start := strings.Index(text, "func (s *Server) executeQueuedBatchDelete")
	if start < 0 {
		t.Fatal("delete executor start not found")
	}
	end := strings.Index(text[start:], "func (s *Server) cancelRunningFileOperation")
	if end < 0 {
		t.Fatal("delete executor end not found")
	}
	block := text[start : start+end]

	if strings.Count(block, "loadYikeManagedTargetIDsDB(") != 1 {
		t.Fatal("Delete executor must load owner managed targets exactly once")
	}
	if strings.Contains(block, "yikeManagedTargetInIDsDB(") {
		t.Fatal("Delete executor must not perform per-root managed-target DB queries")
	}
	if !strings.Contains(block, "yikeManagedTargetInIDs(managedTargets, subtree.IDs)") {
		t.Fatal("Delete executor must preserve per-root protection decisions with the preloaded target set")
	}
}
