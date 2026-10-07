package api

import (
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestReleaseContentReferencesUsesBatchedSQL(t *testing.T) {
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

	schema := "content_release_perf_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	if err := db.AutoMigrate(&meta.ContentBlob{}); err != nil {
		t.Fatal(err)
	}

	const uniqueBlobs = 120
	blobs := make([]meta.ContentBlob, 0, uniqueBlobs)
	files := make([]meta.File, 0, uniqueBlobs)
	expectedDeleting := 0
	for index := 0; index < uniqueBlobs; index++ {
		hash := fmt.Sprintf("%064x", index+1)
		key, err := storage.ContentAddressedKey(hash)
		if err != nil {
			t.Fatal(err)
		}
		refCount := int64(2)
		if index%2 == 0 {
			refCount = 1
			expectedDeleting++
		}
		blobs = append(blobs, meta.ContentBlob{
			SHA256: hash, Size: int64(index + 1), StorageKey: key,
			RefCount: refCount, State: meta.ContentBlobStateReady,
		})
		files = append(files, meta.File{
			NodeID: uint64(index + 1), Size: int64(index + 1), StorageKey: key,
		})
	}
	if err := db.Create(&blobs).Error; err != nil {
		t.Fatal(err)
	}

	server := &Server{}
	var candidates []contentDeleteCandidate
	var legacy []string
	var statementCount int64
	if err := db.Transaction(func(tx *gorm.DB) error {
		counter.start()
		var releaseErr error
		candidates, legacy, releaseErr = server.releaseContentReferencesTx(tx, files, nil)
		statementCount = counter.stop()
		return releaseErr
	}); err != nil {
		t.Fatal(err)
	}
	if statementCount != 3 {
		t.Fatalf("content reference release used %d SQL statements; want exactly 3 for %d unique blobs", statementCount, uniqueBlobs)
	}
	if len(legacy) != 0 {
		t.Fatalf("legacy keys=%v want none", legacy)
	}
	if len(candidates) != expectedDeleting {
		t.Fatalf("delete candidates=%d want=%d", len(candidates), expectedDeleting)
	}

	var updated []meta.ContentBlob
	if err := db.Order("sha256 ASC").Find(&updated).Error; err != nil {
		t.Fatal(err)
	}
	if len(updated) != uniqueBlobs {
		t.Fatalf("content blobs=%d want=%d", len(updated), uniqueBlobs)
	}
	for index, blob := range updated {
		wantRefCount := int64(1)
		wantState := meta.ContentBlobStateReady
		if index%2 == 0 {
			wantRefCount = 0
			wantState = meta.ContentBlobStateDeleting
		}
		if blob.RefCount != wantRefCount || blob.State != wantState {
			t.Fatalf("blob %d ref/state=%d/%s want=%d/%s", index, blob.RefCount, blob.State, wantRefCount, wantState)
		}
	}
}
