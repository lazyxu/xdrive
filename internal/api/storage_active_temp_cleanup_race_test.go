package api

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type delayedActiveAtomicUploadReader struct {
	step    int
	blocked chan struct{}
	release chan struct{}
}

func (r *delayedActiveAtomicUploadReader) Read(p []byte) (int, error) {
	switch r.step {
	case 0:
		r.step++
		return copy(p, []byte("active-upload-head")), nil
	case 1:
		r.step++
		close(r.blocked)
		<-r.release
		return copy(p, []byte("-tail")), nil
	default:
		return 0, io.EOF
	}
}

// R-STORAGE-001: an upload can legitimately stay active long enough for
// its atomic temporary file to pass the administrator's one-hour stale-file
// threshold. Cleanup must not destroy that still-owned physical write.
func TestActiveLongRunningAtomicPutSurvivesTempCleanupRace(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("XD_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
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
	if err := resetMediaDerivativeTestSchema(db); err != nil {
		t.Fatal(err)
	}
	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{DB: db, Store: local}
	reader := &delayedActiveAtomicUploadReader{
		blocked: make(chan struct{}),
		release: make(chan struct{}),
	}
	var once sync.Once
	unblock := func() { once.Do(func() { close(reader.release) }) }
	t.Cleanup(unblock)

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	key := "active-large-upload/result.bin"
	done := make(chan error, 1)
	go func() {
		_, putErr := local.Put(ctx, key, reader)
		done <- putErr
	}()
	select {
	case <-reader.blocked:
	case <-time.After(12 * time.Second):
		t.Fatal("real Local.Put never reached active reader barrier")
	}

	var temporary storage.ManagedFile
	var found bool
	deadline := time.Now().Add(12 * time.Second)
	for time.Now().Before(deadline) {
		found = false
		err = local.WalkManagedFiles(ctx, func(file storage.ManagedFile) error {
			if storageInventoryCategory(file.Key) == "write_temp" &&
				strings.HasPrefix(file.Key, "active-large-upload/") &&
				file.Size >= int64(len("active-upload-head")) {
				temporary = file
				found = true
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		if found {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !found {
		t.Fatal("live atomic temporary file never appeared on physical storage")
	}
	tempPath := filepath.Join(local.FilesystemRoot(), filepath.FromSlash(temporary.Key))
	aged := time.Now().Add(-2 * storageTempReclaimableAge)
	if err := os.Chtimes(tempPath, aged, aged); err != nil {
		t.Fatal(err)
	}
	var confirmedOld bool
	if err := local.WalkManagedFiles(ctx, func(file storage.ManagedFile) error {
		if file.Key == temporary.Key {
			confirmedOld = storageCleanupMatches(storageCleanupTemp, file, time.Now().Add(-storageTempReclaimableAge))
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if !confirmedOld {
		t.Fatal("failed to construct a real still-open temporary file older than cleanup cutoff")
	}

	// Execute the original admin cleanup against the real Local filesystem
	// while Local.Put's original destination file is still being written.
	cleaned, err := server.cleanupStorageCache(ctx, storageCleanupTemp)
	if err != nil {
		t.Fatalf("real admin temporary-cache cleanup failed: %v", err)
	}
	unblock()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf(
				"admin stale-temp cleanup destroyed an active upload: cleanup deleted=%d failed=%d temp=%q putErr=%v",
				cleaned.DeletedFiles, cleaned.FailedFiles, temporary.Key, err,
			)
		}
	case <-time.After(12 * time.Second):
		t.Fatal("active physical upload did not finish after cleanup")
	}
	complete, err := local.Open(ctx, key)
	if err != nil {
		t.Fatalf("completed upload disappeared after cleanup: %v", err)
	}
	defer complete.Close()
	got, err := io.ReadAll(complete)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, []byte("active-upload-head-tail")) {
		t.Fatalf("completed upload bytes were damaged: %q", got)
	}
	// A platform may reject deletion of open files; that is an accepted safe
	// outcome as long as the real active write finishes intact.
	if _, err := os.Stat(tempPath); err == nil {
		t.Fatalf("finished write left a stale temporary object at %q", temporary.Key)
	} else if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("unexpected stale temp status: %v", err)
	}
}
