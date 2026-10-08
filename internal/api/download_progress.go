package api

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const (
	downloadProgressInterval   = time.Second
	downloadProgressStaleAfter = 30 * time.Second
	downloadProgressRetention  = 30 * time.Minute
	downloadProgressDBTimeout  = time.Second
	downloadProgressFinishWait = 2 * time.Second
	downloadProgressRetryDelay = 100 * time.Millisecond
)

type downloadProgressDTO struct {
	TransferID string    `json:"transfer_id"`
	State      string    `json:"state"`
	BytesSent  int64     `json:"bytes_sent"`
	BytesTotal int64     `json:"bytes_total"`
	UpdatedAt  time.Time `json:"updated_at"`
	Error      string    `json:"error,omitempty"`
}

// The signed token's JTI owns the observation. Failure of this optional side
// channel must never prevent ticket issuance or an otherwise valid download.
func (s *Server) createDownloadProgress(ctx context.Context, token string, total int64) string {
	claims, err := s.Auth.ParseDownloadStream(token)
	if err != nil || claims.ID == "" || s.DB == nil {
		return ""
	}
	now := time.Now().UTC()
	row := meta.DownloadProgress{
		ID: claims.ID, OwnerID: claims.UserID, SessionVersion: claims.SessionVersion,
		ResourceKind: claims.ResourceKind, State: "queued", BytesTotal: max(int64(0), total),
		UpdatedAt: now, ExpiresAt: now.Add(downloadProgressRetention),
	}
	writeCtx, cancel := context.WithTimeout(ctx, downloadProgressDBTimeout)
	defer cancel()
	if err := s.DB.WithContext(writeCtx).Create(&row).Error; err != nil {
		slog.Warn("download_progress_create_failed", "error", err)
		return ""
	}
	// Expired observations are disposable PostgreSQL metadata. The indexed
	// cleanup is bounded by ticket activity and never touches stored file data.
	if err := s.DB.WithContext(writeCtx).Where("expires_at < ?", now).Delete(&meta.DownloadProgress{}).Error; err != nil {
		slog.Warn("download_progress_cleanup_failed", "error", err)
	}
	return row.ID
}

func (s *Server) getDownloadProgress(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	id := strings.TrimSpace(c.Param("id"))
	if _, err := uuid.Parse(id); err != nil {
		fail(c, http.StatusBadRequest, "invalid transfer id")
		return
	}
	user, ok := currentUser(c)
	if !ok {
		fail(c, http.StatusUnauthorized, "user not found")
		return
	}
	now := time.Now().UTC()
	var row meta.DownloadProgress
	err := s.DB.WithContext(c.Request.Context()).
		Where("id = ? AND owner_id = ? AND session_version = ? AND expires_at > ?", id, user.ID, user.SessionVersion, now).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		fail(c, http.StatusNotFound, "download progress not found")
		return
	}
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "download progress unavailable")
		return
	}
	if row.State == "running" && now.Sub(row.UpdatedAt) > downloadProgressStaleAfter {
		row.State, row.Error = "failed", "download response was interrupted"
	}
	c.JSON(http.StatusOK, downloadProgressDTO{
		TransferID: row.ID, State: row.State, BytesSent: row.BytesSent,
		BytesTotal: row.BytesTotal, UpdatedAt: row.UpdatedAt.UTC(), Error: row.Error,
	})
}

// Concurrent Range requests share a run while each request reports its own
// successful writes. A later retry can start a fresh run using the same ticket;
// cumulative bytes_sent intentionally includes retransmissions. A new run ID
// fences delayed reports after a crashed/stale request has been superseded.
func (s *Server) startDownloadProgress(claims auth.DownloadStreamClaims) string {
	if claims.ID == "" || s.DB == nil {
		return ""
	}
	now := time.Now().UTC()
	ctx, cancel := context.WithTimeout(context.Background(), downloadProgressDBTimeout)
	defer cancel()
	var started struct{ RunID string }
	err := s.DB.WithContext(ctx).Raw(`
UPDATE xd_download_progress
SET run_id = CASE WHEN active_requests = 0 OR updated_at < ? THEN ? ELSE run_id END,
    failure_state = CASE WHEN active_requests = 0 OR updated_at < ? THEN '' ELSE failure_state END,
    error = CASE WHEN active_requests = 0 OR updated_at < ? THEN '' ELSE error END,
    active_requests = CASE WHEN active_requests = 0 OR updated_at < ? THEN 1 ELSE active_requests + 1 END,
    request_reports = CASE WHEN active_requests = 0 OR updated_at < ? THEN '{}'::jsonb ELSE request_reports END,
    bytes_total = CASE WHEN resource_kind = 'archive' THEN 0 ELSE bytes_total END,
    state = 'running', updated_at = ?, expires_at = ?
WHERE id = ? AND owner_id = ? AND session_version = ? AND expires_at > ?
RETURNING run_id`,
		now.Add(-downloadProgressStaleAfter), uuid.NewString(),
		now.Add(-downloadProgressStaleAfter), now.Add(-downloadProgressStaleAfter), now.Add(-downloadProgressStaleAfter), now.Add(-downloadProgressStaleAfter),
		now, now.Add(downloadProgressRetention), claims.ID, claims.UserID, claims.SessionVersion, now,
	).Scan(&started).Error
	if err != nil {
		slog.Warn("download_progress_start_failed", "error", err)
		return ""
	}
	return started.RunID
}

// Every response has a stable request ID and reports its cumulative count.
// The row's per-request ledger makes replay safe after either a rejected write
// or a committed write whose acknowledgment was lost. PostgreSQL evaluates all
// expressions against the locked row's old values, including concurrent Ranges.
func (s *Server) reportDownloadProgress(parent context.Context, claims auth.DownloadStreamClaims, runID, requestID string, sent int64, state, message string) error {
	now := time.Now().UTC()
	ctx, cancel := context.WithTimeout(parent, downloadProgressDBTimeout)
	defer cancel()
	query := s.DB.WithContext(ctx).Model(&meta.DownloadProgress{}).
		Where("id = ? AND owner_id = ? AND session_version = ? AND run_id = ?", claims.ID, claims.UserID, claims.SessionVersion, runID).
		Where("COALESCE((request_reports -> ?::text ->> 'finished')::boolean, false) = false", requestID)
	sent = max(int64(0), sent)
	const deltaSQL = "GREATEST(?::bigint - COALESCE((request_reports -> ?::text ->> 'bytes')::bigint, 0), 0)"
	updates := map[string]any{
		"bytes_sent": gorm.Expr("bytes_sent + "+deltaSQL, sent, requestID),
		"request_reports": gorm.Expr(`jsonb_set(request_reports, ARRAY[?::text],
jsonb_build_object('bytes', GREATEST(?::bigint, COALESCE((request_reports -> ?::text ->> 'bytes')::bigint, 0)), 'finished', ?::boolean), true)`, requestID, sent, requestID, state != ""),
		"updated_at": now, "expires_at": now.Add(downloadProgressRetention),
	}
	if state != "" {
		failure := ""
		if state != "completed" {
			failure = state
		}
		updates["active_requests"] = gorm.Expr("GREATEST(active_requests - 1, 0)")
		updates["failure_state"] = gorm.Expr("CASE WHEN failure_state = 'failed' OR ? = 'failed' THEN 'failed' WHEN failure_state = 'cancelled' OR ? = 'cancelled' THEN 'cancelled' ELSE '' END", failure, failure)
		updates["state"] = gorm.Expr("CASE WHEN active_requests > 1 THEN 'running' WHEN failure_state = 'failed' OR ? = 'failed' THEN 'failed' WHEN failure_state = 'cancelled' OR ? = 'cancelled' THEN 'cancelled' ELSE 'completed' END", failure, failure)
		updates["bytes_total"] = gorm.Expr("CASE WHEN resource_kind = 'archive' AND active_requests <= 1 AND failure_state = '' AND ? = '' THEN bytes_sent + "+deltaSQL+" ELSE bytes_total END", failure, sent, requestID)
		if message != "" {
			updates["error"] = message
		}
	}
	if err := query.Updates(updates).Error; err != nil {
		slog.Warn("download_progress_report_failed", "error", err)
		return err
	}
	return nil
}

type downloadProgressReport struct{ state, message string }

type downloadProgressReporter struct {
	sent   atomic.Int64
	finish chan downloadProgressReport
	done   chan struct{}
}

func (s *Server) downloadProgressReporter(claims auth.DownloadStreamClaims, runID string) *downloadProgressReporter {
	reporter := &downloadProgressReporter{finish: make(chan downloadProgressReport, 1), done: make(chan struct{})}
	requestID := uuid.NewString()
	go func() {
		defer close(reporter.done)
		ticker := time.NewTicker(downloadProgressInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				// Also heartbeat stalled responses. Read polling can distinguish a
				// quiet live connection from an interrupted server process.
				_ = s.reportDownloadProgress(context.Background(), claims, runID, requestID, reporter.sent.Load(), "", "")
			case result := <-reporter.finish:
				s.finishDownloadProgress(claims, runID, requestID, reporter.sent.Load(), result)
				return
			}
		}
	}()
	return reporter
}

func (s *Server) finishDownloadProgress(claims auth.DownloadStreamClaims, runID, requestID string, sent int64, result downloadProgressReport) {
	// The payload is already written. Retry a short-lived observation failure,
	// but never hold response completion indefinitely for optional telemetry.
	ctx, cancel := context.WithTimeout(context.Background(), downloadProgressFinishWait)
	defer cancel()
	for attempt := 0; attempt < 3; attempt++ {
		if err := s.reportDownloadProgress(ctx, claims, runID, requestID, sent, result.state, result.message); err == nil {
			return
		}
		if attempt == 2 {
			return
		}
		timer := time.NewTimer(downloadProgressRetryDelay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

// Track only authenticated native download endpoints. The wrapper observes
// response writes; ordinary archive per-file reader progress stays independent.
func (s *Server) trackDownloadProgress(c *gin.Context, claims auth.DownloadStreamClaims) func() {
	if claims.ID == "" || c.Request.Method != http.MethodGet {
		return func() {}
	}
	original := c.Writer
	writer := &downloadProgressWriter{ResponseWriter: original, request: c.Request}
	var reporter *downloadProgressReporter
	writer.onStart = func() {
		if runID := s.startDownloadProgress(claims); runID != "" {
			reporter = s.downloadProgressReporter(claims, runID)
		}
	}
	writer.onWrite = func(n int64) {
		if reporter != nil {
			reporter.sent.Add(n)
		}
	}
	c.Writer = writer
	return func() {
		panicValue := recover()
		var handlerErr error
		if panicValue != nil {
			handlerErr = errors.New("download handler interrupted")
		} else if last := c.Errors.Last(); last != nil {
			handlerErr = last.Err
		}
		state, message := writer.result(handlerErr)
		if state != "" {
			writer.start() // Includes empty files and failures before body writes.
			if reporter != nil {
				reporter.finish <- downloadProgressReport{state: state, message: message}
				<-reporter.done
			}
		}
		c.Writer = original
		if panicValue != nil {
			panic(panicValue)
		}
	}
}
