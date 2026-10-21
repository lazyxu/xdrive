package meta

import (
	"errors"
	"fmt"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// PWAOfflineInstance binds a browser's explicitly opted-in metadata snapshots
// to one durable xDrive PostgreSQL installation (not a Go process or build).
// This UUID is an identifier, NOT an authentication secret.
type PWAOfflineInstance struct {
	Slot       uint8  `gorm:"primaryKey;autoIncrement:false"`
	InstanceID string `gorm:"type:varchar(36);not null"`
}

func (PWAOfflineInstance) TableName() string { return "xd_pwa_offline_instance" }

// EnsurePWAOfflineInstanceID is safe under concurrent Server starts sharing a
// database. Restoring the same DB preserves its identity; initializing a new
// database allocates a new one. Missing/corrupt identities fail closed.
func EnsurePWAOfflineInstanceID(db *gorm.DB) (string, error) {
	if db == nil {
		return "", errors.New("PWA offline instance database unavailable")
	}
	candidate := PWAOfflineInstance{Slot: 1, InstanceID: uuid.NewString()}
	if err := db.Clauses(clause.OnConflict{DoNothing: true}).Create(&candidate).Error; err != nil {
		return "", fmt.Errorf("create PWA offline instance identity: %w", err)
	}
	var stored PWAOfflineInstance
	if err := db.Where("slot = ?", 1).Take(&stored).Error; err != nil {
		return "", fmt.Errorf("read PWA offline instance identity: %w", err)
	}
	parsed, err := uuid.Parse(stored.InstanceID)
	if err != nil || parsed.Version() != 4 || stored.InstanceID != parsed.String() {
		return "", errors.New("PWA offline instance identity invalid")
	}
	return stored.InstanceID, nil
}
