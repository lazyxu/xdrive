package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	errIOSPhotoDestinationDenied    = errors.New("ios photo destination device denied")
	errIOSPhotoDestinationUntrusted = errors.New("ios photo destination binding untrusted")
)

func iosPhotoDestinationSource(source meta.Source) bool {
	return source.Kind == meta.SourceKindIOSPhotos &&
		source.Direction == meta.SourceDirectionPush &&
		source.SyncMode == meta.SourceSyncModeBackup &&
		source.Status == meta.SourceStatusPaused
}

func suggestedIOSPhotoDestinationName(deviceName string) string {
	candidate := strings.TrimSpace(deviceName)
	if !meta.ValidSourceName(candidate) || meta.ValidateName(candidate) != nil {
		return "iPhone"
	}
	return candidate
}

// Native iPhone identity credentials remain prohibited from ordinary
// local_folder Source/Root execution. This narrowly scoped proof authorizes
// destination provisioning ONLY with an already-valid Owner login session.
func iosPhotoDestinationDeviceTx(c *gin.Context, tx *gorm.DB, uid uint64) (meta.ClientDevice, error) {
	parsed, err := uuid.Parse(strings.TrimSpace(c.GetHeader("X-XDrive-Device-ID")))
	if err != nil || uid == 0 {
		return meta.ClientDevice{}, errIOSPhotoDestinationDenied
	}
	var device meta.ClientDevice
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND owner_id = ?", parsed.String(), uid).
		Take(&device).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return meta.ClientDevice{}, errIOSPhotoDestinationDenied
		}
		return meta.ClientDevice{}, err
	}
	if device.Platform != "ios" ||
		!clientDeviceIdentityCredentialMatches(device, c.GetHeader("X-XDrive-Device-Token")) {
		return meta.ClientDevice{}, errIOSPhotoDestinationDenied
	}
	return device, nil
}

// A Source binding is an exact Server-owned Node relationship, never inferred
// from an existing directory name or a device-supplied target_node_id.
func iosPhotoDestinationBindingTx(tx *gorm.DB, device meta.ClientDevice) (meta.Source, meta.Node, error) {
	var sources []meta.Source
	if err := tx.Where("owner_id = ? AND kind = ? AND direction = ? AND device_id = ?",
		device.OwnerID, meta.SourceKindIOSPhotos, meta.SourceDirectionPush, device.ID).
		Order("id ASC").Limit(2).Find(&sources).Error; err != nil {
		return meta.Source{}, meta.Node{}, err
	}
	if len(sources) == 0 {
		return meta.Source{}, meta.Node{}, gorm.ErrRecordNotFound
	}
	if len(sources) != 1 {
		return meta.Source{}, meta.Node{}, errIOSPhotoDestinationUntrusted
	}
	source := sources[0]
	if !iosPhotoDestinationSource(source) || !source.TargetManaged ||
		source.TargetNodeID == nil || *source.TargetNodeID == 0 ||
		source.DeviceID == nil || *source.DeviceID != device.ID ||
		!meta.ValidSourceName(source.Name) {
		return meta.Source{}, meta.Node{}, errIOSPhotoDestinationUntrusted
	}
	var target meta.Node
	if err := tx.Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
		*source.TargetNodeID, device.OwnerID, meta.NodeTypeDir).Take(&target).Error; err != nil {
		return meta.Source{}, meta.Node{}, errIOSPhotoDestinationUntrusted
	}
	if target.Name != source.Name || target.ParentID == nil {
		return meta.Source{}, meta.Node{}, errIOSPhotoDestinationUntrusted
	}
	groupName, err := managedPushDeviceFolderName(device)
	if err != nil {
		return meta.Source{}, meta.Node{}, errIOSPhotoDestinationUntrusted
	}
	var group meta.Node
	if err := tx.Where("id = ? AND owner_id = ? AND name = ? AND type = ? AND deleted_at IS NULL",
		*target.ParentID, device.OwnerID, groupName, meta.NodeTypeDir).
		Take(&group).Error; err != nil {
		return meta.Source{}, meta.Node{}, errIOSPhotoDestinationUntrusted
	}
	if _, err := managedSourceTargetAncestorIDsTx(tx, source, target); err != nil {
		return meta.Source{}, meta.Node{}, errIOSPhotoDestinationUntrusted
	}
	return source, target, nil
}

func (s *Server) iosPhotoDestinationResponse(c *gin.Context, device meta.ClientDevice,
	source meta.Source, target meta.Node, status int) {
	path, err := s.logicalPath(target)
	if err != nil || path == "" {
		fail(c, http.StatusConflict, "managed destination path unavailable")
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.JSON(status, gin.H{
		"configured":     true,
		"source_id":      source.ID,
		"device_id":      device.ID,
		"name":           source.Name,
		"target_node_id": target.ID,
		"target_path":    path,
	})
}

func (s *Server) getIOSPhotoBackupDestination(c *gin.Context) {
	owner, ok := currentUser(c)
	if !ok || owner.ID == 0 || owner.DisabledAt != nil || owner.MustChangePassword {
		fail(c, http.StatusForbidden, "verified owner required")
		return
	}
	var device meta.ClientDevice
	var source meta.Source
	var target meta.Node
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var err error
		device, err = iosPhotoDestinationDeviceTx(c, tx, owner.ID)
		if err != nil {
			return err
		}
		source, target, err = iosPhotoDestinationBindingTx(tx, device)
		return err
	})
	if errors.Is(err, errIOSPhotoDestinationDenied) {
		fail(c, http.StatusForbidden, "registered ios device required")
		return
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.Header("Cache-Control", "private, no-store")
		c.JSON(http.StatusOK, gin.H{
			"configured":     false,
			"suggested_name": suggestedIOSPhotoDestinationName(device.Name),
			"device_id":      device.ID,
		})
		return
	}
	if err != nil {
		fail(c, http.StatusConflict, "ios photo destination could not be verified")
		return
	}
	s.iosPhotoDestinationResponse(c, device, source, target, http.StatusOK)
}

func (s *Server) putIOSPhotoBackupDestination(c *gin.Context) {
	owner, ok := currentUser(c)
	if !ok || owner.ID == 0 || owner.DisabledAt != nil || owner.MustChangePassword {
		fail(c, http.StatusForbidden, "verified owner required")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var request struct{ Name string }
	if decoder.Decode(&request) != nil {
		fail(c, http.StatusBadRequest, "invalid destination folder name")
		return
	}
	var trailing any
	if decoder.Decode(&trailing) != io.EOF {
		fail(c, http.StatusBadRequest, "unexpected destination request data")
		return
	}
	name := strings.TrimSpace(request.Name)
	if !meta.ValidSourceName(name) || meta.ValidateName(name) != nil {
		fail(c, http.StatusBadRequest, "destination requires one valid folder name")
		return
	}
	var device meta.ClientDevice
	var source meta.Source
	var target meta.Node
	created := false
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var lockedUser meta.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND session_version = ?", owner.ID, owner.SessionVersion).
			Take(&lockedUser).Error; err != nil {
			return errIOSPhotoDestinationDenied
		}
		if lockedUser.DisabledAt != nil || lockedUser.MustChangePassword {
			return errIOSPhotoDestinationDenied
		}
		var err error
		device, err = iosPhotoDestinationDeviceTx(c, tx, owner.ID)
		if err != nil {
			return err
		}
		source, target, err = iosPhotoDestinationBindingTx(tx, device)
		if err == nil {
			// 5B: rename the Source and real managed Node atomically. A folder
			// ID is durable; no client-constructed cloud path is accepted.
			if source.Name == name {
				return nil
			}
			if err := renameManagedSourceTargetTx(tx, source, name); err != nil {
				return err
			}
			result := tx.Model(&meta.Source{}).
				Where("id = ? AND owner_id = ? AND revision = ?", source.ID, owner.ID, source.Revision).
				Updates(map[string]any{
					"name": name, "revision": gorm.Expr("revision + 1"), "updated_at": time.Now().UTC(),
				})
			if result.Error != nil || result.RowsAffected != 1 {
				return errIOSPhotoDestinationUntrusted
			}
			source.Name = name
			source.Revision++
			target.Name = name
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		creatorID := device.ID
		source = meta.Source{
			OwnerID: owner.ID, Name: name, Kind: meta.SourceKindIOSPhotos,
			Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
			RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusPaused,
			Revision: 1, DeviceID: &creatorID, LocalCreatorDeviceID: &creatorID,
		}
		if err := tx.Create(&source).Error; err != nil {
			return err
		}
		target, err = createLocalPushManagedTargetTx(c.Request.Context(), tx, source, device)
		if err != nil {
			return err
		}
		result := tx.Model(&meta.Source{}).
			Where("id = ? AND owner_id = ?", source.ID, owner.ID).
			Updates(map[string]any{"target_node_id": target.ID, "target_managed": true})
		if result.Error != nil || result.RowsAffected != 1 {
			return errIOSPhotoDestinationUntrusted
		}
		source.TargetNodeID = &target.ID
		source.TargetManaged = true
		created = true
		return nil
	})
	if err != nil {
		switch {
		case errors.Is(err, errIOSPhotoDestinationDenied):
			fail(c, http.StatusForbidden, "registered ios device and current owner required")
		case errors.Is(err, errSourceManagedDirectoryOccupied),
			errors.Is(err, errSourceManagedAncestorInUse),
			errors.Is(err, errSourceTargetNameConflict),
			errors.Is(err, errSourceTargetMigrationRequired),
			errors.Is(err, errIOSPhotoDestinationUntrusted), isDuplicate(err):
			fail(c, http.StatusConflict, "backup destination conflicts with an existing managed target")
		default:
			fail(c, http.StatusInternalServerError, "provision ios photo destination failed")
		}
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	s.iosPhotoDestinationResponse(c, device, source, target, status)
}
