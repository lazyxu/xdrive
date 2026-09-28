package api

import (
	"context"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
)

const uploadReservationAdvisoryLock int64 = 0x584452495645 // "XDRIVE"

func (s *Server) reserveUploadCapacity(
	ctx context.Context,
	tx *gorm.DB,
	excludeSessionID string,
	requiredBytes int64,
) error {
	if requiredBytes < 0 {
		requiredBytes = 0
	}
	if _, ok := s.Store.(storage.CapacityReporter); !ok {
		return nil
	}
	if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", uploadReservationAdvisoryLock).Error; err != nil {
		return err
	}
	capacity, err := s.storageCapacity(ctx)
	if err != nil {
		return err
	}

	var reservedBytes int64
	q := tx.Model(&meta.UploadSession{}).
		Select("COALESCE(SUM(reserved_bytes), 0)").
		Where("status = ? AND expires_at > ? AND reserved_bytes > 0", meta.UploadStatusActive, time.Now())
	if excludeSessionID != "" {
		q = q.Where("id <> ?", excludeSessionID)
	}
	if err := q.Scan(&reservedBytes).Error; err != nil {
		return err
	}
	available := capacity.AvailableBytes - reservedBytes
	if available < 0 {
		available = 0
	}
	if requiredBytes > available {
		return &storageCapacityExceededError{
			RequiredBytes:  requiredBytes,
			AvailableBytes: available,
		}
	}
	return nil
}

func (s *Server) ensureStorageWriteCapacityWithReservations(
	ctx context.Context,
	requiredBytes int64,
	excludeSessionID string,
) error {
	if requiredBytes <= 0 {
		return nil
	}
	if _, ok := s.Store.(storage.CapacityReporter); !ok {
		return nil
	}
	capacity, err := s.storageCapacity(ctx)
	if err != nil {
		return err
	}
	var reservedBytes int64
	q := s.DB.WithContext(ctx).Model(&meta.UploadSession{}).
		Select("COALESCE(SUM(reserved_bytes), 0)").
		Where("status = ? AND expires_at > ? AND reserved_bytes > 0", meta.UploadStatusActive, time.Now())
	if excludeSessionID != "" {
		q = q.Where("id <> ?", excludeSessionID)
	}
	if err := q.Scan(&reservedBytes).Error; err != nil {
		return err
	}
	available := capacity.AvailableBytes - reservedBytes
	if available < 0 {
		available = 0
	}
	if requiredBytes > available {
		return &storageCapacityExceededError{
			RequiredBytes:  requiredBytes,
			AvailableBytes: available,
		}
	}
	return nil
}

func uploadReservationBytes(totalSize int64, parts []meta.UploadPart) int64 {
	return resumableUploadRemainingPeakBytes(totalSize, parts)
}

func (s *Server) refreshUploadReservation(tx *gorm.DB, session meta.UploadSession) error {
	var parts []meta.UploadPart
	if err := tx.Where("session_id = ?", session.ID).Find(&parts).Error; err != nil {
		return err
	}
	return tx.Model(&meta.UploadSession{}).
		Where("id = ? AND status = ?", session.ID, meta.UploadStatusActive).
		Update("reserved_bytes", uploadReservationBytes(session.TotalSize, parts)).Error
}
