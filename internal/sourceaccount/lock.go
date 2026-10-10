package sourceaccount

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
)

var ErrBusy = errors.New("source provider account is busy")

type Lease struct {
	mu   sync.Mutex
	conn *sql.Conn
	key  int64
}

func lockID(accountKey string) int64 {
	sum := sha256.Sum256([]byte(strings.TrimSpace(accountKey)))
	return int64(binary.BigEndian.Uint64(sum[:8]))
}

func Acquire(ctx context.Context, db *gorm.DB, accountKey string) (*Lease, error) {
	if db == nil || strings.TrimSpace(accountKey) == "" {
		return nil, fmt.Errorf("source account lock is not configured")
	}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	conn, err := sqlDB.Conn(ctx)
	if err != nil {
		return nil, err
	}
	key := lockID(accountKey)
	if _, err := conn.ExecContext(ctx, "SELECT pg_advisory_lock($1)", key); err != nil {
		_ = conn.Close()
		return nil, err
	}
	return &Lease{conn: conn, key: key}, nil
}

func TryAcquire(ctx context.Context, db *gorm.DB, accountKey string) (*Lease, bool, error) {
	if db == nil || strings.TrimSpace(accountKey) == "" {
		return nil, false, fmt.Errorf("source account lock is not configured")
	}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, false, err
	}
	conn, err := sqlDB.Conn(ctx)
	if err != nil {
		return nil, false, err
	}
	key := lockID(accountKey)
	var acquired bool
	if err := conn.QueryRowContext(ctx, "SELECT pg_try_advisory_lock($1)", key).Scan(&acquired); err != nil {
		_ = conn.Close()
		return nil, false, err
	}
	if !acquired {
		_ = conn.Close()
		return nil, false, nil
	}
	return &Lease{conn: conn, key: key}, true, nil
}

func IsHeld(
	ctx context.Context,
	db *gorm.DB,
	accountKey string,
) (bool, error) {
	if db == nil || strings.TrimSpace(accountKey) == "" {
		return false, fmt.Errorf("source account lock is not configured")
	}
	key := uint64(lockID(accountKey))
	classID := int64(uint32(key >> 32))
	objectID := int64(uint32(key))

	var held bool
	err := db.WithContext(ctx).Raw(`
		SELECT EXISTS (
			SELECT 1
			FROM pg_locks
			WHERE locktype = 'advisory'
			  AND granted
			  AND objsubid = 1
			  AND classid::bigint = ?
			  AND objid::bigint = ?
		)`,
		classID,
		objectID,
	).Scan(&held).Error
	return held, err
}

func (l *Lease) Heartbeat(ctx context.Context) error {
	if l == nil {
		return fmt.Errorf("source account lease is closed")
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.conn == nil {
		return fmt.Errorf("source account lease is closed")
	}
	heartbeatCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	var value int
	if err := l.conn.QueryRowContext(
		heartbeatCtx,
		"SELECT 1",
	).Scan(&value); err != nil {
		return err
	}
	if value != 1 {
		return fmt.Errorf("source account lease heartbeat returned %d", value)
	}
	return nil
}

func (l *Lease) Close() {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.conn == nil {
		return
	}
	conn := l.conn
	l.conn = nil
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var unlocked bool
	_ = conn.QueryRowContext(ctx, "SELECT pg_advisory_unlock($1)", l.key).Scan(&unlocked)
	_ = conn.Close()
}
