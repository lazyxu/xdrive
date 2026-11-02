package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/maintenance"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
)

type viewerCacheStatusDTO struct {
	BudgetBytes int64 `json:"budget_bytes"`
	ObservedBytes int64 `json:"observed_bytes"`
	CandidateBytes int64 `json:"candidate_bytes"`
	CandidateFiles int `json:"candidate_files"`
	OverBudget bool `json:"over_budget"`
}

func (s *Server) viewerCacheBudgetAndRoot(ctx context.Context) (int64, string, error) {
	if s == nil || s.DB == nil {
		return 0, "", errors.New("viewer cache policy database unavailable")
	}
	policy, err := s.readAdminViewerQualityMaximum(ctx)
	if err != nil {
		return 0, "", err
	}
	if !validViewerCacheBudget(policy.CacheBudgetBytes) {
		return 0, "", errors.New("invalid administrator cache budget")
	}
	local, ok := s.Store.(storage.FilesystemRootProvider)
	if !ok || local.FilesystemRoot() == "" {
		return 0, "", errors.New("Viewer cache cleanup requires local managed storage")
	}
	return policy.CacheBudgetBytes, local.FilesystemRoot(), nil
}

// GET only observes actual disk files. The report is diagnostic, and any
// queued image render may change it immediately after the response.
func (s *Server) adminViewerCacheStatus(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	budget, root, err := s.viewerCacheBudgetAndRoot(c.Request.Context())
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Viewer cache inventory unavailable")
		return
	}
	inventory, err := maintenance.ScanViewerVariantCache(
		c.Request.Context(), root, budget, time.Now().UTC(),
	)
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Viewer cache inventory failed")
		return
	}
	c.JSON(http.StatusOK, viewerCacheStatusDTO{
		BudgetBytes: budget, ObservedBytes: inventory.Plan.ObservedBytes,
		CandidateBytes: inventory.Plan.EvictBytes,
		CandidateFiles: len(inventory.Plan.Keys),
		OverBudget: inventory.Plan.OverBudget,
	})
}

// Only the existing authenticated admin group may invoke this endpoint.
// POST {"dry_run":true} never deletes; {"dry_run":false} requires both
// the exclusive PG writer lock and a nonblocking exclusive Viewer reader
// lifetime lock before physical deletion. Missing locks always fail closed.
func (s *Server) adminEvictViewerCache(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 128)
	var request struct {
		DryRun *bool `json:"dry_run"`
	}
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if decoder.Decode(&request) != nil || request.DryRun == nil {
		fail(c, http.StatusBadRequest, "explicit dry_run required")
		return
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		fail(c, http.StatusBadRequest, "one Viewer eviction request allowed")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Minute)
	defer cancel()
	budget, root, err := s.viewerCacheBudgetAndRoot(ctx)
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Viewer cache policy unavailable")
		return
	}
	if *request.DryRun {
		inventory, err := maintenance.ScanViewerVariantCache(ctx, root, budget, time.Now().UTC())
		if err != nil {
			fail(c, http.StatusServiceUnavailable, "Viewer cache dry run unavailable")
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"dry_run": true, "plan": inventory.Plan,
			"candidate_files": len(inventory.Plan.Keys),
		})
		return
	}
	locker, ok := s.Store.(storage.ViewerCacheLifecycleLocker)
	if !ok {
		fail(c, http.StatusServiceUnavailable, "Viewer cache reader fencing unavailable")
		return
	}
	// The write lock must precede the Viewer read lock: no active image
	// renderer can publish a stale entry while eviction scans its directory.
	var result maintenance.ViewerVariantCacheApplyResult
	var busy bool
	err = s.withMediaCacheAdvisoryLock(ctx, true, func(_ *gorm.DB) error {
		release, acquired, lockErr := locker.TryExclusiveViewerCacheEviction(ctx)
		if lockErr != nil {
			return lockErr
		}
		if !acquired {
			busy = true
			return nil
		}
		defer release()
		var applyErr error
		result, applyErr = maintenance.EvictViewerVariantCacheAssumingExclusiveLease(
			ctx, root, budget, time.Now().UTC(),
		)
		return applyErr
	})
	if busy {
		fail(c, http.StatusConflict, "Viewer cache is being read; retry eviction later")
		return
	}
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Viewer cache eviction unavailable")
		return
	}
	s.invalidateStorageInventory()
	s.recordAuditBestEffort(c, auditpkg.Event{
		Action: auditpkg.ActionAdminStorageCleanup,
		TargetType: "storage",
		TargetLabel: "viewer-quality",
		Result: auditpkg.ResultSuccess,
		Metadata: map[string]any{
			"kind": "viewer-quality", "deleted_files": result.DeletedFiles,
			"deleted_bytes": result.DeletedBytes, "budget_bytes": budget,
		},
	})
	c.JSON(http.StatusOK, gin.H{"dry_run": false, "result": result})
}
