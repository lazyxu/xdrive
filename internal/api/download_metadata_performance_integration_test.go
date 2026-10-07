package api

import (
	"context"
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

type downloadMetadataSQLCounter struct {
	logger.Interface
	enabled atomic.Bool
	count   atomic.Int64
}

func (counter *downloadMetadataSQLCounter) Trace(
	ctx context.Context,
	begin time.Time,
	fc func() (string, int64),
	err error,
) {
	if counter.enabled.Load() {
		counter.count.Add(1)
	}
	counter.Interface.Trace(ctx, begin, fc, err)
}

func (counter *downloadMetadataSQLCounter) start() {
	counter.count.Store(0)
	counter.enabled.Store(true)
}

func (counter *downloadMetadataSQLCounter) stop() int64 {
	counter.enabled.Store(false)
	return counter.count.Load()
}

func TestDownloadMetadataUsesSingleOwnerScopedQuery(t *testing.T) {
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

	schema := "download_metadata_perf_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	counter := &downloadMetadataSQLCounter{Interface: logger.Discard}
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

	if err := db.AutoMigrate(
		&meta.User{},
		&meta.Node{},
		&meta.File{},
		&meta.FileVersion{},
	); err != nil {
		t.Fatal(err)
	}

	owner := meta.User{
		Username:       "download-metadata-owner",
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{
		Name:     "",
		Type:     meta.NodeTypeDir,
		OwnerID:  owner.ID,
		Revision: 1,
	}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	rootID := root.ID
	node := meta.Node{
		ParentID: &rootID,
		Name:     "payload.bin",
		Type:     meta.NodeTypeFile,
		OwnerID:  owner.ID,
		Revision: 7,
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	currentUpdated := time.Date(2026, 10, 7, 12, 30, 0, 0, time.UTC)
	current := meta.File{
		NodeID:     node.ID,
		Size:       123,
		StorageKey: "current-key",
		SHA256:     strings.Repeat("a", 64),
		UpdatedAt:  currentUpdated,
	}
	if err := db.Create(&current).Error; err != nil {
		t.Fatal(err)
	}
	versionCreated := time.Date(2026, 10, 6, 11, 15, 0, 0, time.UTC)
	version := meta.FileVersion{
		NodeID:     node.ID,
		Revision:   6,
		Size:       120,
		StorageKey: "version-key",
		SHA256:     strings.Repeat("b", 64),
		CreatedAt:  versionCreated,
	}
	if err := db.Create(&version).Error; err != nil {
		t.Fatal(err)
	}

	counter.start()
	currentMetadata, err := loadCurrentFileDownloadMetadata(
		context.Background(),
		db,
		owner.ID,
		node.ID,
	)
	currentQueries := counter.stop()
	if err != nil {
		t.Fatal(err)
	}
	if currentQueries != 1 {
		t.Fatalf("current download metadata SQL queries=%d want=1", currentQueries)
	}
	if currentMetadata.Name != node.Name ||
		currentMetadata.Revision != node.Revision ||
		currentMetadata.StorageKey != current.StorageKey ||
		currentMetadata.SHA256 != current.SHA256 ||
		!currentMetadata.UpdatedAt.Equal(currentUpdated) {
		t.Fatalf("current download metadata=%+v", currentMetadata)
	}

	counter.start()
	versionMetadata, err := loadFileVersionDownloadMetadata(
		context.Background(),
		db,
		owner.ID,
		node.ID,
		version.ID,
	)
	versionQueries := counter.stop()
	if err != nil {
		t.Fatal(err)
	}
	if versionQueries != 1 {
		t.Fatalf("version download metadata SQL queries=%d want=1", versionQueries)
	}
	if versionMetadata.Name != node.Name ||
		!versionMetadata.VersionFound ||
		versionMetadata.StorageKey != version.StorageKey ||
		versionMetadata.SHA256 != version.SHA256 ||
		!versionMetadata.CreatedAt.Equal(versionCreated) {
		t.Fatalf("version download metadata=%+v", versionMetadata)
	}

	other := meta.User{
		Username:       "download-metadata-other",
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	missingVersion, err := loadFileVersionDownloadMetadata(
		context.Background(),
		db,
		owner.ID,
		node.ID,
		version.ID+999,
	)
	if err != nil {
		t.Fatal(err)
	}
	if missingVersion.VersionFound {
		t.Fatalf("missing version metadata=%+v want VersionFound=false", missingVersion)
	}
	if missingVersion.Name != node.Name {
		t.Fatalf("missing version file name=%q want=%q", missingVersion.Name, node.Name)
	}

	if _, err := loadCurrentFileDownloadMetadata(
		context.Background(),
		db,
		other.ID,
		node.ID,
	); err != gorm.ErrRecordNotFound {
		t.Fatalf("cross-owner current metadata err=%v want record not found", err)
	}
	if _, err := loadFileVersionDownloadMetadata(
		context.Background(),
		db,
		other.ID,
		node.ID,
		version.ID,
	); err != gorm.ErrRecordNotFound {
		t.Fatalf("cross-owner version metadata err=%v want record not found", err)
	}
}
