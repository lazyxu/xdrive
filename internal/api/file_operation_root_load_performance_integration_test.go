package api

import (
	"errors"
	"fmt"
	"net/http"
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

func TestFileOperationBatchRootLoadUsesConstantSQL(t *testing.T) {
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

	schema := "fileop_root_load_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.File{}); err != nil {
		t.Fatal(err)
	}

	user := meta.User{
		Username:       "file-operation-root-load-owner",
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

	const selectedCount = 120
	nodes := make([]meta.Node, 0, selectedCount)
	for index := 0; index < selectedCount; index++ {
		parent := root.ID
		nodes = append(nodes, meta.Node{
			ParentID: &parent,
			Name:     fmt.Sprintf("file-%03d.bin", index),
			Type:     meta.NodeTypeFile,
			OwnerID:  user.ID,
			Revision: uint64(index + 1),
		})
	}
	if err := db.Create(&nodes).Error; err != nil {
		t.Fatal(err)
	}
	files := make([]meta.File, 0, selectedCount)
	for index := range nodes {
		files = append(files, meta.File{
			NodeID:     nodes[index].ID,
			Size:       int64(index + 1),
			StorageKey: fmt.Sprintf("fixture/%03d", index),
		})
	}
	if err := db.Create(&files).Error; err != nil {
		t.Fatal(err)
	}

	refs := make([]batchNodeRef, 0, selectedCount)
	for index := len(nodes) - 1; index >= 0; index-- {
		refs = append(refs, batchNodeRef{ID: nodes[index].ID, Revision: nodes[index].Revision})
	}

	legacyTx := db.Begin()
	if legacyTx.Error != nil {
		t.Fatal(legacyTx.Error)
	}
	counter.start()
	for index, ref := range refs {
		if _, err := batchLoadNodeTx(legacyTx, user.ID, ref, index, true); err != nil {
			_ = legacyTx.Rollback().Error
			t.Fatal(err)
		}
	}
	legacyQueries := counter.stop()
	if err := legacyTx.Rollback().Error; err != nil {
		t.Fatal(err)
	}
	if legacyQueries != selectedCount*2 {
		t.Fatalf("legacy root validation SELECTs=%d want=%d", legacyQueries, selectedCount*2)
	}

	batchTx := db.Begin()
	if batchTx.Error != nil {
		t.Fatal(batchTx.Error)
	}
	counter.start()
	loaded, err := batchLoadNodesTx(batchTx, user.ID, refs, true)
	batchQueries := counter.stop()
	if rollbackErr := batchTx.Rollback().Error; rollbackErr != nil {
		t.Fatal(rollbackErr)
	}
	if err != nil {
		t.Fatal(err)
	}
	if batchQueries != 2 {
		t.Fatalf("batch root validation SELECTs=%d want=2", batchQueries)
	}
	if len(loaded) != len(refs) {
		t.Fatalf("loaded roots=%d want=%d", len(loaded), len(refs))
	}
	for index, node := range loaded {
		if node.ID != refs[index].ID {
			t.Fatalf("loaded[%d].ID=%d want=%d", index, node.ID, refs[index].ID)
		}
		if node.File == nil || node.File.NodeID != node.ID {
			t.Fatalf("loaded[%d] missing file metadata: %+v", index, node)
		}
	}

	moveTx := db.Begin()
	if moveTx.Error != nil {
		t.Fatal(moveTx.Error)
	}
	counter.start()
	moveLoaded, err := batchLoadNodesTx(moveTx, user.ID, refs, false)
	moveQueries := counter.stop()
	if rollbackErr := moveTx.Rollback().Error; rollbackErr != nil {
		t.Fatal(rollbackErr)
	}
	if err != nil {
		t.Fatal(err)
	}
	if moveQueries != 1 {
		t.Fatalf("batch move root validation SELECTs=%d want=1", moveQueries)
	}
	if len(moveLoaded) != len(refs) {
		t.Fatalf("move loaded roots=%d want=%d", len(moveLoaded), len(refs))
	}
	for index, node := range moveLoaded {
		if node.ID != refs[index].ID {
			t.Fatalf("move loaded[%d].ID=%d want=%d", index, node.ID, refs[index].ID)
		}
		if node.File != nil {
			t.Fatalf("move loaded[%d] unexpectedly preloaded file metadata: %+v", index, node.File)
		}
	}

	badRefs := append([]batchNodeRef(nil), refs...)
	badIndex := 17
	badRefs[badIndex].Revision++
	checkTx := db.Begin()
	if checkTx.Error != nil {
		t.Fatal(checkTx.Error)
	}
	_, err = batchLoadNodesTx(checkTx, user.ID, badRefs, true)
	if rollbackErr := checkTx.Rollback().Error; rollbackErr != nil {
		t.Fatal(rollbackErr)
	}
	var failure *batchMutationFailure
	if !errors.As(err, &failure) {
		t.Fatalf("revision mismatch err=%v want batchMutationFailure", err)
	}
	if failure.Index != badIndex ||
		failure.ID != badRefs[badIndex].ID ||
		failure.Status != http.StatusConflict ||
		failure.Code != "revision_conflict" ||
		failure.CurrentRevision != refs[badIndex].Revision {
		t.Fatalf("revision mismatch failure=%+v", failure)
	}
}

func TestFileOperationExecutionUsesBatchRootLoads(t *testing.T) {
	sourceBytes, err := os.ReadFile("file_operations.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(sourceBytes)
	for _, functionName := range []string{
		"executeQueuedBatchCopy",
		"executeQueuedBatchMove",
		"executeQueuedBatchDelete",
	} {
		start := strings.Index(source, "func (s *Server) "+functionName)
		if start < 0 {
			t.Fatalf("missing production function %s", functionName)
		}
		rest := source[start+1:]
		end := strings.Index(rest, "\nfunc ")
		body := source[start:]
		if end >= 0 {
			body = source[start : start+1+end]
		}
		if !strings.Contains(body, "batchLoadNodesTx(tx, uid, refs,") {
			t.Fatalf("%s must batch-load selected roots", functionName)
		}
		if strings.Contains(body, "batchLoadNodeTx(tx, uid, ref, index") {
			t.Fatalf("%s regressed to per-root loading", functionName)
		}
	}
}
