package api

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"errors"
	"fmt"
	"sync"
	"time"

	"gorm.io/gorm"
)

const (
	photoHostAdmissionLockName    = "photo-host:admission:v1"
	photoHostAdmissionSettingName = "photo-intelligence-host"
	photoHostAdmissionHeartbeat   = 5 * time.Second
)

// This shared PostgreSQL advisory lock is a SAFETY PRIMITIVE only. It is not
// yet attached to production Photo/Creative workloads, and no administrator
// or Host Manager path may currently write the frozen setting or stop models.
// Future work must acquire the same key EXCLUSIVELY during an audited freeze
// transaction, after attaching every model-dependent task admission path.
func photoHostAdmissionLockID() int64 {
	sum := sha256.Sum256([]byte(photoHostAdmissionLockName))
	return int64(binary.BigEndian.Uint64(sum[:8]))
}

type photoHostAdmissionLease struct {
	mu   sync.Mutex
	conn *sql.Conn
	key  int64
}

// tryAcquirePhotoHostAdmission uses ONE dedicated DB connection for both the
// shared advisory lock and the decision query. A concurrent writer following
// the same advisory-lock protocol cannot change the row while this lease
// is held. It does not reserve a new task or imply any global drain proof.
func tryAcquirePhotoHostAdmission(
	ctx context.Context,
	db *gorm.DB,
) (*photoHostAdmissionLease, bool, error) {
	if ctx == nil || db == nil || ctx.Err() != nil {
		return nil, false, errors.New("photo host admission database unavailable")
	}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, false, err
	}
	conn, err := sqlDB.Conn(ctx)
	if err != nil {
		return nil, false, err
	}
	key := photoHostAdmissionLockID()
	var acquired bool
	if err := conn.QueryRowContext(ctx, "SELECT pg_try_advisory_lock_shared($1)", key).
		Scan(&acquired); err != nil {
		_ = conn.Close()
		return nil, false, err
	}
	if !acquired {
		_ = conn.Close()
		return nil, false, nil
	}
	lease := &photoHostAdmissionLease{conn: conn, key: key}

	var revision int64
	var frozen bool
	err = conn.QueryRowContext(ctx, `SELECT revision, frozen FROM xd_photo_host_admission_gates WHERE name = $1`,
		photoHostAdmissionSettingName).Scan(&revision, &frozen)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		// Existing deployments have no operator-committed maintenance intent.
		// Continue normal workloads; this does not attest any stop readiness.
		return lease, true, nil
	case err != nil:
		lease.Close()
		return nil, false, err
	case revision <= 0 || revision >= 1<<60:
		lease.Close()
		return nil, false, fmt.Errorf("invalid photo host admission revision")
	case frozen:
		lease.Close()
		return nil, false, nil
	default:
		return lease, true, nil
	}
}

func (l *photoHostAdmissionLease) Heartbeat(ctx context.Context) error {
	if l == nil || ctx == nil {
		return errors.New("photo host admission lease unavailable")
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.conn == nil {
		return errors.New("photo host admission lease is closed")
	}
	pulseCtx, cancel := context.WithTimeout(ctx, photoHostAdmissionHeartbeat)
	defer cancel()
	var one int
	if err := l.conn.QueryRowContext(pulseCtx, "SELECT 1").Scan(&one); err != nil {
		return err
	}
	if one != 1 {
		return errors.New("photo host admission heartbeat invalid")
	}
	return nil
}

func (l *photoHostAdmissionLease) Close() {
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
	ctx, cancel := context.WithTimeout(context.Background(), photoHostAdmissionHeartbeat)
	defer cancel()
	var unlocked bool
	_ = conn.QueryRowContext(ctx, "SELECT pg_advisory_unlock_shared($1)", l.key).Scan(&unlocked)
	_ = conn.Close()
}
