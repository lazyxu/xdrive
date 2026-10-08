package api

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
)

const (
	downloadTransferFlushInterval = 500 * time.Millisecond
	downloadTransferFlushBytes    = 32 << 20
	downloadTransferRetention     = 30 * time.Minute
	downloadTransferEventBuffer   = 8
)

type downloadTransferProgressDTO struct {
	TransferID string     `json:"transfer_id"`
	Status     string     `json:"status"`
	BytesDone  int64      `json:"bytes_done"`
	BytesTotal int64      `json:"bytes_total"`
	Error      string     `json:"error,omitempty"`
	StartedAt  *time.Time `json:"started_at,omitempty"`
	UpdatedAt  time.Time  `json:"updated_at"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`
}

func (s *Server) createDownloadTransfer(
	ctx context.Context,
	id string,
	ownerID uint64,
	resourceKind, resourceID, fileName string,
	bytesTotal int64,
	ticketExpiresAt time.Time,
) bool {
	if s.DB == nil || strings.TrimSpace(id) == "" || ownerID == 0 {
		return false
	}
	now := time.Now().UTC()
	_ = s.DB.WithContext(ctx).
		Where("expires_at < ?", now).
		Delete(&meta.DownloadTransfer{}).Error
	item := meta.DownloadTransfer{
		ID:           id,
		OwnerID:      ownerID,
		ResourceKind: strings.TrimSpace(resourceKind),
		ResourceID:   strings.TrimSpace(resourceID),
		FileName:     fileName,
		BytesTotal:   max(int64(0), bytesTotal),
		Status:       meta.DownloadTransferStatusQueued,
		ExpiresAt:    ticketExpiresAt.UTC().Add(downloadTransferRetention),
	}
	return s.DB.WithContext(ctx).Create(&item).Error == nil
}

func (s *Server) getDownloadTransfer(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		fail(c, http.StatusBadRequest, "invalid download transfer id")
		return
	}
	var item meta.DownloadTransfer
	if err := s.DB.WithContext(c.Request.Context()).
		Where("id = ? AND owner_id = ? AND expires_at > ?", id, userID(c), time.Now().UTC()).
		First(&item).Error; err != nil {
		fail(c, http.StatusNotFound, "download transfer not found")
		return
	}
	done := max(int64(0), item.BytesSent)
	if item.BytesTotal > 0 && done > item.BytesTotal {
		done = item.BytesTotal
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, downloadTransferProgressDTO{
		TransferID: item.ID,
		Status:     item.Status,
		BytesDone:  done,
		BytesTotal: max(int64(0), item.BytesTotal),
		Error:      item.Error,
		StartedAt:  item.StartedAt,
		UpdatedAt:  item.UpdatedAt,
		FinishedAt: item.FinishedAt,
	})
}

type downloadTransferFinal struct {
	statusCode   int
	responseRead int64
	bytesTotal   int64
	requestErr   error
}

type downloadTransferEvent struct {
	delta int64
	final *downloadTransferFinal
}

type downloadTransferReadSeeker struct {
	io.ReadSeeker
	events     chan downloadTransferEvent
	pending    int64
	read       int64
	lastReport time.Time
}

func newDownloadTransferReadSeeker(
	server *Server,
	transferID string,
	reader io.ReadSeeker,
) *downloadTransferReadSeeker {
	tracker := &downloadTransferReadSeeker{
		ReadSeeker: reader,
		events:     make(chan downloadTransferEvent, downloadTransferEventBuffer),
	}
	go tracker.run(server, transferID)
	return tracker
}

func (r *downloadTransferReadSeeker) Read(p []byte) (int, error) {
	n, err := r.ReadSeeker.Read(p)
	if n > 0 {
		r.pending += int64(n)
		r.read += int64(n)
	}
	r.publish(err != nil)
	return n, err
}

func (r *downloadTransferReadSeeker) publish(force bool) {
	if r.pending <= 0 {
		return
	}
	now := time.Now()
	if !force &&
		r.pending < downloadTransferFlushBytes &&
		!r.lastReport.IsZero() &&
		now.Sub(r.lastReport) < downloadTransferFlushInterval {
		return
	}
	event := downloadTransferEvent{delta: r.pending}
	select {
	case r.events <- event:
		r.pending = 0
		r.lastReport = now
	default:
		// Keep accumulating locally. Statistics must never backpressure the file stream.
	}
}

func (r *downloadTransferReadSeeker) finish(statusCode int, bytesTotal int64, requestErr error) {
	r.publish(true)
	final := downloadTransferEvent{
		delta: r.pending,
		final: &downloadTransferFinal{
			statusCode:   statusCode,
			responseRead: r.read,
			bytesTotal:   bytesTotal,
			requestErr:   requestErr,
		},
	}
	r.pending = 0
	select {
	case r.events <- final:
	default:
		go func() { r.events <- final }()
	}
}

func (r *downloadTransferReadSeeker) run(server *Server, transferID string) {
	var uncommitted int64
	var retryAfter time.Time
	for event := range r.events {
		uncommitted += max(int64(0), event.delta)
		if event.final == nil {
			if !retryAfter.IsZero() && time.Now().Before(retryAfter) {
				continue
			}
			if server.addDownloadTransferBytes(transferID, uncommitted) {
				uncommitted = 0
				retryAfter = time.Time{}
			} else {
				retryAfter = time.Now().Add(time.Second)
			}
			continue
		}
		server.finishDownloadTransferResponse(
			transferID,
			uncommitted,
			event.final.statusCode,
			event.final.responseRead,
			event.final.bytesTotal,
			event.final.requestErr,
		)
		return
	}
}

func (s *Server) addDownloadTransferBytes(id string, delta int64) bool {
	if s.DB == nil || strings.TrimSpace(id) == "" || delta <= 0 {
		return false
	}
	now := time.Now().UTC()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	result := s.DB.WithContext(ctx).Exec(`
UPDATE xd_download_transfers
SET bytes_sent = bytes_sent + ?,
    status = CASE
        WHEN status IN (?, ?) THEN status
        ELSE ?
    END,
    error = CASE
        WHEN status IN (?, ?) THEN error
        ELSE ''
    END,
    started_at = COALESCE(started_at, ?),
    updated_at = ?
WHERE id = ? AND expires_at > ?
`,
		delta,
		meta.DownloadTransferStatusCompleted,
		meta.DownloadTransferStatusFailed,
		meta.DownloadTransferStatusRunning,
		meta.DownloadTransferStatusCompleted,
		meta.DownloadTransferStatusFailed,
		now,
		now,
		id,
		now,
	)
	return result.Error == nil && result.RowsAffected == 1
}

func (s *Server) finishDownloadTransferResponse(
	id string,
	uncommitted int64,
	statusCode int,
	responseRead, bytesTotal int64,
	requestErr error,
) {
	if s.DB == nil || strings.TrimSpace(id) == "" {
		return
	}
	now := time.Now().UTC()
	nextStatus := meta.DownloadTransferStatusRunning
	errText := ""
	var finishedAt *time.Time
	switch {
	case statusCode >= http.StatusBadRequest:
		nextStatus = meta.DownloadTransferStatusFailed
		errText = fmt.Sprintf("HTTP %d", statusCode)
		finishedAt = &now
	case requestErr != nil:
		// Native browsers may cancel one range request and immediately resume
		// with another. Keep the browser-owned transfer resumable.
		nextStatus = meta.DownloadTransferStatusRunning
	case bytesTotal <= 0 || responseRead >= bytesTotal:
		nextStatus = meta.DownloadTransferStatusCompleted
		finishedAt = &now
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = s.DB.WithContext(ctx).Exec(`
UPDATE xd_download_transfers
SET bytes_sent = bytes_sent + ?,
    status = CASE
        WHEN status = ? THEN status
        ELSE ?
    END,
    error = CASE
        WHEN status = ? THEN error
        ELSE ?
    END,
    started_at = COALESCE(started_at, ?),
    finished_at = CASE
        WHEN status = ? THEN finished_at
        ELSE ?
    END,
    updated_at = ?
WHERE id = ? AND expires_at > ?
`,
		max(int64(0), uncommitted),
		meta.DownloadTransferStatusCompleted,
		nextStatus,
		meta.DownloadTransferStatusCompleted,
		errText,
		now,
		meta.DownloadTransferStatusCompleted,
		finishedAt,
		now,
		id,
		now,
	).Error
}

func (s *Server) serveTrackedDownloadContent(
	c *gin.Context,
	transferID, name string,
	updatedAt time.Time,
	file io.ReadSeeker,
	bytesTotal int64,
) {
	tracker := newDownloadTransferReadSeeker(s, transferID, file)
	http.ServeContent(c.Writer, c.Request, name, updatedAt, tracker)
	tracker.finish(
		c.Writer.Status(),
		bytesTotal,
		c.Request.Context().Err(),
	)
}
