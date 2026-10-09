package api

import (
	"errors"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/synology"
	"gorm.io/gorm"
)

// L01-A is intentionally fail-closed: ordinary local folders must not become
// active until the device-binding and native execution protocol is implemented.
// Synology and pull connector activation behavior remains unchanged.
var errLocalFolderNotReady = errors.New("local folder device binding and executor unavailable")

func requireSourceReadyForActivation(tx *gorm.DB, source meta.Source) error {
	if source.Kind == meta.SourceKindLocalFolder {
		return errLocalFolderNotReady
	}
	if !sourceUsesStoredCredential(source) {
		return nil
	}
	if source.TargetNodeID == nil || *source.TargetNodeID == 0 {
		return errSourceCredentialRequired
	}
	var credentialCount int64
	if err := tx.Model(&meta.SourceCredential{}).Where("source_id = ?", source.ID).Count(&credentialCount).Error; err != nil {
		return err
	}
	if credentialCount == 0 {
		return errSourceCredentialRequired
	}
	if !sourceRequiresConnectorConfig(source) {
		return nil
	}
	var config meta.SourceConnectorConfig
	if err := tx.Where("source_id = ?", source.ID).First(&config).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errSourceConnectorConfigRequired
		}
		return err
	}
	if _, err := synology.ParseFilePullConfig([]byte(config.Payload)); err != nil {
		return errSourceConnectorConfigRequired
	}
	return nil
}
