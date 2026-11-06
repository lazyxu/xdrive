package api

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var errSynologyPushAuthority = errors.New("Synology Push authority denied")

func currentSynologySourceProof(c *gin.Context) (uint64, localSourceExecutorProof, bool) {
	if c == nil {
		return 0, localSourceExecutorProof{}, false
	}
	sourceID, ok := parseID(strings.TrimSpace(c.GetHeader("X-XDrive-Synology-Source-ID")))
	if !ok || sourceID == 0 {
		return 0, localSourceExecutorProof{}, false
	}
	revision, err := strconv.ParseUint(strings.TrimSpace(c.GetHeader("X-XDrive-Synology-Source-Revision")), 10, 64)
	if err != nil || revision == 0 {
		return 0, localSourceExecutorProof{}, false
	}
	deviceID, deviceErr := uuid.Parse(strings.TrimSpace(c.GetHeader("X-XDrive-Device-ID")))
	rootID, rootErr := uuid.Parse(strings.TrimSpace(c.GetHeader("X-XDrive-Local-Root-ID")))
	fingerprint := strings.ToLower(strings.TrimSpace(c.GetHeader("X-XDrive-Local-Root-Fingerprint")))
	if deviceErr != nil || rootErr != nil || !validSHA256(fingerprint) {
		return 0, localSourceExecutorProof{}, false
	}
	return sourceID, localSourceExecutorProof{
		DeviceID: deviceID.String(), RootID: rootID.String(),
		Platform: "synology", SourceRevision: revision,
	}, true
}

// requireSynologySourceProofTx repeats the exact Device + Source + Root check
// under the transaction that mutates a Source, Node, UploadSession or CAS row.
func requireSynologySourceProofTx(
	tx *gorm.DB, c *gin.Context, sourceID uint64, runID string,
	proof localSourceExecutorProof, requireActive bool,
) (meta.Source, error) {
	var zero meta.Source
	if tx == nil || c == nil || sourceID == 0 || proof.Platform != "synology" ||
		proof.DeviceID == "" || proof.RootID == "" || proof.SourceRevision == 0 {
		return zero, errSynologyPushAuthority
	}
	var device meta.ClientDevice
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND owner_id = ? AND platform = ?", proof.DeviceID, userID(c), "synology").
		Take(&device).Error; err != nil {
		return zero, errSynologyPushAuthority
	}
	if !clientDeviceIdentityCredentialMatches(device, c.GetHeader("X-XDrive-Device-Token")) {
		return zero, errSynologyPushAuthority
	}
	var source meta.Source
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND owner_id = ?", sourceID, userID(c)).
		Take(&source).Error; err != nil {
		return zero, errSynologyPushAuthority
	}
	boundDeviceID, bound := meta.SourceDeviceID(source)
	if source.Kind != synologySourceKind || source.Direction != meta.SourceDirectionPush ||
		source.SyncMode != meta.SourceSyncModeBackup ||
		!bound || boundDeviceID != device.ID ||
		source.Revision != proof.SourceRevision || !source.TargetManaged || source.TargetNodeID == nil ||
		(requireActive && source.Status != meta.SourceStatusActive) {
		return zero, errSynologyPushAuthority
	}
	var target meta.Node
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			*source.TargetNodeID, source.OwnerID, meta.NodeTypeDir).
		Take(&target).Error; err != nil {
		return zero, errSynologyPushAuthority
	}
	var binding meta.LocalSourceBinding
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("source_id = ? AND owner_id = ? AND device_id = ?", source.ID, source.OwnerID, device.ID).
		Take(&binding).Error; err != nil ||
		binding.RootID != proof.RootID ||
		binding.RootFingerprint != strings.ToLower(strings.TrimSpace(c.GetHeader("X-XDrive-Local-Root-Fingerprint"))) {
		return zero, errSynologyPushAuthority
	}
	if runID != "" {
		var run meta.SyncRun
		if err := tx.Select("id", "source_id", "source_revision").
			Where("id = ? AND source_id = ?", runID, sourceID).Take(&run).Error; err != nil ||
			run.SourceRevision != proof.SourceRevision {
			return zero, errSynologyPushAuthority
		}
	}
	return source, nil
}

func requireSynologySourceTargetTx(
	ctx context.Context, tx *gorm.DB, c *gin.Context, ownerID, sourceID uint64,
	proof localSourceExecutorProof, directoryID uint64,
) error {
	source, err := requireSynologySourceProofTx(tx, c, sourceID, "", proof, true)
	if err != nil || source.OwnerID != ownerID || source.TargetNodeID == nil ||
		requireLocalPushCommonDescendantDirTx(tx, ownerID, *source.TargetNodeID, directoryID) != nil {
		return errManagedSourceWriteDenied
	}
	return nil
}

func requireSynologySourceNodeMutationTx(
	ctx context.Context, tx *gorm.DB, c *gin.Context, ownerID, sourceID uint64,
	proof localSourceExecutorProof, nodeID uint64, structural bool,
) error {
	source, err := requireSynologySourceProofTx(tx, c, sourceID, "", proof, true)
	if err != nil || source.OwnerID != ownerID || source.TargetNodeID == nil {
		return errManagedSourceWriteDenied
	}
	var node meta.Node
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("id = ? AND owner_id = ? AND deleted_at IS NULL", nodeID, ownerID).
		Take(&node).Error; err != nil {
		return errManagedSourceWriteDenied
	}
	if !structural {
		if node.Type != meta.NodeTypeDir ||
			requireLocalPushCommonDescendantDirTx(tx, ownerID, *source.TargetNodeID, node.ID) != nil {
			return errManagedSourceWriteDenied
		}
		return nil
	}
	if node.ID == *source.TargetNodeID || node.ParentID == nil {
		return errManagedSourceWriteDenied
	}
	directoryID := *node.ParentID
	if node.Type == meta.NodeTypeDir {
		directoryID = node.ID
		containsTarget, checkErr := managedSourceTargetInSubtreeDB(ctx, tx, ownerID, node.ID)
		if checkErr != nil || containsTarget {
			return errManagedSourceWriteDenied
		}
	} else if node.Type != meta.NodeTypeFile {
		return errManagedSourceWriteDenied
	}
	if requireLocalPushCommonDescendantDirTx(tx, ownerID, *source.TargetNodeID, directoryID) != nil {
		return errManagedSourceWriteDenied
	}
	return nil
}

func validSynologyUploadScope(req uploadInitRequest) bool {
	if req.SourceID == 0 && req.SourceRevision == 0 &&
		req.SourceRootID == "" && req.SourceRootFingerprint == "" {
		return true
	}
	rootID, err := uuid.Parse(strings.TrimSpace(req.SourceRootID))
	return req.SourceID != 0 && req.SourceRevision != 0 && err == nil &&
		rootID.String() == strings.TrimSpace(req.SourceRootID) &&
		validSHA256(strings.ToLower(strings.TrimSpace(req.SourceRootFingerprint))) &&
		req.SourceRootFingerprint == strings.ToLower(strings.TrimSpace(req.SourceRootFingerprint))
}

func requireSynologyPushUploadTargetTx(
	ctx context.Context, tx *gorm.DB, c *gin.Context, ownerID, targetID uint64, req uploadInitRequest,
) error {
	if !validSynologyUploadScope(req) || req.SourceID == 0 {
		return errManagedSourceWriteDenied
	}
	headerSourceID, headerProof, ok := currentSynologySourceProof(c)
	if !ok || headerSourceID != req.SourceID ||
		headerProof.SourceRevision != req.SourceRevision ||
		headerProof.RootID != req.SourceRootID ||
		c.GetHeader("X-XDrive-Local-Root-Fingerprint") != req.SourceRootFingerprint {
		return errManagedSourceWriteDenied
	}
	source, err := requireSynologySourceProofTx(tx, c, req.SourceID, "", headerProof, true)
	if err != nil || source.OwnerID != ownerID || source.TargetNodeID == nil {
		return errManagedSourceWriteDenied
	}
	if req.NodeID != nil {
		var node meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
				*req.NodeID, ownerID, meta.NodeTypeFile).Take(&node).Error; err != nil ||
			node.ParentID == nil || node.Revision != req.ExpectedRevision ||
			targetID != node.ID ||
			requireLocalPushCommonDescendantDirTx(tx, ownerID, *source.TargetNodeID, *node.ParentID) != nil {
			return errManagedSourceWriteDenied
		}
		return nil
	}
	if req.ParentID == nil || targetID != *req.ParentID ||
		requireLocalPushCommonDescendantDirTx(tx, ownerID, *source.TargetNodeID, *req.ParentID) != nil {
		return errManagedSourceWriteDenied
	}
	return nil
}

func requireSynologyPushUploadSessionTx(
	ctx context.Context, tx *gorm.DB, c *gin.Context, session meta.UploadSession,
) error {
	if session.SourceID == 0 {
		return nil
	}
	headerSourceID, headerProof, ok := currentSynologySourceProof(c)
	if !ok || headerSourceID != session.SourceID ||
		headerProof.SourceRevision != session.SourceRevision ||
		headerProof.DeviceID != session.SourceDeviceID ||
		headerProof.RootID != session.SourceRootID ||
		c.GetHeader("X-XDrive-Local-Root-Fingerprint") != session.SourceRootFingerprint ||
		session.SourceTargetID == 0 {
		return errManagedSourceWriteDenied
	}
	source, err := requireSynologySourceProofTx(tx, c, session.SourceID, "", headerProof, true)
	if err != nil || source.TargetNodeID == nil || *source.TargetNodeID != session.SourceTargetID {
		return errManagedSourceWriteDenied
	}
	if session.Status == meta.UploadStatusFinalized && session.ResultNodeID != nil {
		var result meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
				*session.ResultNodeID, session.OwnerID, meta.NodeTypeFile).Take(&result).Error; err != nil ||
			result.ParentID == nil ||
			requireLocalPushCommonDescendantDirTx(tx, session.OwnerID, session.SourceTargetID, *result.ParentID) != nil {
			return errManagedSourceWriteDenied
		}
		return nil
	}
	if session.NodeID != nil {
		var node meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
				*session.NodeID, session.OwnerID, meta.NodeTypeFile).Take(&node).Error; err != nil ||
			node.ParentID == nil || node.Revision != session.ExpectedRevision ||
			requireLocalPushCommonDescendantDirTx(tx, session.OwnerID, session.SourceTargetID, *node.ParentID) != nil {
			return errManagedSourceWriteDenied
		}
		return nil
	}
	if session.ParentID == nil ||
		requireLocalPushCommonDescendantDirTx(tx, session.OwnerID, session.SourceTargetID, *session.ParentID) != nil {
		return errManagedSourceWriteDenied
	}
	return nil
}

// verifyPushUploadSession rechecks the platform-specific owning Device and
// Source/Target binding before readback, chunk staging and Finalize. Durable
// mutations additionally repeat these checks in their actual SQL transaction.
func (s *Server) verifyPushUploadSession(c *gin.Context, session meta.UploadSession) error {
	if session.SourceID == 0 {
		if _, native := currentAndroidPhotoManagedUploadScope(c); native {
			return errManagedSourceWriteDenied
		}
		if _, native := currentIOSPhotoManagedUploadScope(c); native {
			return errManagedSourceWriteDenied
		}
		return nil
	}
	return s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if _, native := currentAndroidPhotoManagedUploadScope(c); native {
			return requireAndroidPhotoManagedSessionTx(c.Request.Context(), tx, c, session)
		}
		if _, native := currentIOSPhotoManagedUploadScope(c); native {
			return requireIOSPhotoManagedSessionTx(c.Request.Context(), tx, c, session)
		}
		return requireSynologyPushUploadSessionTx(c.Request.Context(), tx, c, session)
	})
}
