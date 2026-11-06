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
	errAndroidPhotoDestinationDenied = errors.New("Android photo destination Device/Owner denied")
	errAndroidPhotoDestinationUntrusted = errors.New("Android photo destination Source binding invalid")
)

// A native Android Device credential proves identity only. It cannot be used
// as a Desktop local_folder executor or a generic Owner upload capability.
func androidPhotoDestinationDeviceTx(c *gin.Context, tx *gorm.DB, ownerID uint64) (meta.ClientDevice, error) {
	deviceID, err := uuid.Parse(strings.TrimSpace(c.GetHeader("X-XDrive-Device-ID")))
	if err != nil || ownerID == 0 {
		return meta.ClientDevice{}, errAndroidPhotoDestinationDenied
	}
	var device meta.ClientDevice
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND owner_id = ? AND platform = ?", deviceID.String(), ownerID, "android").
		Take(&device).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return meta.ClientDevice{}, errAndroidPhotoDestinationDenied
		}
		return meta.ClientDevice{}, err
	}
	if !clientDeviceIdentityCredentialMatches(device, c.GetHeader("X-XDrive-Device-Token")) {
		return meta.ClientDevice{}, errAndroidPhotoDestinationDenied
	}
	return device, nil
}

// Never infer a managed Source from folder name or an Owner-chosen node ID.
// A missing, legacy, cross-Owner or multiply bound Source fails closed.
func androidPhotoDestinationBindingTx(tx *gorm.DB, device meta.ClientDevice) (meta.Source, meta.Node, error) {
	var sources []meta.Source
	if err := tx.Where("owner_id = ? AND kind = ? AND direction = ? AND device_id = ?",
		device.OwnerID, meta.SourceKindAndroidPhotos, meta.SourceDirectionPush, device.ID).
		Order("id ASC").Limit(2).Find(&sources).Error; err != nil {
		return meta.Source{}, meta.Node{}, err
	}
	if len(sources) == 0 {
		return meta.Source{}, meta.Node{}, gorm.ErrRecordNotFound
	}
	if len(sources) != 1 {
		return meta.Source{}, meta.Node{}, errAndroidPhotoDestinationUntrusted
	}
	source := sources[0]
	boundDeviceID, ok := meta.SourceDeviceID(source)
	if !ok || boundDeviceID != device.ID ||
		source.Kind != meta.SourceKindAndroidPhotos ||
		source.Direction != meta.SourceDirectionPush ||
		source.SyncMode != meta.SourceSyncModeBackup ||
		source.Status != meta.SourceStatusPaused ||
		!source.TargetManaged || source.TargetNodeID == nil ||
		*source.TargetNodeID == 0 || !meta.ValidSourceName(source.Name) {
		return meta.Source{}, meta.Node{}, errAndroidPhotoDestinationUntrusted
	}
	var target meta.Node
	if err := tx.Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
		*source.TargetNodeID, source.OwnerID, meta.NodeTypeDir).Take(&target).Error; err != nil {
		return meta.Source{}, meta.Node{}, errAndroidPhotoDestinationUntrusted
	}
	if target.Name != source.Name || target.ParentID == nil {
		return meta.Source{}, meta.Node{}, errAndroidPhotoDestinationUntrusted
	}
	if _, err := managedSourceTargetAncestorIDsTx(tx, source, target); err != nil {
		return meta.Source{}, meta.Node{}, errAndroidPhotoDestinationUntrusted
	}
	return source, target, nil
}

func (s *Server) androidPhotoDestinationResponse(c *gin.Context, device meta.ClientDevice,
	source meta.Source, target meta.Node, status int) {
	targetPath, err := s.logicalPath(target)
	if err != nil || targetPath == "" {
		fail(c, http.StatusConflict, "Android photo target path unavailable")
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.JSON(status, gin.H{
		"configured": true, "source_id": source.ID,
		"source_revision": source.Revision, "device_id": device.ID,
		"name": source.Name, "target_node_id": target.ID, "target_path": targetPath,
	})
}

func (s *Server) getAndroidPhotoBackupDestination(c *gin.Context) {
	owner, ok := currentUser(c)
	if !ok || owner.ID == 0 || owner.DisabledAt != nil || owner.MustChangePassword {
		fail(c, http.StatusForbidden, "current verified Owner required")
		return
	}
	var device meta.ClientDevice
	var source meta.Source
	var target meta.Node
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var err error
		device, err = androidPhotoDestinationDeviceTx(c, tx, owner.ID)
		if err != nil {
			return err
		}
		source, target, err = androidPhotoDestinationBindingTx(tx, device)
		return err
	})
	switch {
	case errors.Is(err, errAndroidPhotoDestinationDenied):
		fail(c, http.StatusForbidden, "registered Android Device credential required")
	case errors.Is(err, gorm.ErrRecordNotFound):
		c.Header("Cache-Control", "private, no-store")
		c.JSON(http.StatusOK, gin.H{
			"configured": false, "device_id": device.ID,
			"suggested_name": managedTargetSuggestion(device.Name, "Android"),
		})
	case err != nil:
		fail(c, http.StatusConflict, "Android photo Source binding unavailable")
	default:
		s.androidPhotoDestinationResponse(c, device, source, target, http.StatusOK)
	}
}

// PUT is a narrowly scoped Owner+Android-Device provisioning or rename action,
// not permission to upload into an arbitrary Owner folder. UploadSession writes
// must separately authenticate SourceID/Revision/DeviceID/TargetID per transaction.
func (s *Server) putAndroidPhotoBackupDestination(c *gin.Context) {
	owner, ok := currentUser(c)
	if !ok || owner.ID == 0 || owner.DisabledAt != nil || owner.MustChangePassword {
		fail(c, http.StatusForbidden, "current verified Owner required")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	dec := json.NewDecoder(c.Request.Body)
	dec.DisallowUnknownFields()
	var req struct { Name string `json:"name"` }
	if dec.Decode(&req) != nil {
		fail(c, http.StatusBadRequest, "invalid Android photo destination request")
		return
	}
	var trailing any
	if dec.Decode(&trailing) != io.EOF {
		fail(c, http.StatusBadRequest, "unexpected destination request data")
		return
	}
	name := strings.TrimSpace(req.Name)
	if !meta.ValidSourceName(name) || meta.ValidateName(name) != nil {
		fail(c, http.StatusBadRequest, "invalid Android photo destination folder name")
		return
	}
	var device meta.ClientDevice
	var source meta.Source
	var target meta.Node
	created := false
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var liveOwner meta.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND session_version = ?", owner.ID, owner.SessionVersion).
			Take(&liveOwner).Error; err != nil ||
			liveOwner.DisabledAt != nil || liveOwner.MustChangePassword {
			return errAndroidPhotoDestinationDenied
		}
		var err error
		device, err = androidPhotoDestinationDeviceTx(c, tx, owner.ID)
		if err != nil {
			return err
		}
		source, target, err = androidPhotoDestinationBindingTx(tx, device)
		if err == nil {
			if source.Name == name {
				return nil
			}
			if err := renameManagedSourceTargetTx(tx, source, name); err != nil {
				return err
			}
			updated := tx.Model(&meta.Source{}).
				Where("id = ? AND owner_id = ? AND revision = ?", source.ID, owner.ID, source.Revision).
				Updates(map[string]any{
					"name": name, "revision": gorm.Expr("revision + 1"),
					"updated_at": time.Now().UTC(),
				})
			if updated.Error != nil || updated.RowsAffected != 1 {
				return errAndroidPhotoDestinationUntrusted
			}
			source.Name = name
			source.Revision++
			target.Name = name
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		deviceID := device.ID
		source = meta.Source{
			OwnerID: owner.ID, Name: name, Kind: meta.SourceKindAndroidPhotos,
			Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
			RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusPaused,
			Revision: 1, DeviceID: &deviceID,
		}
		if err := tx.Create(&source).Error; err != nil {
			return err
		}
		target, err = provisionManagedSourceTargetTx(c.Request.Context(), tx, source, &device)
		if err != nil {
			return err
		}
		change := tx.Model(&meta.Source{}).
			Where("id = ? AND owner_id = ?", source.ID, owner.ID).
			Updates(map[string]any{"target_node_id": target.ID, "target_managed": true})
		if change.Error != nil || change.RowsAffected != 1 {
			return errAndroidPhotoDestinationUntrusted
		}
		source.TargetNodeID = &target.ID
		source.TargetManaged = true
		created = true
		return nil
	})
	if err != nil {
		switch {
		case errors.Is(err, errAndroidPhotoDestinationDenied):
			fail(c, http.StatusForbidden, "current Owner and Android Device required")
		case errors.Is(err, errSourceTargetRenameActive), errors.Is(err, errSourceTargetNameConflict),
			errors.Is(err, errSourceManagedDirectoryOccupied), errors.Is(err, errSourceManagedAncestorInUse),
			errors.Is(err, errSourceTargetMigrationRequired),
			errors.Is(err, errAndroidPhotoDestinationUntrusted), isDuplicate(err):
			fail(c, http.StatusConflict, "Android photo managed target unavailable or busy")
		default:
			fail(c, http.StatusInternalServerError, "provision Android photo destination failed")
		}
		return
	}
	if created {
		s.androidPhotoDestinationResponse(c, device, source, target, http.StatusCreated)
	} else {
		s.androidPhotoDestinationResponse(c, device, source, target, http.StatusOK)
	}
}
