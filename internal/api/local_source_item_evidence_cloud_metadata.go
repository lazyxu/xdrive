package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	localEvidenceCloudMetadataLimit    = 64
	localEvidenceCloudMetadataMaxBytes = 16 << 10
)

// The Agent submits SHA256 digests of original bytes it has JUST read from its
// authorized Root. This data is untrusted until a separately verified native
// read; the Server cannot attest the Agent's physical disk or CAS object bytes.
type localEvidenceCloudMetadataItem struct {
	EvidenceID uint64 `json:"evidence_id"`
	SHA256     string `json:"sha256"`
	Size       int64  `json:"size"`
}

type localEvidenceCloudMetadataRequest struct {
	PreviousSnapshotSHA256 string                           `json:"previous_snapshot_sha256"`
	CurrentSnapshotSHA256  string                           `json:"current_snapshot_sha256"`
	Items                  []localEvidenceCloudMetadataItem `json:"items"`
}

type localEvidenceCloudMetadataResponse struct {
	SourceID             uint64 `json:"source_id"`
	Revision             uint64 `json:"revision"`
	Checked              int    `json:"checked"`
	CloudMetadataMatched bool   `json:"cloud_metadata_matched"`
	CloudBytesVerified   bool   `json:"cloud_bytes_verified"`
	ContentVerified      bool   `json:"content_verified"`
	CommitSupported      bool   `json:"commit_supported"`
	Authoritative        bool   `json:"authoritative"`
	MissingInferenceSafe bool   `json:"missing_inference_safe"`
}

func validLocalEvidenceCloudMetadataRequest(input localEvidenceCloudMetadataRequest) bool {
	if !validLocalEvidenceDigest(input.PreviousSnapshotSHA256) ||
		!validLocalEvidenceDigest(input.CurrentSnapshotSHA256) ||
		input.PreviousSnapshotSHA256 == input.CurrentSnapshotSHA256 ||
		len(input.Items) == 0 || len(input.Items) > localEvidenceCloudMetadataLimit {
		return false
	}
	var prior uint64
	for _, item := range input.Items {
		if item.EvidenceID <= prior || item.Size < 0 ||
			!validLocalEvidenceDigest(item.SHA256) {
			return false
		}
		prior = item.EvidenceID
	}
	return true
}

// This is a deliberately narrow, all-or-nothing point-in-time DB projection
// of the current Node + File + FileVersion + ready CAS ContentBlob metadata.
// It never reads the physical object and never emits a stored digest/key.
type localEvidenceCloudSnapshot struct {
	NodeID         uint64 `gorm:"column:node_id"`
	NodeRevision   uint64 `gorm:"column:node_revision"`
	FileSize       int64  `gorm:"column:file_size"`
	FileSHA256     string `gorm:"column:file_sha256"`
	FileStorageKey string `gorm:"column:file_storage_key"`
	VersionSize    int64  `gorm:"column:version_size"`
	VersionSHA256  string `gorm:"column:version_sha256"`
	VersionKey     string `gorm:"column:version_key"`
	BlobSize       int64  `gorm:"column:blob_size"`
	BlobSHA256     string `gorm:"column:blob_sha256"`
	BlobKey        string `gorm:"column:blob_key"`
	BlobState      string `gorm:"column:blob_state"`
	BlobRefCount   int64  `gorm:"column:blob_ref_count"`
}

// readLocalSourceEvidenceCloudMetadata accepts NO Node or SourceItem ID,
// path, upload key, object-storage key or cloud digest from Renderer/Web.
// A green response means only that current DB metadata and the owning Agent's
// claimed local SHA256 agree. It is not a signed token or upload permission.
func (s *Server) readLocalSourceEvidenceCloudMetadata(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid local Source ID")
		return
	}
	raw, hasProof := c.Get(localSourceExecutorContextKey)
	proof, proofOK := raw.(localSourceExecutorProof)
	if !hasProof || !proofOK || proof.DeviceID == "" || proof.RootID == "" {
		fail(c, http.StatusForbidden, "owning device and authorized local Root required")
		return
	}
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, localEvidenceCloudMetadataMaxBytes)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var input localEvidenceCloudMetadataRequest
	if err := decoder.Decode(&input); err != nil || !validLocalEvidenceCloudMetadataRequest(input) {
		fail(c, http.StatusBadRequest, "invalid or oversized local cloud metadata query")
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "cloud metadata query has trailing content")
		return
	}

	var revision uint64
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		// The identical device -> Source -> Root transactional proof fences
		// revocation/configuration changes. No owner-JWT-only fallback.
		if err := s.requireLocalSourceProofTx(tx, c, sourceID, "", false); err != nil {
			return err
		}
		var source meta.Source
		if err := tx.Select("id", "owner_id", "kind", "direction", "status", "revision").
			Where("id = ? AND owner_id = ?", sourceID, userID(c)).Take(&source).Error; err != nil {
			return err
		}
		revision = source.Revision
		if !isLocalFolderPush(source) {
			return errLocalBindingTypeInvalid
		}
		if revision != expected {
			return errRevisionConflict
		}
		if source.Status != meta.SourceStatusPaused {
			return errLocalBindingStateInvalid
		}

		evidenceIDs := make([]uint64, 0, len(input.Items))
		expectedByID := make(map[uint64]localEvidenceCloudMetadataItem, len(input.Items))
		for _, item := range input.Items {
			evidenceIDs = append(evidenceIDs, item.EvidenceID)
			expectedByID[item.EvidenceID] = item
		}
		var rows []meta.LocalSourceItemEvidence
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("source_id = ? AND source_revision = ? AND device_id = ? AND root_id = ? AND root_fingerprint = ?",
				sourceID, revision, proof.DeviceID, proof.RootID,
				strings.ToLower(strings.TrimSpace(c.GetHeader("X-XDrive-Local-Root-Fingerprint")))).
			Where("previous_snapshot_sha256 = ? AND current_snapshot_sha256 = ?",
				input.PreviousSnapshotSHA256, input.CurrentSnapshotSHA256).
			Where("id IN ?", evidenceIDs).
			Order("id ASC").Limit(localEvidenceCloudMetadataLimit).
			Find(&rows).Error; err != nil {
			return err
		}
		if len(rows) != len(input.Items) {
			return errLocalEvidenceConflict
		}

		itemIDs := make([]uint64, 0, len(rows))
		keys := make([]string, 0, 2*len(rows))
		claimedItem := make(map[uint64]struct{}, len(rows))
		claimedDestination := make(map[string]struct{}, len(rows))
		for i, row := range rows {
			if row.ID != input.Items[i].EvidenceID || row.SourceItemID == 0 ||
				!validLocalEvidenceDigest(row.PreviousPathKey) ||
				!validLocalEvidenceDigest(row.CurrentPathKey) ||
				!validLocalEvidenceDigest(row.NativeIdentityKey) ||
				row.PreviousPathKey == row.CurrentPathKey {
				return errLocalEvidenceConflict
			}
			if _, seen := claimedItem[row.SourceItemID]; seen {
				return errLocalEvidenceConflict
			}
			if _, seen := claimedDestination[row.CurrentPathKey]; seen {
				return errLocalEvidenceConflict
			}
			claimedItem[row.SourceItemID] = struct{}{}
			claimedDestination[row.CurrentPathKey] = struct{}{}
			itemIDs = append(itemIDs, row.SourceItemID)
			keys = append(keys, row.PreviousPathKey, row.CurrentPathKey)
		}
		var items []meta.SourceItem
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("source_id = ? AND id IN ?", sourceID, itemIDs).
			Order("id ASC").Find(&items).Error; err != nil {
			return err
		}
		if len(items) != len(itemIDs) {
			return errLocalEvidenceConflict
		}
		byID := make(map[uint64]meta.SourceItem, len(items))
		for _, item := range items {
			byID[item.ID] = item
		}
		index, err := loadSourceIdentityIndex(tx, sourceID, keys)
		if err != nil {
			return errLocalEvidenceConflict
		}
		nodeIDs := make([]uint64, 0, len(rows))
		for _, row := range rows {
			item, found := byID[row.SourceItemID]
			inputItem := expectedByID[row.ID]
			if !found || item.Kind != meta.SourceItemKindFile ||
				item.State != meta.SourceItemStateSynced || item.NodeID == nil ||
				item.NodeRevision == 0 || item.ExternalID != row.PreviousPathKey ||
				item.Size != inputItem.Size || item.SHA256 != inputItem.SHA256 {
				return errLocalEvidenceConflict
			}
			relative, err := sourcepkg.NormalizeRelativePath(item.Path)
			if err != nil || relative == "" || relative != item.Path {
				return errLocalEvidenceConflict
			}
			digest := sha256.Sum256([]byte("xdrive-local-path-v1\x00" +
				proof.RootID + "\x00file\x00" + item.Path))
			if hex.EncodeToString(digest[:]) != row.PreviousPathKey {
				return errLocalEvidenceConflict
			}
			old, found, err := index.resolve(row.PreviousPathKey, nil)
			if err != nil || !found || old.ID != item.ID {
				return errLocalEvidenceConflict
			}
			next, found, err := index.resolve(row.CurrentPathKey, nil)
			if err != nil || (found && next.ID != item.ID) {
				return errLocalEvidenceConflict
			}
			nodeIDs = append(nodeIDs, *item.NodeID)
		}

		// One SELECT joins all four current cloud metadata relations, limiting
		// work to <=64 exact owned nodes. A missing version/blob/file cannot
		// silently fall back to an older or unverified legacy storage key.
		var cloud []localEvidenceCloudSnapshot
		if err := tx.Table("xd_nodes AS n").
			Select("n.id AS node_id, n.revision AS node_revision, "+
				"f.size AS file_size, f.sha256 AS file_sha256, f.storage_key AS file_storage_key, "+
				"v.size AS version_size, v.sha256 AS version_sha256, v.storage_key AS version_key, "+
				"b.size AS blob_size, b.sha256 AS blob_sha256, b.storage_key AS blob_key, "+
				"b.state AS blob_state, b.ref_count AS blob_ref_count").
			Joins("JOIN xd_files AS f ON f.node_id = n.id").
			Joins("JOIN xd_file_versions AS v ON v.node_id = n.id AND v.revision = n.revision").
			Joins("JOIN xd_content_blobs AS b ON b.sha256 = f.sha256").
			Where("n.id IN ? AND n.owner_id = ? AND n.type = ? AND n.deleted_at IS NULL",
				nodeIDs, source.OwnerID, meta.NodeTypeFile).
			Clauses(clause.Locking{Strength: "SHARE"}).
			Order("n.id ASC").Find(&cloud).Error; err != nil {
			return err
		}
		if len(cloud) != len(rows) {
			return errLocalEvidenceConflict
		}
		cloudByNode := make(map[uint64]localEvidenceCloudSnapshot, len(cloud))
		for _, row := range cloud {
			if _, seen := cloudByNode[row.NodeID]; seen {
				return errLocalEvidenceConflict
			}
			cloudByNode[row.NodeID] = row
		}
		for _, row := range rows {
			item := byID[row.SourceItemID]
			claim := expectedByID[row.ID]
			remote, ok := cloudByNode[*item.NodeID]
			if !ok || remote.NodeRevision != item.NodeRevision ||
				remote.FileSize != claim.Size || remote.VersionSize != claim.Size ||
				remote.BlobSize != claim.Size ||
				remote.FileSHA256 != claim.SHA256 ||
				remote.VersionSHA256 != claim.SHA256 ||
				remote.BlobSHA256 != claim.SHA256 ||
				remote.BlobState != meta.ContentBlobStateReady ||
				remote.BlobRefCount <= 0 {
				return errLocalEvidenceConflict
			}
			canonicalKey, err := storage.ContentAddressedKey(claim.SHA256)
			if err != nil || remote.FileStorageKey != canonicalKey ||
				remote.VersionKey != canonicalKey || remote.BlobKey != canonicalKey {
				return errLocalEvidenceConflict
			}
		}
		return c.Request.Context().Err()
	})
	if err != nil {
		switch {
		case errors.Is(err, errLocalSourceExecutorTransactionUnauthorized):
			fail(c, http.StatusForbidden, "owning device or local Root not authorized")
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "local Source not found")
		case errors.Is(err, errRevisionConflict):
			revisionConflict(c, expected, revision)
		case errors.Is(err, errLocalEvidenceConflict), errors.Is(err, errLocalBindingStateInvalid):
			fail(c, http.StatusConflict, "local cloud metadata no longer matches verified advisory evidence")
		case errors.Is(err, errLocalBindingTypeInvalid):
			fail(c, http.StatusForbidden, "local folder Push required")
		default:
			fail(c, http.StatusInternalServerError, "local cloud metadata unavailable")
		}
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(revision, 10)))
	c.JSON(http.StatusOK, localEvidenceCloudMetadataResponse{
		SourceID: sourceID, Revision: revision, Checked: len(input.Items),
		CloudMetadataMatched: true, CloudBytesVerified: false,
		ContentVerified: false, CommitSupported: false,
		Authoritative: false, MissingInferenceSafe: false,
	})
}
