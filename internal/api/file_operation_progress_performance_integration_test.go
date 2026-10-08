package api

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type fileOperationProgressSQLCounter struct {
	logger.Interface
	enabled atomic.Bool
	updates atomic.Int64
}

func (counter *fileOperationProgressSQLCounter) Trace(
	ctx context.Context,
	begin time.Time,
	fc func() (string, int64),
	err error,
) {
	sql, rows := fc()
	if counter.enabled.Load() {
		lower := strings.ToLower(strings.TrimSpace(sql))
		if strings.HasPrefix(lower, "update \"xd_file_operations\"") {
			counter.updates.Add(1)
		}
	}
	counter.Interface.Trace(ctx, begin, func() (string, int64) {
		return sql, rows
	}, err)
}

func (counter *fileOperationProgressSQLCounter) start() {
	counter.updates.Store(0)
	counter.enabled.Store(true)
}

func (counter *fileOperationProgressSQLCounter) stop() int64 {
	counter.enabled.Store(false)
	return counter.updates.Load()
}

func openFileOperationProgressPerformanceDB(t *testing.T) (*gorm.DB, *fileOperationProgressSQLCounter) {
	t.Helper()
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

	schema := "fileop_progress_perf_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	counter := &fileOperationProgressSQLCounter{Interface: logger.Discard}
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

	if err := db.AutoMigrate(&meta.User{}, &meta.FileOperation{}); err != nil {
		t.Fatal(err)
	}
	return db, counter
}

func createRunningFileOperation(t *testing.T, db *gorm.DB, ownerID uint64, operationType string) meta.FileOperation {
	t.Helper()
	now := time.Now()
	operation := meta.FileOperation{
		ID:         uuid.NewString(),
		OwnerID:    ownerID,
		Type:       operationType,
		Status:     meta.FileOperationStatusRunning,
		ItemsJSON:  "[]",
		TotalItems: 120,
		TotalBytes: 7260,
		StartedAt:  &now,
	}
	if err := db.Create(&operation).Error; err != nil {
		t.Fatal(err)
	}
	return operation
}

func TestFileOperationProgressCoalescesCompletedDeltas(t *testing.T) {
	db, counter := openFileOperationProgressPerformanceDB(t)
	user := meta.User{
		Username:       "file-operation-progress-owner",
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	server := &Server{DB: db}
	ctx := context.Background()
	const itemCount = 120

	legacy := createRunningFileOperation(t, db, user.ID, meta.FileOperationTypeMove)
	counter.start()
	for index := 0; index < itemCount; index++ {
		if err := server.beginFileOperationItem(ctx, legacy.ID, fmt.Sprintf("legacy-%03d", index)); err != nil {
			t.Fatal(err)
		}
		if err := server.recordFileOperationProgress(ctx, legacy.ID, int64(index+1)); err != nil {
			t.Fatal(err)
		}
	}
	legacyUpdates := counter.stop()
	if legacyUpdates != itemCount*2 {
		t.Fatalf("legacy FileOperation UPDATEs=%d want=%d", legacyUpdates, itemCount*2)
	}

	coalesced := createRunningFileOperation(t, db, user.ID, meta.FileOperationTypeMove)
	progress := newFileOperationProgressCoalescer(server, ctx, coalesced.ID)
	counter.start()
	for index := 0; index < itemCount; index++ {
		if err := progress.begin(fmt.Sprintf("coalesced-%03d", index)); err != nil {
			t.Fatal(err)
		}
		progress.add(1, int64(index+1))
	}
	if err := progress.flush(); err != nil {
		t.Fatal(err)
	}
	coalescedUpdates := counter.stop()
	if coalescedUpdates != itemCount+1 {
		t.Fatalf("coalesced FileOperation UPDATEs=%d want=%d", coalescedUpdates, itemCount+1)
	}

	var stored meta.FileOperation
	if err := db.Where("id = ?", coalesced.ID).First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored.ProcessedItems != itemCount || stored.ProcessedBytes != 7260 {
		t.Fatalf(
			"stored progress items=%d bytes=%d want items=%d bytes=7260",
			stored.ProcessedItems,
			stored.ProcessedBytes,
			itemCount,
		)
	}
	if stored.CurrentItem != "coalesced-119" {
		t.Fatalf("current item=%q want coalesced-119", stored.CurrentItem)
	}
}

func TestFileOperationProgressPreservesDatabaseCancellationCheckpoint(t *testing.T) {
	db, _ := openFileOperationProgressPerformanceDB(t)
	user := meta.User{
		Username:       "file-operation-progress-cancel-owner",
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	operation := createRunningFileOperation(t, db, user.ID, meta.FileOperationTypeDelete)
	server := &Server{DB: db}
	progress := newFileOperationProgressCoalescer(server, context.Background(), operation.ID)
	progress.add(1, 123)

	if err := db.Model(&meta.FileOperation{}).
		Where("id = ?", operation.ID).
		Update("status", meta.FileOperationStatusCancelRequested).Error; err != nil {
		t.Fatal(err)
	}
	if err := progress.begin("next-item"); !errors.Is(err, errFileOperationCancelled) {
		t.Fatalf("begin after database cancellation err=%v want errFileOperationCancelled", err)
	}

	var stored meta.FileOperation
	if err := db.Where("id = ?", operation.ID).First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored.ProcessedItems != 0 || stored.ProcessedBytes != 0 || stored.CurrentItem != "" {
		t.Fatalf(
			"cancelled checkpoint persisted pending progress: items=%d bytes=%d current=%q",
			stored.ProcessedItems,
			stored.ProcessedBytes,
			stored.CurrentItem,
		)
	}
}

func TestFileOperationProgressExecutorsUseCoalescer(t *testing.T) {
	source, err := os.ReadFile("file_operations.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	for _, functionName := range []string{
		"executeQueuedBatchCopy",
		"executeQueuedBatchMove",
		"executeQueuedBatchDelete",
	} {
		start := strings.Index(text, "func (s *Server) "+functionName)
		if start < 0 {
			t.Fatalf("missing %s", functionName)
		}
		rest := text[start:]
		end := strings.Index(rest, "\nfunc ")
		section := rest
		if end >= 0 {
			section = rest[:end]
		}
		for _, token := range []string{
			"newFileOperationProgressCoalescer",
			"operationProgress.begin(",
			"operationProgress.add(",
			"operationProgress.flush()",
		} {
			if !strings.Contains(section, token) {
				t.Fatalf("%s missing progress coalescer token %q", functionName, token)
			}
		}
		for _, legacyToken := range []string{
			"s.recordFileOperationProgress(ctx, operation.ID",
			"s.recordSkippedFileOperationItem(ctx, operation.ID",
			"s.recordFileOperationProgressDelta(ctx, operation.ID, 1, 0)",
		} {
			if strings.Contains(section, legacyToken) {
				t.Fatalf("%s retained direct progress write %q", functionName, legacyToken)
			}
		}
	}
}
