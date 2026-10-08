package api

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type fileOperationSQLCapture struct {
	logger.Interface
	mu         sync.Mutex
	statements []string
}

func (capture *fileOperationSQLCapture) Trace(
	ctx context.Context,
	begin time.Time,
	fc func() (string, int64),
	err error,
) {
	sql, _ := fc()
	capture.mu.Lock()
	capture.statements = append(capture.statements, sql)
	capture.mu.Unlock()
}

func (capture *fileOperationSQLCapture) reset() {
	capture.mu.Lock()
	capture.statements = nil
	capture.mu.Unlock()
}

func (capture *fileOperationSQLCapture) snapshot() []string {
	capture.mu.Lock()
	defer capture.mu.Unlock()
	return append([]string(nil), capture.statements...)
}

func TestFileOperationSubtreePredicatesAvoidIDMaterialization(t *testing.T) {
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

	schema := "fileop_subtree_predicate_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	capture := &fileOperationSQLCapture{Interface: logger.Discard}
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{Logger: capture})
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

	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}); err != nil {
		t.Fatal(err)
	}

	user := meta.User{
		Username:       "file-operation-subtree-predicate-owner",
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
	rootID := root.ID
	source := meta.Node{
		ParentID: &rootID,
		Name:     "source",
		Type:     meta.NodeTypeDir,
		OwnerID:  user.ID,
		Revision: 1,
	}
	outside := meta.Node{
		ParentID: &rootID,
		Name:     "outside",
		Type:     meta.NodeTypeDir,
		OwnerID:  user.ID,
		Revision: 1,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&outside).Error; err != nil {
		t.Fatal(err)
	}

	const childCount = 1200
	children := make([]meta.Node, 0, childCount)
	for index := 0; index < childCount; index++ {
		parentID := source.ID
		children = append(children, meta.Node{
			ParentID: &parentID,
			Name:     fmt.Sprintf("child-%04d", index),
			Type:     meta.NodeTypeDir,
			OwnerID:  user.ID,
			Revision: 1,
		})
	}
	if err := db.Create(&children).Error; err != nil {
		t.Fatal(err)
	}
	descendant := children[len(children)-1]

	capture.reset()
	inside, err := batchTargetInsideNode(db, user.ID, descendant.ID, source.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !inside {
		t.Fatal("direct descendant must be reported inside the source directory")
	}
	statements := capture.snapshot()
	if len(statements) != 1 {
		t.Fatalf("target-inside predicate used %d SQL statements; want exactly 1", len(statements))
	}
	targetSQL := strings.ToLower(statements[0])
	for _, fragment := range []string{"with recursive ancestors", "select exists", "join ancestors"} {
		if !strings.Contains(targetSQL, fragment) {
			t.Fatalf("target-inside SQL missing %q: %s", fragment, statements[0])
		}
	}

	inside, err = batchTargetInsideNode(db, user.ID, outside.ID, source.ID)
	if err != nil {
		t.Fatal(err)
	}
	if inside {
		t.Fatal("sibling directory must not be reported inside the source directory")
	}

	protected, err := yikeManagedTargetInSubtreeDB(context.Background(), db, user.ID, source.ID)
	if err != nil {
		t.Fatal(err)
	}
	if protected {
		t.Fatal("core-only schema without Sources must not report managed-target protection")
	}

	if err := db.AutoMigrate(&meta.Source{}); err != nil {
		t.Fatal(err)
	}
	targetID := descendant.ID
	managed := meta.Source{
		OwnerID:      user.ID,
		Name:         "一刻相册",
		Kind:         yikeSourceKind,
		Direction:    "pull",
		SyncMode:     "backup",
		TargetNodeID: &targetID,
	}
	if err := db.Create(&managed).Error; err != nil {
		t.Fatal(err)
	}

	capture.reset()
	protected, err = yikeManagedTargetInSubtreeDB(context.Background(), db, user.ID, source.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !protected {
		t.Fatal("source subtree containing the managed target must be protected")
	}
	statements = capture.snapshot()
	recursiveStatements := make([]string, 0, 1)
	for _, statement := range statements {
		lower := strings.ToLower(statement)
		if strings.Contains(lower, "with recursive subtree") {
			recursiveStatements = append(recursiveStatements, lower)
		}
		if strings.Contains(lower, "target_node_id in") {
			t.Fatalf("managed-target predicate reintroduced subtree-sized IN materialization: %s", statement)
		}
	}
	if len(recursiveStatements) != 1 {
		t.Fatalf("managed-target predicate recursive statements=%d want=1; all=%v", len(recursiveStatements), statements)
	}
	for _, fragment := range []string{"select exists", "join subtree", "xd_sources"} {
		if !strings.Contains(recursiveStatements[0], fragment) {
			t.Fatalf("managed-target SQL missing %q: %s", fragment, recursiveStatements[0])
		}
	}

	const selectedCount = 120
	selected := children[:selectedCount]

	capture.reset()
	for _, node := range selected {
		inside, err := batchTargetInsideNode(db, user.ID, outside.ID, node.ID)
		if err != nil {
			t.Fatal(err)
		}
		if inside {
			t.Fatalf("outside target unexpectedly inside selected root %d", node.ID)
		}
	}
	statements = capture.snapshot()
	legacyAncestorQueries := 0
	for _, statement := range statements {
		if strings.Contains(strings.ToLower(statement), "with recursive ancestors") {
			legacyAncestorQueries++
		}
	}
	if legacyAncestorQueries != selectedCount {
		t.Fatalf("legacy target-descendant queries=%d want=%d", legacyAncestorQueries, selectedCount)
	}

	capture.reset()
	matches, err := batchTargetInsideNodesTx(db, user.ID, outside.ID, selected)
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 0 {
		t.Fatalf("outside target matched selected roots: %+v", matches)
	}
	statements = capture.snapshot()
	batchAncestorQueries := 0
	for _, statement := range statements {
		lower := strings.ToLower(statement)
		if strings.Contains(lower, "with recursive ancestors") {
			batchAncestorQueries++
			for _, fragment := range []string{"select ancestors.id", "ancestors.id in"} {
				if !strings.Contains(lower, fragment) {
					t.Fatalf("batch target-descendant SQL missing %q: %s", fragment, statement)
				}
			}
		}
	}
	if batchAncestorQueries != 1 {
		t.Fatalf("batch target-descendant queries=%d want=1; all=%v", batchAncestorQueries, statements)
	}

	nestedParentID := selected[73].ID
	nestedTarget := meta.Node{
		ParentID: &nestedParentID,
		Name:     "nested-target",
		Type:     meta.NodeTypeDir,
		OwnerID:  user.ID,
		Revision: 1,
	}
	if err := db.Create(&nestedTarget).Error; err != nil {
		t.Fatal(err)
	}
	matches, err = batchTargetInsideNodesTx(db, user.ID, nestedTarget.ID, selected)
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 1 {
		t.Fatalf("nested target matches=%d want=1: %+v", len(matches), matches)
	}
	if _, ok := matches[selected[73].ID]; !ok {
		t.Fatalf("nested target did not match owning selected root %d: %+v", selected[73].ID, matches)
	}
}

func TestFileOperationExecutionBatchesTargetDescendantChecks(t *testing.T) {
	sourceBytes, err := os.ReadFile("file_operations.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(sourceBytes)
	for _, functionName := range []string{
		"executeQueuedBatchCopy",
		"executeQueuedBatchMove",
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
		if !strings.Contains(body, "batchTargetInsideNodesTx(tx, uid, parentID, roots)") {
			t.Fatalf("%s must batch target-descendant validation", functionName)
		}
		if strings.Contains(body, "batchTargetInsideNode(tx, uid, parentID") {
			t.Fatalf("%s regressed to per-root target-descendant validation", functionName)
		}
	}
}
