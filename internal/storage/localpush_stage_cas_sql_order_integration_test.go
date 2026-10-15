package storage

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// PostgreSQL CAS hash lock -> OS canonical CAS try-pin -> OS private stage
// try-pin must never wait for either competing writer. Failed admission
// rolls back SQL and releases any already-held filesystem pin. This is a
// storage-only regression and does not validate identity or commit content.
func TestLocalPushStageCASPairPostgresHashLockRollback(t *testing.T) {
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

	reader, writer, stageKey, casKey, body := makeLocalPushStageCASFixture(t)
	lockHash, ok := canonicalCASDigest(casKey)
	if !ok {
		t.Fatal("fixture CAS key is not canonical")
	}

	shard, ok, err := localPushStageShard(stageKey)
	if err != nil || !ok {
		t.Fatalf("invalid private stage key: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	lockSQLHash := func(tx *gorm.DB) error {
		rows, err := tx.Raw("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", lockHash).Rows()
		if err != nil {
			return err
		}
		defer rows.Close()
		if !rows.Next() {
			return errors.New("transaction CAS hash lock not acquired")
		}
		return rows.Err()
	}
	peerTry := func() (bool, error) {
		var free bool
		err := db.WithContext(ctx).Raw(
			"SELECT pg_try_advisory_xact_lock(hashtextextended(?, 0))", lockHash,
		).Scan(&free).Error
		return free, err
	}
	rollback := errors.New("rollback contested paired physical admission")
	assertRollback := func(why string) {
		t.Helper()
		err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if err := lockSQLHash(tx); err != nil {
				return err
			}
			if got, err := peerTry(); err != nil || got {
				return fmt.Errorf("%s: independent SQL connection acquired held lock: %t %v", why, got, err)
			}
			tryCtx, stop := context.WithTimeout(ctx, time.Second)
			defer stop()
			pair, acquired, err := reader.TryOpenPinnedLocalPushStageAndCAS(tryCtx, stageKey, casKey)
			if pair != nil {
				_ = pair.Close()
			}
			if err != nil || acquired || pair != nil || tryCtx.Err() != nil {
				return fmt.Errorf("%s: failed to reject busy OS lease promptly: acquired=%t err=%v ctx=%v",
					why, acquired, err, tryCtx.Err())
			}
			return rollback
		})
		if !errors.Is(err, rollback) {
			t.Fatalf("%s: rejected OS admission left SQL transaction successful/broken: %v", why, err)
		}
		if free, err := peerTry(); err != nil || !free {
			t.Fatalf("%s: rolled-back CAS hash lock not released: free=%t err=%v", why, free, err)
		}
	}

	casRelease, err := writer.casLifecycleLease(context.Background(), lockHash, true)
	if err != nil {
		t.Fatal(err)
	}
	casHeld := true
	defer func() {
		if casHeld {
			casRelease()
		}
	}()
	assertRollback("canonical CAS busy")
	casRelease()
	casHeld = false

	stageRelease, err := writer.localPushStageShardLease(context.Background(), shard, true)
	if err != nil {
		t.Fatal(err)
	}
	stageHeld := true
	defer func() {
		if stageHeld {
			stageRelease()
		}
	}()
	assertRollback("temporary stage busy")
	// Stage contention happens SECOND. The first CAS handle MUST have been
	// released so another writer can take its exclusive CAS lock now.
	leaseCtx, stop := context.WithTimeout(ctx, time.Second)
	otherCAS, err := writer.casLifecycleLease(leaseCtx, lockHash, true)
	if err != nil || leaseCtx.Err() != nil {
		t.Fatalf("partial OS admission left a leaked CAS pin: err=%v ctx=%v", err, leaseCtx.Err())
	}
	otherCAS()
	stop()
	stageRelease()
	stageHeld = false

	// After both blockers release, one SQL transaction can try-pin the
	// two regular inodes, inspect metadata only and relinquish every lock.
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockSQLHash(tx); err != nil {
			return err
		}
		if free, err := peerTry(); err != nil || free {
			return fmt.Errorf("competing SQL connection acquired live CAS hash: %t %v", free, err)
		}
		pair, acquired, err := reader.TryOpenPinnedLocalPushStageAndCAS(ctx, stageKey, casKey)
		if err != nil || !acquired || pair == nil {
			return fmt.Errorf("uncontended paired admission failed: acquired=%t err=%v", acquired, err)
		}
		stageInfo, casInfo, statErr := pair.Stat()
		closeErr := pair.Close()
		if statErr != nil || closeErr != nil || stageInfo == nil || casInfo == nil ||
			!stageInfo.Mode().IsRegular() || !casInfo.Mode().IsRegular() ||
			stageInfo.Size() <= 0 || casInfo.Size() != int64(len(body)) {
			return fmt.Errorf("paired regular inode metadata denied: stat=%v close=%v", statErr, closeErr)
		}
		// No content read/hash, Source/Root grant, CAS/SQL mutation or
		// authority token may be inferred from this test transaction.
		return nil
	})
	if err != nil {
		t.Fatalf("uncontended SQL+stage+CAS admission failed: %v", err)
	}
	if free, err := peerTry(); err != nil || !free {
		t.Fatalf("SQL advisory CAS lock leaked after successful transaction: free=%t err=%v", free, err)
	}
	if err := writer.DeleteStaging(context.Background(), stageKey); err != nil {
		t.Fatalf("paired stage OS lease leaked: %v", err)
	}
	if err := writer.Delete(context.Background(), casKey); err != nil {
		t.Fatalf("paired canonical CAS OS lease leaked: %v", err)
	}
}
