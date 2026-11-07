package api

import (
	"errors"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

var errSourceUnsettledWrites = errors.New("source has unsettled uploads")

// Called while the Source row is locked by its lifecycle transaction.
// A queued RunRequestedAt is deliberately not treated as an active upload:
// archive clears the queued request without running it. The upload writers
// separately recheck Source revision and authorization in their write Tx.
func requireSourceNoUnsettledWritesTx(tx *gorm.DB, source meta.Source) error {
	if tx == nil || source.ID == 0 || source.OwnerID == 0 {
		return errSourceUnsettledWrites
	}
	now := time.Now().UTC()
	denyIfExists := func(query *gorm.DB) error {
		var count int64
		if err := query.Limit(1).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return errSourceUnsettledWrites
		}
		return nil
	}
	if tx.Migrator().HasTable(&meta.UploadSession{}) {
		// A SourceRun-only Pull upload can outlive the running Run row;
		// a native upload can instead carry exact Source/Target fields.
		where := "owner_id = ? AND status = ? AND expires_at > ? AND (source_id = ? OR source_run_id IN (SELECT id FROM xd_sync_runs WHERE source_id = ?))"
		args := []any{source.OwnerID, meta.UploadStatusActive, now, source.ID, source.ID}
		if source.TargetNodeID != nil {
			where = "owner_id = ? AND status = ? AND expires_at > ? AND (source_id = ? OR source_target_id = ? OR source_run_id IN (SELECT id FROM xd_sync_runs WHERE source_id = ?))"
			args = []any{source.OwnerID, meta.UploadStatusActive, now, source.ID, *source.TargetNodeID, source.ID}
		}
		if err := denyIfExists(tx.Model(&meta.UploadSession{}).Where(where, args...)); err != nil {
			return err
		}
	}
	if tx.Migrator().HasTable(&meta.LocalPushCommonUploadOperation{}) {
		if err := denyIfExists(tx.Model(&meta.LocalPushCommonUploadOperation{}).
			Where("owner_id = ? AND source_id = ? AND state IN ?", source.OwnerID, source.ID,
				[]string{meta.LocalPushCommonUploadReserved, meta.LocalPushCommonUploadBound})); err != nil {
			return err
		}
	}
	if tx.Migrator().HasTable(&meta.LocalPushOperationIntent{}) {
		if err := denyIfExists(tx.Model(&meta.LocalPushOperationIntent{}).
			Where("owner_id = ? AND source_id = ? AND state = ? AND expires_at > ?",
				source.OwnerID, source.ID, meta.LocalPushOperationIntentReserved, now)); err != nil {
			return err
		}
	}
	if tx.Migrator().HasTable(&meta.LocalPushStaging{}) {
		if err := denyIfExists(tx.Model(&meta.LocalPushStaging{}).
			Where("owner_id = ? AND source_id = ? AND status IN ? AND expires_at > ?",
				source.OwnerID, source.ID,
				[]string{localPushStageReserved, localPushStageWriting, localPushStageReady}, now)); err != nil {
			return err
		}
	}
	if tx.Migrator().HasTable(&meta.LocalPushQuotaHold{}) {
		if err := denyIfExists(tx.Model(&meta.LocalPushQuotaHold{}).
			Where("owner_id = ? AND source_id = ? AND released_at IS NULL AND committed_at IS NULL AND expires_at > ?",
				source.OwnerID, source.ID, now)); err != nil {
			return err
		}
	}
	return nil
}
