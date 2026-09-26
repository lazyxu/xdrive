package sourcecredential

import (
	"context"
	"errors"
	"fmt"

	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type VersionCount struct {
	KeyVersion uint32
	Count      int64
}

type RewrapReport struct {
	ActiveVersion uint32
	Scanned       int64
	Rewrapped     int64
	AlreadyActive int64
}

func Put(ctx context.Context, db *gorm.DB, keyring *connectorsecret.Keyring, source meta.Source, plaintext []byte) error {
	if db == nil || keyring == nil {
		return fmt.Errorf("source credential storage is unavailable")
	}
	if source.ID == 0 || source.Kind == "" {
		return fmt.Errorf("source id and kind are required")
	}
	version, ciphertext, err := keyring.Seal(source.ID, source.Kind, plaintext)
	if err != nil {
		return err
	}
	row := meta.SourceCredential{
		SourceID: source.ID, Ciphertext: ciphertext, KeyVersion: version,
	}
	return db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "source_id"}},
		DoUpdates: clause.Assignments(map[string]any{
			"ciphertext":  row.Ciphertext,
			"key_version": row.KeyVersion,
			"updated_at":  gorm.Expr("CURRENT_TIMESTAMP"),
		}),
	}).Create(&row).Error
}

func Get(ctx context.Context, db *gorm.DB, keyring *connectorsecret.Keyring, source meta.Source) ([]byte, error) {
	if db == nil || keyring == nil {
		return nil, fmt.Errorf("source credential storage is unavailable")
	}
	if source.ID == 0 || source.Kind == "" {
		return nil, fmt.Errorf("source id and kind are required")
	}
	var row meta.SourceCredential
	if err := db.WithContext(ctx).Where("source_id = ?", source.ID).First(&row).Error; err != nil {
		return nil, err
	}
	return keyring.Open(source.ID, source.Kind, row.KeyVersion, row.Ciphertext)
}

func Delete(ctx context.Context, db *gorm.DB, sourceID uint64) error {
	if db == nil {
		return fmt.Errorf("source credential storage is unavailable")
	}
	if sourceID == 0 {
		return fmt.Errorf("source id is required")
	}
	return db.WithContext(ctx).Where("source_id = ?", sourceID).Delete(&meta.SourceCredential{}).Error
}

func Status(ctx context.Context, db *gorm.DB) ([]VersionCount, error) {
	if db == nil {
		return nil, fmt.Errorf("source credential storage is unavailable")
	}
	var rows []VersionCount
	if err := db.WithContext(ctx).
		Model(&meta.SourceCredential{}).
		Select("key_version, COUNT(*) AS count").
		Group("key_version").
		Order("key_version ASC").
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

func RewrapAll(ctx context.Context, db *gorm.DB, keyring *connectorsecret.Keyring, dryRun bool) (RewrapReport, error) {
	report := RewrapReport{}
	if db == nil || keyring == nil {
		return report, fmt.Errorf("source credential storage is unavailable")
	}
	report.ActiveVersion = keyring.ActiveVersion()

	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var rows []meta.SourceCredential
		if err := tx.Order("source_id ASC").Find(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			if err := ctx.Err(); err != nil {
				return err
			}
			report.Scanned++
			if row.KeyVersion == report.ActiveVersion {
				report.AlreadyActive++
				continue
			}
			var source meta.Source
			if err := tx.Where("id = ?", row.SourceID).First(&source).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return fmt.Errorf("credential source %d is missing", row.SourceID)
				}
				return err
			}
			plaintext, err := keyring.Open(source.ID, source.Kind, row.KeyVersion, row.Ciphertext)
			if err != nil {
				return fmt.Errorf("source %d credential: %w", source.ID, err)
			}
			if dryRun {
				report.Rewrapped++
				continue
			}
			version, ciphertext, err := keyring.Seal(source.ID, source.Kind, plaintext)
			if err != nil {
				return err
			}
			result := tx.Model(&meta.SourceCredential{}).
				Where("source_id = ? AND key_version = ? AND ciphertext = ?", row.SourceID, row.KeyVersion, row.Ciphertext).
				Updates(map[string]any{
					"ciphertext":  ciphertext,
					"key_version": version,
					"updated_at":  gorm.Expr("CURRENT_TIMESTAMP"),
				})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return fmt.Errorf("source %d credential changed during rewrap", row.SourceID)
			}
			report.Rewrapped++
		}
		return nil
	})
	return report, err
}
