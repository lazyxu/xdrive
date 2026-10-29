package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
)

// BG grants are not ordinary User access tokens. These are the *only*
// upload operations reachable by an Owner/Device/Root-bound native grant;
// the actual storage/quota/CSRF/Owner/CAS commit engine remains the existing
// Go UploadSession handlers. Never register a generic /nodes or /uploads
// group under the IOSPhotoBackgroundGrant middleware.
const iosBackgroundOriginalMaxBytes = int64(1_073_741_824 + 1_048_576)

func iosBackgroundOriginalNameValid(name string) bool {
	if meta.ValidateName(name) != nil || !strings.Contains(name, "-xios-") {
		return false
	}
	last := strings.LastIndex(name, "-xios-")
	if last <= 0 {
		return false
	}
	suffix := name[last+len("-xios-"):]
	parts := strings.SplitN(suffix, ".", 2)
	keyed := strings.Split(parts[0], "-")
	if len(keyed) != 2 || len(keyed[0]) != 24 || len(keyed[1]) != 12 {
		return false
	}
	isLowerHex := func(value string) bool {
		for _, ch := range value {
			if (ch < '0' || ch > '9') && (ch < 'a' || ch > 'f') {
				return false
			}
		}
		return true
	}
	if !isLowerHex(keyed[0]) || !isLowerHex(keyed[1]) {
		return false
	}
	if len(parts) == 2 {
		ext := parts[1]
		if len(ext) == 0 || len(ext) > 12 {
			return false
		}
		for _, ch := range ext {
			if (ch < '0' || ch > '9') &&
				(ch < 'a' || ch > 'z') && (ch < 'A' || ch > 'Z') {
				return false
			}
		}
	}
	return true
}

func iosBackgroundUploadInitValid(req uploadInitRequest, grant meta.IOSPhotoBackgroundGrant) bool {
	return req.ParentID != nil && *req.ParentID == grant.RootNodeID &&
		req.NodeID == nil && req.Name != "" &&
		iosBackgroundOriginalNameValid(req.Name) &&
		req.ConflictPolicy == meta.UploadConflictPolicyFail &&
		req.ExpectedRevision == 0 && req.MD5 == "" &&
		req.Size > 0 && req.Size <= iosBackgroundOriginalMaxBytes &&
		req.ChunkSize == defaultUploadChunkSize &&
		req.SHA256 == strings.ToLower(req.SHA256) &&
		validSHA256(req.SHA256) &&
		validIOSUploadResumeLookupKey(req.ResumeKey) &&
		len(req.ChunkSHA256) == 0
}

func iosBackgroundReadJSON(c *gin.Context, maximum int64, destination any) ([]byte, bool) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maximum)
	data, err := io.ReadAll(c.Request.Body)
	if err != nil || len(data) == 0 {
		fail(c, http.StatusBadRequest, "invalid bounded ios photo request")
		return nil, false
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		fail(c, http.StatusBadRequest, "invalid ios photo operation")
		return nil, false
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		fail(c, http.StatusBadRequest, "multiple ios photo operations")
		return nil, false
	}
	return data, true
}

// A signed grant's Owner identity is injected into the *single scoped
// operation* only, after middleware checked the Device secret, account,
// SessionVersion, installed server and current root. This does not make the
// opaque grant a valid bearer token on arbitrary User routes.
func iosBackgroundAuthorizedOwner(c *gin.Context) (meta.IOSPhotoBackgroundGrant, bool) {
	grant, ok := iosPhotoBackgroundGrantFromContext(c)
	if !ok || grant.OwnerID == 0 || grant.RootNodeID == 0 {
		fail(c, http.StatusUnauthorized, "ios photo grant required")
		return meta.IOSPhotoBackgroundGrant{}, false
	}
	c.Set("userID", grant.OwnerID)
	c.Header("Cache-Control", "private, no-store")
	return grant, true
}

func (s *Server) iosBackgroundCreateUpload(c *gin.Context) {
	grant, ok := iosBackgroundAuthorizedOwner(c)
	if !ok {
		return
	}
	body, ok := iosBackgroundReadJSON(c, 16_384, &uploadInitRequest{})
	if !ok {
		return
	}
	var requested uploadInitRequest
	if err := json.Unmarshal(body, &requested); err != nil ||
		!iosBackgroundUploadInitValid(requested, grant) {
		fail(c, http.StatusForbidden, "not an admitted ios photo original")
		return
	}
	c.Request.Body = io.NopCloser(bytes.NewReader(body))
	s.createUploadSession(c)
}

func (s *Server) iosBackgroundOwnedUpload(c *gin.Context) bool {
	grant, ok := iosBackgroundAuthorizedOwner(c)
	if !ok {
		return false
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid scoped upload id")
		return false
	}
	var session meta.UploadSession
	if err := s.DB.WithContext(c.Request.Context()).
		Where("id = ? AND owner_id = ? AND parent_id = ? AND node_id IS NULL",
			id.String(), grant.OwnerID, grant.RootNodeID).
		Take(&session).Error; err != nil ||
		!validIOSUploadResumeLookupKey(session.ResumeKey) ||
		!iosBackgroundOriginalNameValid(session.Name) ||
		session.RequestedName != session.Name ||
		(session.ConflictPolicy != meta.UploadConflictPolicyFail &&
			session.ConflictPolicy != "") ||
		session.TotalSize <= 0 ||
		session.TotalSize > iosBackgroundOriginalMaxBytes ||
		session.ChunkSize != defaultUploadChunkSize ||
		session.SHA256 != strings.ToLower(session.SHA256) ||
		!validSHA256(session.SHA256) {
		fail(c, http.StatusForbidden, "scoped ios upload not found")
		return false
	}
	return true
}

func (s *Server) iosBackgroundGetUpload(c *gin.Context) {
	if !s.iosBackgroundOwnedUpload(c) { return }
	s.getUploadSession(c)
}

func (s *Server) iosBackgroundPutChunk(c *gin.Context) {
	if !s.iosBackgroundOwnedUpload(c) { return }
	// Existing handler enforces exact part index, SHA and current CAS capacity.
	// Limit the actual HTTP stream to one 8-MiB chunk plus framing.
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body,
		defaultUploadChunkSize + 4096)
	s.putUploadChunk(c)
}

func (s *Server) iosBackgroundFinalizeUpload(c *gin.Context) {
	if !s.iosBackgroundOwnedUpload(c) { return }
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	s.finalizeUploadSession(c)
}

// POST body-only exact resume-key match; a 404 remains an unknown ACK and
// NEVER authorizes a new session with a different fingerprint.
func (s *Server) iosBackgroundResumeLookup(c *gin.Context) {
	grant, ok := iosBackgroundAuthorizedOwner(c)
	if !ok { return }
	body, ok := iosBackgroundReadJSON(c, 4096, &iosUploadResumeLookupRequest{})
	if !ok { return }
	var req iosUploadResumeLookupRequest
	if err := json.Unmarshal(body, &req); err != nil ||
		req.ParentID != grant.RootNodeID ||
		req.Size <= 0 || req.Size > iosBackgroundOriginalMaxBytes ||
		req.ChunkSize != defaultUploadChunkSize ||
		!validIOSUploadResumeLookupKey(req.ResumeKey) ||
		!iosBackgroundOriginalNameValid(req.Name) ||
		req.SHA256 != strings.ToLower(req.SHA256) ||
		!validSHA256(req.SHA256) {
		fail(c, http.StatusForbidden, "ios photo resume identity rejected")
		return
	}
	c.Request.Body = io.NopCloser(bytes.NewReader(body))
	s.lookupIOSUploadResumeKey(c)
}

// Minimal current-Owner Node proof. An arbitrary node ID or another Owner's
// file cannot be enumerated through the background grant. The readback must
// correspond to a finalized upload with exactly the same iOS resume namespace.
func (s *Server) iosBackgroundReceipt(c *gin.Context) {
	grant, ok := iosBackgroundAuthorizedOwner(c)
	if !ok { return }
	nodeID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || nodeID == 0 {
		fail(c, http.StatusBadRequest, "invalid ios receipt node id")
		return
	}
	var node meta.Node
	if err := s.DB.WithContext(c.Request.Context()).Preload("File").
		Where("id = ? AND owner_id = ? AND parent_id = ? AND type = ? AND deleted_at IS NULL",
			nodeID, grant.OwnerID, grant.RootNodeID, meta.NodeTypeFile).
		Take(&node).Error; err != nil || node.File == nil ||
		!iosBackgroundOriginalNameValid(node.Name) {
		fail(c, http.StatusNotFound, "ios original receipt unavailable")
		return
	}
	var sessions []meta.UploadSession
	if err := s.DB.WithContext(c.Request.Context()).
		Where("owner_id = ? AND parent_id = ? AND node_id IS NULL AND result_node_id = ? AND status = ?",
			grant.OwnerID, grant.RootNodeID, node.ID, meta.UploadStatusFinalized).
		Order("created_at DESC, id DESC").Limit(20).Find(&sessions).Error; err != nil {
		fail(c, http.StatusInternalServerError, "ios original receipt proof failed")
		return
	}
	confirmed := false
	for _, candidate := range sessions {
		if validIOSUploadResumeLookupKey(candidate.ResumeKey) &&
			candidate.Name == node.Name &&
			candidate.RequestedName == node.Name &&
			candidate.TotalSize == node.File.Size &&
			candidate.SHA256 == node.File.SHA256 &&
			(candidate.ConflictPolicy == meta.UploadConflictPolicyFail ||
				candidate.ConflictPolicy == "") {
			confirmed = true
			break
		}
	}
	if !confirmed {
		fail(c, http.StatusNotFound, "ios original receipt unavailable")
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id": node.ID, "parent_id": grant.RootNodeID,
		"name": node.Name, "type": meta.NodeTypeFile,
		"size": node.File.Size, "revision": node.Revision,
		"sha256": node.File.SHA256,
	})
}
