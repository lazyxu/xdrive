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

// This regression composes real PostgreSQL CAS hash advisory locks with
// Local's private STAGE OS shard. It proves a nonblocking SQL->stage OS
// admission and rollback ordering, NOT Source/Root authority or a data commit.
func TestLocalPushStagePostgresCASHashLockTryPinRollback(t *testing.T) {
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
	sqlDB.SetMaxOpenConns(4)

	root := t.TempDir()
	owner, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	writer, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	body := fmt.Sprintf("localpush-sql-stage-%s-%d", t.Name(), time.Now().UnixNano())
	digest := sha256.Sum256([]byte(body))
	hash := hex.EncodeToString(digest[:])
	key := localPushTestStageKey()
	if _, err := writer.Put(context.Background(), key, strings.NewReader(body)); err != nil {
		t.Fatal(err)
	}
	shard, ok, err := localPushStageShard(key)
	if err != nil || !ok {
		t.Fatalf("noncanonical stage test scope: shard=%q err=%v", shard, err)
	}
	release, err := writer.localPushStageShardLease(context.Background(), shard, true)
	if err != nil {
		t.Fatal(err)
	}
	held := true
	defer func() {
		if held {
			release()
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	lockCASHash := func(tx *gorm.DB) error {
		rows, err := tx.Raw("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", hash).Rows()
		if err != nil {
			return err
		}
		defer rows.Close()
		if !rows.Next() {
			return errors.New("SQL CAS advisory lock did not return a row")
		}
		return rows.Err()
	}
	peerTry := func() (bool, error) {
		var acquired bool
		err := db.WithContext(ctx).Raw(
			"SELECT pg_try_advisory_xact_lock(hashtextextended(?, 0))", hash,
		).Scan(&acquired).Error
		return acquired, err
	}

	expectRollback := errors.New("rollback busy staged bytes before any commit")
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockCASHash(tx); err != nil {
			return err
		}
		peer, err := peerTry()
		if err != nil || peer {
			return fmt.Errorf("competing SQL connection acquired held CAS hash: acquired=%t err=%v", peer, err)
		}
		tryCtx, stop := context.WithTimeout(ctx, 750*time.Millisecond)
		defer stop()
		file, acquired, err := owner.TryOpenPinnedLocalPushStage(tryCtx, key)
		if file != nil {
			_ = file.Close()
		}
		if err != nil || acquired || file != nil || tryCtx.Err() != nil {
			return fmt.Errorf("busy stage OS lock did not fail promptly: acquired=%t err=%v ctx=%v",
				acquired, err, tryCtx.Err())
		}
		return expectRollback
	})
	if !errors.Is(err, expectRollback) {
		t.Fatalf("stage OS contention did not rollback SQL CAS hash lock: %v", err)
	}
	if acquired, err := peerTry(); err != nil || !acquired {
		t.Fatalf("SQL advisory lock leaked after rejected stage pin: acquired=%t err=%v", acquired, err)
	}
	release()
	held = false

	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockCASHash(tx); err != nil {
			return err
		}
		file, acquired, err := owner.TryOpenPinnedLocalPushStage(ctx, key)
		if err != nil || !acquired || file == nil {
			return fmt.Errorf("uncontended stage OS read not admitted: acquired=%t err=%v", acquired, err)
		}
		stat, statErr := file.Stat()
		closeErr := file.Close()
		if statErr != nil || stat == nil || !stat.Mode().IsRegular() ||
			stat.Size() != int64(len(body)) || closeErr != nil {
			return fmt.Errorf("pinned stage metadata mismatch: stat=%v close=%v", statErr, closeErr)
		}
		// No physical hash, Source mutation, CAS write or token issued while
		// holding SQL locks. This is ONLY lock-order safety.
		return nil
	})
	if err != nil {
		t.Fatalf("SQL->temporary stage try pin did not complete: %v", err)
	}
	if err := writer.DeleteStaging(context.Background(), key); err != nil {
		t.Fatalf("stage OS lease leaked beyond SQL transaction: %v", err)
	}
}
