package storage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Exercise the actual PostgreSQL advisory hash lock and Local cross-process
// filesystem lock together. This is a READ-ONLY lock-order regression, not a
// Source identity writer or device authorization proof. No content is hashed
// under SQL locks.
func TestLocalCASPostgresHashLockNonblockingFilesystemAdmission(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	sqlDB.SetMaxOpenConns(4) // held transaction and independent peer

	root := t.TempDir()
	reader, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	writer, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	body := fmt.Sprintf("cas-order-%s-%d", t.Name(), time.Now().UnixNano())
	sum := sha256.Sum256([]byte(body))
	hash := hex.EncodeToString(sum[:])
	key, err := ContentAddressedKey(hash)
	if err != nil {
		t.Fatal(err)
	}
	if n, err := writer.Put(context.Background(), key, strings.NewReader(body)); err != nil || n != int64(len(body)) {
		t.Fatalf("canonical CAS fixture not admitted: size=%d err=%v", n, err)
	}

	// Model a writer owning the OS CAS lease before trying any SQL operation.
	release, err := writer.casLifecycleLease(context.Background(), hash, true)
	if err != nil {
		t.Fatal(err)
	}
	held := true
	defer func() {
		if held {
			release()
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	sqlHashLock := func(tx *gorm.DB) error {
		rows, err := tx.Raw("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", hash).Rows()
		if err != nil {
			return err
		}
		defer rows.Close()
		if !rows.Next() {
			return errors.New("PostgreSQL hash lock did not return a row")
		}
		return rows.Err()
	}
	peerTry := func() (bool, error) {
		var locked bool
		err := db.WithContext(ctx).Raw("SELECT pg_try_advisory_xact_lock(hashtextextended(?, 0))", hash).Scan(&locked).Error
		return locked, err
	}

	rollback := errors.New("expected SQL rollback on busy CAS OS lock")
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := sqlHashLock(tx); err != nil {
			return err
		}
		if locked, err := peerTry(); err != nil || locked {
			return fmt.Errorf("peer acquired held SQL CAS lock: acquired=%t err=%v", locked, err)
		}
		tryCtx, cancelTry := context.WithTimeout(ctx, 750*time.Millisecond)
		defer cancelTry()
		pinned, acquired, err := reader.TryOpenPinnedCAS(tryCtx, key)
		if pinned != nil {
			_ = pinned.Close()
		}
		if err != nil || acquired || pinned != nil || tryCtx.Err() != nil {
			return fmt.Errorf("OS CAS lock busy did not fail promptly: acquired=%t err=%v ctx=%v", acquired, err, tryCtx.Err())
		}
		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatalf("busy CAS was not rejected with a SQL rollback: %v", err)
	}
	if free, err := peerTry(); err != nil || !free {
		t.Fatalf("PostgreSQL CAS lock leaked past transaction rollback: free=%t err=%v", free, err)
	}
	release()
	held = false

	// Fresh SQL transaction may now take the OS shared pin. Only file metadata
	// is observed while SQL locks are held; no CAS hashing or business writes.
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := sqlHashLock(tx); err != nil {
			return err
		}
		pinned, acquired, err := reader.TryOpenPinnedCAS(ctx, key)
		if err != nil || !acquired || pinned == nil {
			return fmt.Errorf("uncontended SQL->OS CAS admission failed: acquired=%t err=%v", acquired, err)
		}
		info, statErr := pinned.Stat()
		closeErr := pinned.Close()
		if statErr != nil || info == nil || info.Size() != int64(len(body)) || closeErr != nil {
			return fmt.Errorf("private CAS lease did not expose a bounded regular file: stat=%v close=%v", statErr, closeErr)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("SQL->OS lock order did not complete: %v", err)
	}
	if err := writer.Delete(context.Background(), key); err != nil {
		t.Fatalf("shared filesystem CAS lock was not released: %v", err)
	}
}
