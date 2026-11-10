package api

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const iosPhotoHoldMaximumBytes int64 = 1_073_741_824 + 1_048_576 // bounded explicit single original

var errIOSPhotoHoldDenied = errors.New("iOS photo original retention proof unavailable")

type iosPhotoHoldRequest struct {
	NodeID       uint64 `json:"node_id"`
	NodeRevision uint64 `json:"node_revision"`
	SessionID    string `json:"session_id"`
	SHA256       string `json:"sha256"`
	ByteSize     int64  `json:"byte_size"`
	Kind         string `json:"kind"` // "image", "video", or "live"
}

func validIOSPhotoHoldRequest(req iosPhotoHoldRequest) bool {
	if req.NodeID == 0 || req.NodeRevision == 0 || req.ByteSize <= 0 ||
		req.ByteSize > iosPhotoHoldMaximumBytes ||
		!validSHA256(req.SHA256) || req.SHA256 != strings.ToLower(req.SHA256) {
		return false
	}
	if _, err := uuid.Parse(req.SessionID); err != nil {
		return false
	}
	return req.Kind == "image" || req.Kind == "video" || req.Kind == "live"
}

func iosPhotoHoldResponse(hold meta.IOSPhotoOriginalHold) gin.H {
	return gin.H{
		"hold_id": hold.ID, "node_id": hold.NodeID, "node_revision": hold.NodeRevision,
		"source_id": hold.SourceID, "target_node_id": hold.TargetNodeID,
		"sha256": hold.SHA256, "byte_size": hold.ByteSize,
		"kind": hold.Kind, "retained": true, "created_at": hold.CreatedAt,
	}
}

// All physical observations require a *real* pinned CAS file. A normal Open
// is not a GC/replacement fence; a remote backend without a read lease is
// deliberately unsupported for deletion-of-original proof.
func (s *Server) verifyIOSPhotoOriginalPhysical(ctx context.Context,
	hash, key string, size int64, kind string) (func(), error) {
	provider, ok := s.Store.(storage.CASReadLeaseProvider)
	if !ok || size <= 0 || size > iosPhotoHoldMaximumBytes {
		return nil, errIOSPhotoHoldDenied
	}
	canonical, err := storage.ContentAddressedKey(hash)
	if err != nil || canonical != key {
		return nil, errIOSPhotoHoldDenied
	}
	pinned, err := provider.OpenPinnedCAS(ctx, key)
	if err != nil {
		return nil, errIOSPhotoHoldDenied
	}
	release := func() { _ = pinned.Close() }
	st, err := pinned.Stat()
	if err != nil || !st.Mode().IsRegular() || st.Size() != size {
		release()
		return nil, errIOSPhotoHoldDenied
	}
	digest := sha256.New()
	copied, err := io.CopyBuffer(digest, io.LimitReader(pinned, size+1), make([]byte, 1<<20))
	if err != nil || copied != size || ctx.Err() != nil ||
		hex.EncodeToString(digest.Sum(nil)) != hash {
		release()
		return nil, errIOSPhotoHoldDenied
	}
	if kind == "live" {
		original, err := s.Store.Open(ctx, key)
		if err != nil {
			release()
			return nil, errIOSPhotoHoldDenied
		}
		valid := verifyIOSPhotoLivePairZIP(ctx, original, size)
		_ = original.Close()
		if !valid {
			release()
			return nil, errIOSPhotoHoldDenied
		}
	}
	return release, nil
}

type iosPhotoLiveManifest struct {
	Format    string `json:"format"`
	Version   int    `json:"version"`
	Resources []struct {
		Role             string `json:"role"`
		Path             string `json:"path"`
		OriginalFilename string `json:"originalFilename"`
		Bytes            int64  `json:"bytes"`
		CRC32            string `json:"crc32"`
	} `json:"resources"`
}

// Exact still+motion+manifest, no fourth file, no path traversal, no compressed
// transcoding. Go's ZIP reader verifies the stored CRC while fully draining
// each original. The enclosing ZIP SHA-256 is checked before this parse.
func verifyIOSPhotoLivePairZIP(ctx context.Context, source *os.File, size int64) bool {
	if source == nil || size <= 0 || size > iosPhotoHoldMaximumBytes {
		return false
	}
	z, err := zip.NewReader(source, size)
	if err != nil || len(z.File) != 3 {
		return false
	}
	entries := map[string]*zip.File{}
	for _, f := range z.File {
		if _, exists := entries[f.Name]; exists || f.Method != zip.Store ||
			f.FileInfo().IsDir() || f.UncompressedSize64 == 0 ||
			f.UncompressedSize64 > uint64(iosPhotoHoldMaximumBytes) ||
			strings.Contains(f.Name, "..") || strings.HasPrefix(f.Name, "/") {
			return false
		}
		entries[f.Name] = f
	}
	mf := entries["manifest.json"]
	if mf == nil || mf.UncompressedSize64 > 65535 {
		return false
	}
	stream, err := mf.Open()
	if err != nil {
		return false
	}
	manifestBytes, err := io.ReadAll(io.LimitReader(stream, 65536))
	closeErr := stream.Close()
	if err != nil || closeErr != nil || len(manifestBytes) == 0 || len(manifestBytes) > 65535 {
		return false
	}
	var manifest iosPhotoLiveManifest
	if json.Unmarshal(manifestBytes, &manifest) != nil ||
		manifest.Format != "xdrive-live-originals" ||
		manifest.Version != 1 || len(manifest.Resources) != 2 {
		return false
	}
	used := map[string]bool{"manifest.json": true}
	for i, item := range manifest.Resources {
		expectedRole := "still"
		if i == 1 {
			expectedRole = "motion"
		}
		if item.Role != expectedRole || !strings.HasPrefix(item.Path, "media/"+expectedRole+".") ||
			item.OriginalFilename == "" || len(item.OriginalFilename) > 255 ||
			item.Bytes <= 0 || item.Bytes > iosPhotoHoldMaximumBytes || len(item.CRC32) != 8 {
			return false
		}
		f := entries[item.Path]
		if f == nil || used[item.Path] || int64(f.UncompressedSize64) != item.Bytes ||
			strings.ToLower(fmt.Sprintf("%08x", f.CRC32)) != item.CRC32 {
			return false
		}
		used[item.Path] = true
		reader, err := f.Open()
		if err != nil {
			return false
		}
		hasher := crc32.NewIEEE()
		copied, err := io.Copy(hasher, io.LimitReader(reader, item.Bytes+1))
		closed := reader.Close()
		if err != nil || closed != nil || copied != item.Bytes || ctx.Err() != nil ||
			fmt.Sprintf("%08x", hasher.Sum32()) != item.CRC32 {
			return false
		}
	}
	return len(used) == len(entries)
}

func iosPhotoHoldAncestorIDsTx(tx *gorm.DB, ownerID, nodeID, rootID, targetID uint64) ([]uint64, error) {
	var rows []struct {
		ID       uint64  `gorm:"column:id"`
		ParentID *uint64 `gorm:"column:parent_id"`
	}
	err := tx.Raw(`WITH RECURSIVE ancestors AS (
      SELECT id, parent_id, owner_id, 0 AS depth FROM xd_nodes
        WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
      UNION ALL
      SELECT p.id, p.parent_id, p.owner_id, a.depth + 1 FROM xd_nodes p
        JOIN ancestors a ON p.id = a.parent_id
        WHERE p.owner_id = ? AND p.deleted_at IS NULL AND a.depth < 128
    )
    SELECT id, parent_id FROM ancestors ORDER BY depth ASC`, nodeID, ownerID, ownerID).Scan(&rows).Error
	if err != nil || len(rows) < 3 || len(rows) > 129 {
		return nil, errIOSPhotoHoldDenied
	}
	ids := make([]uint64, 0, len(rows))
	seen := map[uint64]bool{}
	reachedRoot, reachedTarget := false, false
	for _, row := range rows {
		if row.ID == 0 || seen[row.ID] {
			return nil, errIOSPhotoHoldDenied
		}
		seen[row.ID] = true
		ids = append(ids, row.ID)
		if row.ID == rootID && row.ParentID == nil {
			reachedRoot = true
		}
		if row.ID == targetID {
			reachedTarget = true
		}
	}
	if !reachedRoot || !reachedTarget || rows[0].ID != nodeID {
		return nil, errIOSPhotoHoldDenied
	}
	return ids, nil
}

func (s *Server) verifyIOSPhotoHoldTx(ctx context.Context, tx *gorm.DB,
	c *gin.Context, scope iosPhotoManagedUploadScope, request iosPhotoHoldRequest,
	existing *meta.IOSPhotoOriginalHold) (meta.Node, meta.File, error) {
	device, err := iosPhotoDestinationDeviceTx(c, tx, scope.ownerID)
	if err != nil || device.ID != scope.deviceID {
		return meta.Node{}, meta.File{}, errIOSPhotoHoldDenied
	}
	source, target, err := iosPhotoDestinationBindingTx(tx, device)
	if err != nil || source.ID != scope.sourceID || source.Revision != scope.sourceRevision ||
		target.ID != scope.targetID {
		return meta.Node{}, meta.File{}, errIOSPhotoHoldDenied
	}

	var node meta.Node
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("id = ? AND owner_id = ? AND parent_id = ? AND type = ? AND deleted_at IS NULL",
			request.NodeID, scope.ownerID, scope.targetID, meta.NodeTypeFile).Take(&node).Error; err != nil {
		return node, meta.File{}, errIOSPhotoHoldDenied
	}
	if node.Revision != request.NodeRevision || !iosBackgroundOriginalNameValid(node.Name) {
		return node, meta.File{}, errIOSPhotoHoldDenied
	}
	if request.Kind == "live" && (!strings.HasPrefix(node.Name, "Live-xios-") ||
		!strings.HasSuffix(node.Name, ".zip")) {
		return node, meta.File{}, errIOSPhotoHoldDenied
	}
	if request.Kind != "live" && (strings.HasPrefix(node.Name, "Live-xios-") ||
		strings.HasSuffix(strings.ToLower(node.Name), ".zip")) {
		return node, meta.File{}, errIOSPhotoHoldDenied
	}
	var file meta.File
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("node_id = ?", node.ID).Take(&file).Error; err != nil {
		return node, file, errIOSPhotoHoldDenied
	}
	key, err := storage.ContentAddressedKey(request.SHA256)
	if err != nil || file.SHA256 != request.SHA256 ||
		file.Size != request.ByteSize || file.StorageKey != key {
		return node, file, errIOSPhotoHoldDenied
	}
	// A permanent Hold is independent from expired UploadSession history.
	// At FIRST issuance the finalized, exact Owner/Device/Source/Node receipt
	// must exist; a local ACK or missing session can never mint a Hold.
	// Afterwards an immutable Hold, current Node and physical CAS content
	// are authoritative even after normal upload-session janitor cleanup.
	if existing == nil {
		var session meta.UploadSession
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("id = ? AND owner_id = ? AND status = ?", request.SessionID,
				scope.ownerID, meta.UploadStatusFinalized).Take(&session).Error; err != nil {
			return node, file, errIOSPhotoHoldDenied
		}
		if session.ResultNodeID == nil || *session.ResultNodeID != node.ID ||
			session.NodeID != nil || session.ParentID == nil || *session.ParentID != scope.targetID ||
			session.SourceID != scope.sourceID || session.SourceRevision != scope.sourceRevision ||
			session.SourceDeviceID != scope.deviceID || session.SourceTargetID != scope.targetID ||
			session.SourceRunID != "" || session.ShareID != nil ||
			session.Name != node.Name || session.RequestedName != node.Name ||
			session.TotalSize != file.Size || session.SHA256 != file.SHA256 ||
			!validIOSUploadResumeLookupKey(session.ResumeKey) ||
			(session.ConflictPolicy != meta.UploadConflictPolicyFail && session.ConflictPolicy != "") {
			return node, file, errIOSPhotoHoldDenied
		}
	} else if existing.OwnerID != scope.ownerID ||
		existing.DeviceID != scope.deviceID || existing.SourceID != scope.sourceID ||
		existing.SourceRevision != scope.sourceRevision || existing.TargetNodeID != scope.targetID ||
		existing.NodeID != node.ID || existing.NodeRevision != node.Revision ||
		existing.Kind != request.Kind || existing.SHA256 != file.SHA256 ||
		existing.ByteSize != file.Size || existing.StorageKey != file.StorageKey ||
		existing.SessionID != request.SessionID {
		return node, file, errIOSPhotoHoldDenied
	}
	if err := lockContentHash(tx, file.SHA256); err != nil {
		return node, file, err
	}
	var blob meta.ContentBlob
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("sha256 = ? AND state = ? AND ref_count > 0",
			file.SHA256, meta.ContentBlobStateReady).Take(&blob).Error; err != nil ||
		blob.StorageKey != file.StorageKey || blob.Size != file.Size {
		return node, file, errIOSPhotoHoldDenied
	}
	if err := ctx.Err(); err != nil {
		return node, file, err
	}
	return node, file, nil
}

// The endpoint is intentionally *only* on the authenticated Owner+registered
// iPhone managed Upload namespace, not the Owner root or background grant.
func (s *Server) prepareIOSPhotoOriginalHold(c *gin.Context) {
	scope, ok := s.iosPhotoManagedAuthorizedScope(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var request iosPhotoHoldRequest
	if decoder.Decode(&request) != nil || !validIOSPhotoHoldRequest(request) {
		fail(c, http.StatusBadRequest, "invalid photo original hold request")
		return
	}
	var trailing any
	if decoder.Decode(&trailing) != io.EOF {
		fail(c, http.StatusBadRequest, "unexpected photo hold request body")
		return
	}
	// On the first read we only establish the candidate immutable key.
	var file meta.File
	if err := s.DB.WithContext(c.Request.Context()).Table("xd_files AS f").
		Select("f.*").Joins("JOIN xd_nodes AS n ON n.id = f.node_id").
		Where("f.node_id = ? AND n.owner_id = ? AND n.parent_id = ? AND n.deleted_at IS NULL",
			request.NodeID, scope.ownerID, scope.targetID).
		Take(&file).Error; err != nil {
		fail(c, http.StatusConflict, "original is not available for retention")
		return
	}
	if file.Size != request.ByteSize || file.SHA256 != request.SHA256 {
		fail(c, http.StatusConflict, "current original digest does not match")
		return
	}
	release, err := s.verifyIOSPhotoOriginalPhysical(c.Request.Context(),
		request.SHA256, file.StorageKey, file.Size, request.Kind)
	if err != nil {
		fail(c, http.StatusConflict, "physical original or live pair not verified")
		return
	}
	defer release() // pins physical CAS against concurrently running GC

	var held meta.IOSPhotoOriginalHold
	created := false
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		// Check for an existing immutable Hold FIRST. A finalized upload
		// session is short-lived and may have been pruned by the janitor;
		// an existing durable Hold remains independently verifiable.
		var old meta.IOSPhotoOriginalHold
		lookup := tx.Where("node_id = ?", request.NodeID).Take(&old).Error
		if lookup == nil {
			_, _, err := s.verifyIOSPhotoHoldTx(c.Request.Context(), tx, c, scope, request, &old)
			if err != nil {
				return err
			}
			held = old
			return nil
		}
		if !errors.Is(lookup, gorm.ErrRecordNotFound) {
			return lookup
		}
		node, currentFile, err := s.verifyIOSPhotoHoldTx(c.Request.Context(), tx, c, scope, request, nil)
		if err != nil {
			return err
		}
		ancestors, err := iosPhotoHoldAncestorIDsTx(tx, scope.ownerID, node.ID,
			scopeOwnerRootIDTx(tx, scope.ownerID), scope.targetID)
		if err != nil {
			return err
		}
		held = meta.IOSPhotoOriginalHold{
			ID: uuid.NewString(), OwnerID: scope.ownerID, DeviceID: scope.deviceID,
			SourceID: scope.sourceID, SourceRevision: scope.sourceRevision,
			TargetNodeID: scope.targetID, NodeID: node.ID, NodeRevision: node.Revision,
			SessionID: request.SessionID, Kind: request.Kind,
			SHA256: currentFile.SHA256, ByteSize: currentFile.Size,
			StorageKey: currentFile.StorageKey, CreatedAt: time.Now().UTC(),
		}
		if err := tx.Create(&held).Error; err != nil {
			return err
		}
		for _, nodeID := range ancestors {
			if err := tx.Create(&meta.IOSPhotoOriginalHoldAncestor{
				HoldID: held.ID, NodeID: nodeID, OwnerID: scope.ownerID,
			}).Error; err != nil {
				return err
			}
		}
		created = true
		return nil
	})
	if err != nil {
		fail(c, http.StatusConflict, "managed original retention cannot be guaranteed")
		return
	}
	c.Header("Cache-Control", "private, no-store")
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	c.JSON(status, iosPhotoHoldResponse(held))
}

// Fail closed if the owner root cannot be loaded. This deliberately returns
// zero instead of adopting a similarly named unrelated path.
func scopeOwnerRootIDTx(tx *gorm.DB, ownerID uint64) uint64 {
	var root meta.Node
	if tx.Where("owner_id = ? AND parent_id IS NULL AND deleted_at IS NULL AND type = ?",
		ownerID, meta.NodeTypeDir).Take(&root).Error != nil {
		return 0
	}
	return root.ID
}

func (s *Server) verifyIOSPhotoOriginalHold(c *gin.Context) {
	scope, ok := s.iosPhotoManagedAuthorizedScope(c)
	if !ok {
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid original retention id")
		return
	}
	var hold meta.IOSPhotoOriginalHold
	if s.DB.WithContext(c.Request.Context()).Where("id = ? AND owner_id = ?",
		id.String(), scope.ownerID).Take(&hold).Error != nil ||
		hold.DeviceID != scope.deviceID || hold.SourceID != scope.sourceID ||
		hold.SourceRevision != scope.sourceRevision || hold.TargetNodeID != scope.targetID {
		fail(c, http.StatusNotFound, "original retention not available")
		return
	}
	release, err := s.verifyIOSPhotoOriginalPhysical(c.Request.Context(),
		hold.SHA256, hold.StorageKey, hold.ByteSize, hold.Kind)
	if err != nil {
		fail(c, http.StatusConflict, "retained physical original unavailable")
		return
	}
	defer release()
	request := iosPhotoHoldRequest{
		NodeID: hold.NodeID, NodeRevision: hold.NodeRevision,
		SessionID: hold.SessionID, SHA256: hold.SHA256,
		ByteSize: hold.ByteSize, Kind: hold.Kind,
	}
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		_, _, err := s.verifyIOSPhotoHoldTx(c.Request.Context(), tx, c, scope, request, &hold)
		if err != nil {
			return err
		}
		var current meta.IOSPhotoOriginalHold
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("id = ? AND owner_id = ?", hold.ID, scope.ownerID).Take(&current).Error; err != nil {
			return err
		}
		if current.SHA256 != hold.SHA256 || current.NodeRevision != hold.NodeRevision ||
			current.StorageKey != hold.StorageKey || current.Kind != hold.Kind {
			return errIOSPhotoHoldDenied
		}
		return nil
	})
	if err != nil {
		fail(c, http.StatusConflict, "original retention proof expired or changed")
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.JSON(http.StatusOK, iosPhotoHoldResponse(hold))
}
