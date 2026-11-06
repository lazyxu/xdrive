package api

import (
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/synology"
	"gorm.io/gorm"
)

// Local-folder activation remains fail-closed without a proven executor.
// DSM Push additionally requires a live Device, Root and managed target.
var errLocalFolderNotReady = errors.New("local folder device binding and executor unavailable")
var errSynologyPushNotReady = errors.New("Synology Photos Push requires an enrolled Device and verified Root binding")
var errSynologyPushBackupOnly = errors.New("Synology Photos Push supports backup mode only")

func requireSourceReadyForActivation(tx *gorm.DB, source meta.Source) error {
	if meta.SynologyPullTemporarilyDisabled(source.Kind, source.Direction) {
		return errSynologyPullDisabled
	}
	// The dedicated DSM Photos Push executor is retired. Even a historical
	// fully bound Source cannot be reactivated through a generic Owner update.
	if source.Kind == synologySourceKind && source.Direction == meta.SourceDirectionPush {
		return errSynologyPushNotReady
	}
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

// requireSynologyPushSourceReadyForActivation validates persisted enrollment
// state for Owner-initiated resume. It does not impersonate the NAS: every
// actual SourceRun and content mutation still requires live Device/Root proof.
func requireSynologyPushSourceReadyForActivation(tx *gorm.DB, source meta.Source) error {
	if tx == nil || source.DeviceID == nil || strings.TrimSpace(*source.DeviceID) == "" ||
		!source.TargetManaged || source.TargetNodeID == nil || *source.TargetNodeID == 0 {
		return errSynologyPushNotReady
	}
	var device meta.ClientDevice
	if err := tx.Where("id = ? AND owner_id = ? AND platform = ? AND revoked_at IS NULL",
		*source.DeviceID, source.OwnerID, "synology").Take(&device).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errSynologyPushNotReady
		}
		return err
	}
	if strings.TrimSpace(device.CredentialHash) == "" {
		return errSynologyPushNotReady
	}
	var binding meta.LocalSourceBinding
	if err := tx.Where("source_id = ? AND owner_id = ? AND device_id = ?",
		source.ID, source.OwnerID, device.ID).Take(&binding).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errSynologyPushNotReady
		}
		return err
	}
	if _, err := uuid.Parse(binding.RootID); err != nil ||
		!validSHA256(binding.RootFingerprint) ||
		binding.RootFingerprint != strings.ToLower(binding.RootFingerprint) {
		return errSynologyPushNotReady
	}
	var target meta.Node
	if err := tx.Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
		*source.TargetNodeID, source.OwnerID, meta.NodeTypeDir).Take(&target).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errSynologyPushNotReady
		}
		return err
	}
	return nil
}
