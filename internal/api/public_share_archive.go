package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	pathpkg "path"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	// A public ZIP is one explicitly requested, bounded download. It must not
	// spawn unbounded anonymous worker jobs or traverse the account root.
	publicShareArchiveMaxBytes    int64 = 100 << 30
	publicShareArchiveStartWindow       = 10 * time.Minute
	publicShareArchiveStartLimit  int64 = 3
	publicShareArchiveTicketTTL         = 5 * time.Minute
)

type publicShareArchiveRequest struct {
	Password  string `json:"password"`
	PrepareID string `json:"prepare_id,omitempty"`
	FolderID  uint64 `json:"folder_id,omitempty"`
}

type publicShareArchiveStatus struct {
	PrepareID  string `json:"prepare_id"`
	State      string `json:"state"`
	Filename   string `json:"filename,omitempty"`
	TotalBytes int64  `json:"total_bytes,omitempty"`
	Error      string `json:"error,omitempty"`
}

var errPublicArchiveLimited = errors.New("public archive prepare rate limit reached")

func (s *Server) publicShareArchiveInput(c *gin.Context) (meta.Share, meta.Node, publicShareArchiveRequest, bool) {
	var req publicShareArchiveRequest
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return meta.Share{}, meta.Node{}, req, false
	}
	share, root, err := s.resolvePublicShare(
		c.Request.Context(), c.GetHeader("X-XDrive-Share-Token"), time.Now().UTC(),
	)
	if err != nil {
		writePublicShareLookupError(c, err)
		return meta.Share{}, meta.Node{}, req, false
	}
	if root.Type != meta.NodeTypeDir || root.ParentID == nil {
		fail(c, http.StatusBadRequest, "folder share required")
		return meta.Share{}, meta.Node{}, req, false
	}
	if share.PasswordHash != "" &&
		(req.Password == "" || auth.CheckPassword(share.PasswordHash, req.Password) != nil) {
		fail(c, http.StatusUnauthorized, "share_password_invalid")
		return meta.Share{}, meta.Node{}, req, false
	}
	return share, root, req, true
}

// Resolve a folder strictly inside the capability root. This helper never
// grants the recipient a private account/archive API: a moved-out folder,
// sibling, foreign owner or deleted subtree is denied by the bounded ancestor
// walk. folderID=0 preserves existing root ZIP links.
func (s *Server) publicShareArchiveSelectedFolder(
	ctx context.Context, share meta.Share, shareRoot meta.Node, folderID uint64,
) (meta.Node, error) {
	if folderID == 0 || folderID == shareRoot.ID {
		return shareRoot, nil
	}
	allowed, err := s.publicFolderShareContainsNode(ctx, share.OwnerID, shareRoot.ID, folderID)
	if err != nil {
		return meta.Node{}, err
	}
	if !allowed {
		return meta.Node{}, gorm.ErrRecordNotFound
	}
	var target meta.Node
	if err := s.DB.WithContext(ctx).
		Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			folderID, share.OwnerID, meta.NodeTypeDir).
		First(&target).Error; err != nil {
		return meta.Node{}, err
	}
	if target.ParentID == nil {
		return meta.Node{}, gorm.ErrRecordNotFound
	}
	return target, nil
}

func (s *Server) publicShareArchiveSelectedRunFolder(
	ctx context.Context, share meta.Share, root meta.Node, run meta.ArchivePrepareRun,
) (meta.Node, error) {
	ids, err := archivePrepareIDs(run)
	if err != nil || len(ids) != 1 || ids[0] == 0 {
		return meta.Node{}, errArchiveProgressMismatch
	}
	target, err := s.publicShareArchiveSelectedFolder(ctx, share, root, ids[0])
	if err != nil {
		if ctx.Err() != nil {
			return meta.Node{}, ctx.Err()
		}
		return meta.Node{}, errArchiveProgressMismatch
	}
	return target, nil
}

// Public browsing has no ZIP side effects; preparation only begins after the
// recipient explicitly requests the entire folder download.
func (s *Server) publicShareArchivePrepare(c *gin.Context) {
	share, root, req, ok := s.publicShareArchiveInput(c)
	if !ok {
		return
	}
	selected, err := s.publicShareArchiveSelectedFolder(c.Request.Context(), share, root, req.FolderID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "shared folder not found")
		} else {
			fail(c, http.StatusInternalServerError, "folder scope lookup failed")
		}
		return
	}
	requestedIDsJSON, err := json.Marshal([]uint64{selected.ID})
	if err != nil {
		fail(c, http.StatusInternalServerError, "invalid archive selection")
		return
	}

	var run meta.ArchivePrepareRun
	newRun := false
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var locked meta.Share
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", share.ID).First(&locked).Error; err != nil {
			return err
		}
		if shareStatus(locked, time.Now().UTC()) != "active" ||
			locked.OwnerID != root.OwnerID || locked.NodeID != root.ID {
			return errShareUnavailable
		}

		// Deduplicate per selected subtree, not simply by share ID: a
		// completed root ZIP must not block the recipient's nested ZIP.
		// Only one live preparation per share is admitted at a time.
		var existing meta.ArchivePrepareRun
		err := tx.Where("owner_id = ? AND public_share_id = ? AND public_root_revision = ? AND requested_ids_json = ? AND expires_at > ? AND status IN ?",
			root.OwnerID, share.ID, root.Revision, string(requestedIDsJSON), time.Now().UTC(),
			[]string{meta.ArchivePrepareStatusQueued, meta.ArchivePrepareStatusRunning, meta.ArchivePrepareStatusCancelRequested, meta.ArchivePrepareStatusCompleted}).
			Order("created_at DESC").Take(&existing).Error
		if err == nil {
			run = existing
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var otherActive int64
		if err := tx.Model(&meta.ArchivePrepareRun{}).
			Where("owner_id = ? AND public_share_id = ? AND public_root_revision = ? AND expires_at > ? AND status IN ?",
				root.OwnerID, share.ID, root.Revision, time.Now().UTC(),
				[]string{meta.ArchivePrepareStatusQueued, meta.ArchivePrepareStatusRunning, meta.ArchivePrepareStatusCancelRequested}).
			Count(&otherActive).Error; err != nil {
			return err
		}
		if otherActive != 0 {
			return errPublicArchiveLimited
		}

		var started int64
		if err := tx.Model(&meta.ArchivePrepareRun{}).
			Where("public_share_id = ? AND created_at >= ?", share.ID,
				time.Now().UTC().Add(-publicShareArchiveStartWindow)).
			Count(&started).Error; err != nil {
			return err
		}
		if started >= publicShareArchiveStartLimit {
			return errPublicArchiveLimited
		}
		now := time.Now().UTC()
		run = meta.ArchivePrepareRun{
			ID: uuid.NewString(), OwnerID: root.OwnerID, PublicShareID: &share.ID,
			PublicRootRevision: root.Revision,
			RequestedIDsJSON:   string(requestedIDsJSON), Status: meta.ArchivePrepareStatusQueued,
			ExpiresAt: now.Add(archiveDownloadProgressTTL), CreatedAt: now, UpdatedAt: now,
		}
		if err := tx.Create(&run).Error; err != nil {
			return err
		}
		newRun = true
		return nil
	})
	if err != nil {
		switch {
		case errors.Is(err, errShareUnavailable):
			fail(c, http.StatusGone, "share_unavailable")
		case errors.Is(err, errPublicArchiveLimited):
			fail(c, http.StatusTooManyRequests, "too many ZIP preparations")
		case errors.Is(err, errArchiveProgressMismatch):
			fail(c, http.StatusConflict, "archive prepare mismatch")
		default:
			fail(c, http.StatusInternalServerError, "archive prepare failed")
		}
		return
	}
	if newRun {
		// Existing durable scheduler retries queued runs after process/server
		// restart and owns cancellation independently from this HTTP request.
		if err := s.submitArchivePrepareRun(run); err != nil &&
			!errors.Is(err, background.ErrQueueFull) {
			// The durable queued run is still eligible for reconciliation.
			_ = c.Error(err)
		}
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusAccepted, publicShareArchivePublicStatus(run))
}

func publicShareArchivePublicStatus(run meta.ArchivePrepareRun) publicShareArchiveStatus {
	result := publicShareArchiveStatus{PrepareID: run.ID, State: run.Status}
	if run.Status == meta.ArchivePrepareStatusCompleted {
		result.Filename = run.Filename
		result.TotalBytes = run.TotalBytes
	}
	if run.Status == meta.ArchivePrepareStatusFailed || run.Status == meta.ArchivePrepareStatusCancelled {
		// Public recipients must never see Owner/SQL/storage key paths.
		result.Error = "ZIP 准备失败或已取消，请重新尝试。"
	}
	return result
}

func (s *Server) loadPublicShareArchiveRun(
	ctx context.Context, share meta.Share, root meta.Node, prepareID string, includeManifest bool,
) (meta.ArchivePrepareRun, error) {
	if _, err := uuid.Parse(prepareID); err != nil {
		return meta.ArchivePrepareRun{}, gorm.ErrRecordNotFound
	}
	query := s.DB.WithContext(ctx).Where(
		"id = ? AND owner_id = ? AND public_share_id = ? AND public_root_revision = ?",
		prepareID, share.OwnerID, share.ID, root.Revision)
	if !includeManifest {
		query = query.Select("id, owner_id, public_share_id, public_root_revision, requested_ids_json, status, filename, total_bytes, expires_at")
	}
	var run meta.ArchivePrepareRun
	if err := query.Take(&run).Error; err != nil {
		return meta.ArchivePrepareRun{}, err
	}
	if _, err := s.publicShareArchiveSelectedRunFolder(ctx, share, root, run); err != nil {
		return meta.ArchivePrepareRun{}, err
	}
	if !time.Now().UTC().Before(run.ExpiresAt) {
		return meta.ArchivePrepareRun{}, errArchivePrepareExpired
	}
	return run, nil
}

func writePublicArchiveRunError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		fail(c, http.StatusNotFound, "ZIP 准备任务不存在")
	case errors.Is(err, errArchivePrepareExpired):
		fail(c, http.StatusGone, "ZIP 准备已过期")
	case errors.Is(err, errArchiveProgressMismatch):
		fail(c, http.StatusConflict, "文件夹已更改，请重新准备 ZIP")
	default:
		fail(c, http.StatusInternalServerError, "读取 ZIP 准备任务失败")
	}
}

func (s *Server) publicShareArchiveStatus(c *gin.Context) {
	share, root, req, ok := s.publicShareArchiveInput(c)
	if !ok {
		return
	}
	run, err := s.loadPublicShareArchiveRun(c.Request.Context(), share, root, req.PrepareID, false)
	if err != nil {
		writePublicArchiveRunError(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, publicShareArchivePublicStatus(run))
}

func (s *Server) publicShareArchiveCancel(c *gin.Context) {
	share, root, req, ok := s.publicShareArchiveInput(c)
	if !ok {
		return
	}
	run, err := s.loadPublicShareArchiveRun(c.Request.Context(), share, root, req.PrepareID, false)
	if err != nil {
		writePublicArchiveRunError(c, err)
		return
	}
	if err := s.requestArchivePrepareCancel(c.Request.Context(), run); err != nil {
		fail(c, http.StatusConflict, "ZIP 准备已完成或不能取消")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, publicShareArchiveStatus{PrepareID: run.ID, State: meta.ArchivePrepareStatusCancelRequested})
}

func (s *Server) loadPublicArchiveManifest(ctx context.Context, run meta.ArchivePrepareRun) (archiveDownloadManifest, error) {
	if run.Status != meta.ArchivePrepareStatusCompleted || run.ManifestJSON == "" {
		return archiveDownloadManifest{}, errArchivePrepareUnavailable
	}
	var stored archivePreparedManifest
	if err := json.Unmarshal([]byte(run.ManifestJSON), &stored); err != nil {
		return archiveDownloadManifest{}, errArchiveProgressMismatch
	}
	if stored.TotalBytes > publicShareArchiveMaxBytes || stored.TotalBytes < 0 ||
		len(stored.Entries) == 0 || len(stored.Entries) > archiveDownloadMaxEntries {
		return archiveDownloadManifest{}, errArchiveTooManyEntries
	}
	return archiveDownloadManifest{Entries: stored.Entries, TotalBytes: stored.TotalBytes}, nil
}

// Verify a durable public ZIP manifest *again* before issuing a ticket and at
// actual stream start. A file moved out, revised, renamed, removed or inserted
// after preparation cannot be exposed by a stale public capability.
func (s *Server) verifyPublicArchiveSnapshot(
	ctx context.Context, ownerID uint64, root meta.Node, manifest archiveDownloadManifest,
) error {
	if root.Type != meta.NodeTypeDir || root.ParentID == nil ||
		len(manifest.Entries) == 0 || len(manifest.Entries) > archiveDownloadMaxEntries {
		return errArchiveProgressMismatch
	}
	if manifest.TotalBytes < 0 || manifest.TotalBytes > publicShareArchiveMaxBytes {
		return errArchiveTooManyEntries
	}
	if _, err := archiveSelectedAncestorCoverage(ctx, s.DB, ownerID, []uint64{root.ID}); err != nil {
		return errArchiveProgressMismatch
	}
	children, err := loadArchiveDownloadSubtree(ctx, s.DB, ownerID, root.ID)
	if err != nil {
		return err
	}
	byID := make(map[uint64]meta.Node, len(manifest.Entries))
	byID[root.ID] = root
	for _, siblings := range children {
		for _, node := range siblings {
			if _, exists := byID[node.ID]; exists {
				return errArchiveProgressMismatch
			}
			byID[node.ID] = node
		}
	}
	if len(byID) != len(manifest.Entries) {
		return errArchiveProgressMismatch
	}

	paths := map[uint64]string{root.ID: root.Name}
	busy := make(map[uint64]bool)
	var resolvePath func(uint64, int) (string, error)
	resolvePath = func(id uint64, depth int) (string, error) {
		if path, ok := paths[id]; ok {
			return path, nil
		}
		if depth > 128 || busy[id] {
			return "", errArchiveProgressMismatch
		}
		node, ok := byID[id]
		if !ok || node.ParentID == nil {
			return "", errArchiveProgressMismatch
		}
		if _, err := archivePathSegment(node.Name); err != nil {
			return "", errArchiveProgressMismatch
		}
		busy[id] = true
		parentPath, err := resolvePath(*node.ParentID, depth+1)
		delete(busy, id)
		if err != nil {
			return "", err
		}
		path := pathpkg.Join(parentPath, node.Name)
		paths[id] = path
		return path, nil
	}
	var sum int64
	seen := make(map[uint64]struct{}, len(manifest.Entries))
	for _, entry := range manifest.Entries {
		if err := ctx.Err(); err != nil {
			return err
		}
		node, ok := byID[entry.NodeID]
		if !ok || entry.NodeID == 0 || node.Revision != entry.Revision || node.ParentID == nil ||
			*node.ParentID != entry.ParentID {
			return errArchiveProgressMismatch
		}
		if _, duplicate := seen[entry.NodeID]; duplicate {
			return errArchiveProgressMismatch
		}
		seen[entry.NodeID] = struct{}{}
		expected, err := resolvePath(node.ID, 0)
		if err != nil {
			return err
		}
		if entry.IsDir {
			if node.Type != meta.NodeTypeDir || entry.Path != expected+"/" {
				return errArchiveProgressMismatch
			}
		} else {
			if node.Type != meta.NodeTypeFile || node.File == nil ||
				entry.Path != expected || node.File.StorageKey != entry.StorageKey ||
				node.File.Size != entry.Size || entry.Size < 0 ||
				sum > publicShareArchiveMaxBytes-entry.Size {
				return errArchiveProgressMismatch
			}
			sum += entry.Size
		}
	}
	if len(seen) != len(byID) || sum != manifest.TotalBytes {
		return errArchiveProgressMismatch
	}
	return nil
}

func (s *Server) publicShareArchiveTicket(c *gin.Context) {
	share, root, req, ok := s.publicShareArchiveInput(c)
	if !ok {
		return
	}
	run, err := s.loadPublicShareArchiveRun(c.Request.Context(), share, root, req.PrepareID, true)
	if err != nil {
		writePublicArchiveRunError(c, err)
		return
	}
	if run.Status != meta.ArchivePrepareStatusCompleted {
		fail(c, http.StatusConflict, "ZIP 尚未准备完成")
		return
	}
	selected, err := s.publicShareArchiveSelectedRunFolder(c.Request.Context(), share, root, run)
	if err != nil {
		fail(c, http.StatusConflict, "文件夹已离开分享范围")
		return
	}
	manifest, err := s.loadPublicArchiveManifest(c.Request.Context(), run)
	if err == nil {
		err = s.verifyPublicArchiveSnapshot(c.Request.Context(), share.OwnerID, selected, manifest)
	}
	if err != nil {
		if errors.Is(err, errArchiveProgressMismatch) {
			// A stale completed run must not trap the recipient in a reused
			// invalid snapshot: the next explicit click creates a fresh one.
			_ = s.DB.WithContext(c.Request.Context()).Model(&meta.ArchivePrepareRun{}).
				Where("id = ? AND status = ?", run.ID, meta.ArchivePrepareStatusCompleted).
				Update("status", meta.ArchivePrepareStatusFailed).Error
		}
		fail(c, http.StatusConflict, "文件夹已变化或超出 ZIP 限制，请重新准备")
		return
	}

	now := time.Now().UTC()
	var token string
	var expires time.Time
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var current meta.Share
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", share.ID).First(&current).Error; err != nil {
			return err
		}
		if shareStatus(current, now) != "active" || current.OwnerID != root.OwnerID ||
			current.NodeID != root.ID {
			return errShareUnavailable
		}
		var owner meta.User
		if err := tx.Select("id", "disabled_at").First(&owner, current.OwnerID).Error; err != nil {
			return err
		}
		if owner.DisabledAt != nil {
			return errShareUnavailable
		}
		var live meta.Node
		if err := tx.Select("id", "revision").
			Where("id = ? AND owner_id = ? AND type = ? AND revision = ? AND deleted_at IS NULL",
				root.ID, root.OwnerID, meta.NodeTypeDir, root.Revision).
			First(&live).Error; err != nil {
			return errArchiveProgressMismatch
		}
		ttl := min(publicShareArchiveTicketTTL, run.ExpiresAt.Sub(now))
		if current.ExpiresAt != nil {
			ttl = min(ttl, current.ExpiresAt.Sub(now))
		}
		if ttl <= 0 {
			return errShareUnavailable
		}
		var err error
		token, expires, err = s.Auth.IssuePublicShareArchive(current.ID, root.ID, root.Revision, run.ID, ttl)
		if err != nil {
			return err
		}
		result := tx.Model(&meta.Share{}).
			Where("id = ? AND download_count = ?", current.ID, current.DownloadCount).
			Update("download_count", gorm.Expr("download_count + 1"))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errShareUnavailable
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, errShareUnavailable) {
			fail(c, http.StatusGone, "share_unavailable")
		} else {
			fail(c, http.StatusConflict, "ZIP 下载票据生成失败")
		}
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, publicShareDownloadTicketDTO{
		URL:       fmt.Sprintf("/api/v1/public-share-archive/%d?ticket=%s", share.ID, url.QueryEscape(token)),
		ExpiresAt: expires.UTC(),
	})
}

func (s *Server) publicShareArchiveStream(c *gin.Context) {
	shareID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid share id")
		return
	}
	claims, err := s.Auth.ParsePublicShareArchive(strings.TrimSpace(c.Query("ticket")))
	if err != nil || claims.ShareID != shareID {
		fail(c, http.StatusUnauthorized, "invalid public archive ticket")
		return
	}
	var share meta.Share
	if err := s.DB.WithContext(c.Request.Context()).Where("id = ?", shareID).First(&share).Error; err != nil {
		fail(c, http.StatusGone, "share_unavailable")
		return
	}
	now := time.Now().UTC()
	if share.RevokedAt != nil || (share.ExpiresAt != nil && !now.Before(*share.ExpiresAt)) ||
		share.NodeID != claims.RootID {
		fail(c, http.StatusGone, "share_unavailable")
		return
	}
	var owner meta.User
	if err := s.DB.WithContext(c.Request.Context()).Select("id", "disabled_at").
		First(&owner, share.OwnerID).Error; err != nil || owner.DisabledAt != nil {
		fail(c, http.StatusGone, "share_unavailable")
		return
	}
	var root meta.Node
	if err := s.DB.WithContext(c.Request.Context()).
		Where("id = ? AND owner_id = ? AND type = ? AND revision = ? AND deleted_at IS NULL",
			claims.RootID, share.OwnerID, meta.NodeTypeDir, claims.RootRevision).
		First(&root).Error; err != nil || root.ParentID == nil {
		fail(c, http.StatusGone, "share archive is stale")
		return
	}
	run, err := s.loadPublicShareArchiveRun(c.Request.Context(), share, root, claims.PrepareID, true)
	if err != nil {
		writePublicArchiveRunError(c, err)
		return
	}
	selected, err := s.publicShareArchiveSelectedRunFolder(c.Request.Context(), share, root, run)
	if err != nil {
		fail(c, http.StatusConflict, "文件夹已离开分享范围")
		return
	}
	manifest, err := s.loadPublicArchiveManifest(c.Request.Context(), run)
	if err == nil {
		err = s.verifyPublicArchiveSnapshot(c.Request.Context(), share.OwnerID, selected, manifest)
	}
	if err != nil {
		fail(c, http.StatusConflict, "文件夹已变化或 ZIP 无法下载，请重新准备")
		return
	}
	c.Header("Referrer-Policy", "no-referrer")
	s.streamArchiveDownloadEntries(c, manifest, run.Filename, "", true)
}
