package api

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type legacyDeleteSQLCounter struct {
	logger.Interface
	enabled atomic.Bool
	count   atomic.Int64
}

func (counter *legacyDeleteSQLCounter) Trace(
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

func (counter *legacyDeleteSQLCounter) start() {
	counter.count.Store(0)
	counter.enabled.Store(true)
}

func (counter *legacyDeleteSQLCounter) stop() int64 {
	counter.enabled.Store(false)
	return counter.count.Load()
}

type legacyDeleteTrackingStore struct {
	deleted []string
}

func (*legacyDeleteTrackingStore) Put(context.Context, string, io.Reader) (int64, error) {
	panic("Put must not be called by legacy delete cleanup")
}

func (*legacyDeleteTrackingStore) Open(context.Context, string) (*os.File, error) {
	panic("Open must not be called by legacy delete cleanup")
}

func (store *legacyDeleteTrackingStore) Delete(_ context.Context, key string) error {
	store.deleted = append(store.deleted, key)
	return nil
}

func TestDeleteLegacyStorageKeysBatchesReferenceLookup(t *testing.T) {
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

	schema := "legacy_delete_perf_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	counter := &legacyDeleteSQLCounter{Interface: logger.Discard}
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

	for _, statement := range []string{
		`CREATE TABLE xd_files (
			node_id bigint PRIMARY KEY,
			storage_key text NOT NULL
		)`,
		`CREATE TABLE xd_file_versions (
			id bigserial PRIMARY KEY,
			storage_key text NOT NULL
		)`,
		`CREATE INDEX idx_legacy_delete_files_storage_key ON xd_files(storage_key)`,
		`CREATE INDEX idx_legacy_delete_versions_storage_key ON xd_file_versions(storage_key)`,
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatal(err)
		}
	}

	const keyCount = 120
	keys := make([]string, 0, keyCount)
	for index := 0; index < keyCount; index++ {
		key := fmt.Sprintf("legacy/%03d.bin", index)
		keys = append(keys, key)
		switch {
		case index < 40:
			if err := db.Exec(
				"INSERT INTO xd_files(node_id, storage_key) VALUES (?, ?)",
				index+1,
				key,
			).Error; err != nil {
				t.Fatal(err)
			}
		case index < 80:
			if err := db.Exec(
				"INSERT INTO xd_file_versions(storage_key) VALUES (?)",
				key,
			).Error; err != nil {
				t.Fatal(err)
			}
		}
	}

	store := &legacyDeleteTrackingStore{}
	server := &Server{DB: db, Store: store}

	counter.start()
	server.deleteLegacyStorageKeys(context.Background(), keys)
	statementCount := counter.stop()

	if statementCount != 1 {
		t.Fatalf("legacy storage reference lookup SQL statements=%d want=1", statementCount)
	}
	if len(store.deleted) != 40 {
		t.Fatalf("legacy storage deletes=%d want=40", len(store.deleted))
	}
	for index, key := range store.deleted {
		want := keys[index+80]
		if key != want {
			t.Fatalf("deleted key %d=%q want=%q", index, key, want)
		}
	}

	largeKeys := make([]string, 0, 1201)
	for index := 0; index < 1201; index++ {
		largeKeys = append(largeKeys, fmt.Sprintf("large/%04d.bin", index))
	}
	counter.start()
	referenced, err := loadReferencedLegacyStorageKeys(context.Background(), db, largeKeys)
	largeStatementCount := counter.stop()
	if err != nil {
		t.Fatal(err)
	}
	if largeStatementCount != 3 {
		t.Fatalf("1,201-key legacy reference lookup SQL statements=%d want=3", largeStatementCount)
	}
	if len(referenced) != 0 {
		t.Fatalf("1,201-key unreferenced fixture returned references=%v", referenced)
	}
}
