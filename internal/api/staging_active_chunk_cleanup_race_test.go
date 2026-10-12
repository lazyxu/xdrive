package api

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type activeStagingChunkReader struct {
	stage   int
	blocked chan struct{}
	release chan struct{}
}

func (r *activeStagingChunkReader) Read(p []byte) (int, error) {
	switch r.stage {
	case 0:
		r.stage++
		return copy(p, []byte("active-chunk-head")), nil
	case 1:
		r.stage++
		close(r.blocked)
		<-r.release
		return copy(p, []byte("-tail")), nil
	default:
		return 0, io.EOF
	}
}

// An active multipart upload has not created an UploadPart row until the
// physical PUT completes. Its still-open atomic tempfile must not become an
// administrator-deletable orphan merely because the upload took >1 hour.
func TestActiveStagingChunkSurvivesAdminOrphanCleanupRace(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("XD_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "active_staging_race_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(3)
	sqlDB.SetMaxIdleConns(0)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(
		&meta.User{}, &meta.UploadSession{}, &meta.UploadPart{},
		&meta.StagingCleanupRun{}, &meta.StagingCleanupFailure{},
	); err != nil {
		t.Fatal(err)
	}
	owner := meta.User{
		Username: "active-staging-race-owner", PasswordHash: "not-used",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	session := meta.UploadSession{
		ID: uuid.NewString(), OwnerID: owner.ID,
		Name: "ongoing-large-upload.bin", TotalSize: 4096,
		ChunkSize: 4096, ChunkCount: 1, Status: meta.UploadStatusActive,
		ExpiresAt: time.Now().Add(12 * time.Hour),
	}
	if err := db.Create(&session).Error; err != nil {
		t.Fatal(err)
	}

	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{DB: db, Store: local}
	reader := &activeStagingChunkReader{
		blocked: make(chan struct{}), release: make(chan struct{}),
	}
	var unblockOnce sync.Once
	unblock := func() { unblockOnce.Do(func() { close(reader.release) }) }
	t.Cleanup(unblock)
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	key := fmt.Sprintf("%s/%d/%s/000000-upload", storage.UploadStagingDir, owner.ID, session.ID)
	completed := make(chan error, 1)
	go func() {
		_, putErr := local.Put(ctx, key, reader)
		completed <- putErr
	}()
	select {
	case <-reader.blocked:
	case <-time.After(10 * time.Second):
		t.Fatal("real active multipart staging writer did not block")
	}

	var temporary storage.StagingFile
	found := false
	if err := local.WalkStaging(ctx, func(file storage.StagingFile) error {
		if strings.HasPrefix(file.Key, fmt.Sprintf("%s/%d/%s/", storage.UploadStagingDir, owner.ID, session.ID)) &&
			strings.HasPrefix(filepath.Base(file.Key), ".xdrive-upload-") &&
			file.Size >= int64(len("active-chunk-head")) {
			temporary, found = file, true
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if !found {
		t.Fatal("original physical active staging tempfile was not visible")
	}
	tempPath := filepath.Join(local.FilesystemRoot(), filepath.FromSlash(temporary.Key))
	aged := time.Now().Add(-2 * stagingOrphanGrace)
	if err := os.Chtimes(tempPath, aged, aged); err != nil {
		t.Fatal(err)
	}
	var visibleOld bool
	if err := local.WalkStaging(ctx, func(file storage.StagingFile) error {
		if file.Key == temporary.Key {
			visibleOld = !file.ModifiedAt.After(time.Now().Add(-stagingOrphanGrace))
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if !visibleOld {
		t.Fatal("real open staging temporary file did not exceed orphan grace")
	}

	// Exercise the real administrator cleanup, including its PostgreSQL
	// inventory and original physical storage.StagingInspector deletion.
	cleaned, err := server.cleanupUploadStaging(ctx, meta.StagingCleanupTriggerManual)
	if err != nil {
		t.Fatalf("genuine staging cleanup failed: %v", err)
	}
	unblock()
	select {
	case err := <-completed:
		if err != nil {
			t.Fatalf("active staging upload was destroyed by orphan cleanup: cleanup deleted=%d failed=%d temp=%q putErr=%v", cleaned.DeletedFiles, cleaned.FailedFiles, temporary.Key, err)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("real multipart writer never completed after cleanup")
	}
	f, err := local.Open(ctx, key)
	if err != nil {
		t.Fatalf("completed multipart staging object missing: %v", err)
	}
	defer f.Close()
	bytes, err := io.ReadAll(f)
	if err != nil {
		t.Fatal(err)
	}
	if string(bytes) != "active-chunk-head-tail" {
		t.Fatalf("completed staging chunk damaged: %q", bytes)
	}
	var activeCount int64
	if err := db.Model(&meta.UploadSession{}).
		Where("id = ? AND status = ?", session.ID, meta.UploadStatusActive).
		Count(&activeCount).Error; err != nil {
		t.Fatal(err)
	}
	if activeCount != 1 {
		t.Fatalf("staging cleanup removed the unexpired active upload session: %d", activeCount)
	}
	if _, err := os.Stat(tempPath); err == nil {
		t.Fatalf("atomic upload leaked a temporary file: %q", temporary.Key)
	} else if !errors.Is(err, os.ErrNotExist) {
		t.Fatal(err)
	}
}
