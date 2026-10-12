package api

import (
	"context"
	"errors"

	"gorm.io/gorm"
)

// Fixed, repository-wide PostgreSQL advisory lock namespace for physical media
// derivative cache publication and administrator eviction. Writers use shared
// transactions so ordinary concurrent thumbnail generation is not serialized.
// Admin cleanup uses exclusive ownership across every Server replica attached
// to the same PostgreSQL database.
const mediaCacheAdvisoryLockID int64 = 0x7864726976656d31

func (s *Server) withMediaCacheAdvisoryLock(
	ctx context.Context,
	exclusive bool,
	work func(*gorm.DB) error,
) error {
	if s == nil || s.DB == nil {
		return errors.New("media cache advisory lock requires a database")
	}
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		statement := "SELECT pg_advisory_xact_lock_shared(?)"
		if exclusive {
			statement = "SELECT pg_advisory_xact_lock(?)"
		}
		if err := tx.Exec(statement, mediaCacheAdvisoryLockID).Error; err != nil {
			return err
		}
		return work(tx)
	})
}
