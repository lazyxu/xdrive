package api

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/background"
	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

type mediaDerivativeKind string

const (
	mediaDerivativeThumbnail mediaDerivativeKind = "thumbnail"
	mediaDerivativeAnalysis  mediaDerivativeKind = "analysis_preview"

	mediaThumbnailDerivativeVersion = mediapkg.ThumbnailVersion
	mediaDerivativeRunTimeout       = 2 * time.Minute
)

var (
	errMediaDerivativeSchedulerUnavailable = errors.New("media derivative scheduler is unavailable")
	errMediaDerivativeSourceMissing        = errors.New("media derivative source is unavailable")
	errMediaDerivativeUnsupported          = errors.New("media derivative format is unsupported")
)

type mediaDerivativeRequest struct {
	Kind        mediaDerivativeKind
	Priority    background.Priority
	Trigger     background.Trigger
	Initiator   background.Initiator
	InitiatorID uint64
	TraceID     string
}

func (s *Server) ensureMediaDerivative(
	ctx context.Context,
	node meta.Node,
	metadata meta.MediaMetadata,
	req mediaDerivativeRequest,
) (string, error) {
	if s == nil || s.BackgroundScheduler == nil {
		return "", errMediaDerivativeSchedulerUnavailable
	}
	key, edge, version, err := mediaDerivativeIdentity(node, metadata, req.Kind)
	if err != nil {
		return "", err
	}
	if cached, openErr := s.Store.Open(ctx, key); openErr == nil {
		_ = cached.Close()
		return key, nil
	}

	taskKey := fmt.Sprintf(
		"media-derivative:%s:node:%d:revision:%d:sha:%s:edge:%d:v%d",
		req.Kind,
		node.ID,
		node.Revision,
		strings.ToLower(strings.TrimSpace(metadata.SHA256)),
		edge,
		version,
	)
	supersedeKey := fmt.Sprintf(
		"media-derivative:%s:node:%d:edge:%d",
		req.Kind,
		node.ID,
		edge,
	)
	taskKind := "media.thumbnail"
	if req.Kind == mediaDerivativeAnalysis {
		taskKind = "media.analysis_preview"
	}
	handle, err := s.BackgroundScheduler.Submit(background.Task{
		Key:               taskKey,
		Kind:              taskKind,
		GroupKey:          taskKind,
		Scope:             background.ScopeUser,
		OwnerID:           node.OwnerID,
		Trigger:           req.Trigger,
		Initiator:         req.Initiator,
		InitiatorID:       req.InitiatorID,
		TraceID:           strings.TrimSpace(req.TraceID),
		SupersedeKey:      supersedeKey,
		Priority:          req.Priority,
		Resource:          background.ResourceMediaCPU,
		Lease:             s.mediaDerivativeLeaseProvider(taskKey),
		HeartbeatInterval: mediaDerivativeLeaseHeartbeatInterval,
		RunTimeout:        mediaDerivativeRunTimeout,
		Run: func(taskCtx context.Context) error {
			background.ReportProgress(taskCtx, background.TaskProgress{
				Phase: "generating",
				Total: 1,
				Unit:  "item",
			})
			err := s.generateMediaDerivative(
				taskCtx,
				node,
				metadata,
				req.Kind,
				key,
				edge,
			)
			if err == nil {
				background.ReportProgress(taskCtx, background.TaskProgress{
					Phase:   "completed",
					Current: 1,
					Total:   1,
					Unit:    "item",
				})
			}
			return err
		},
	})
	if err != nil {
		return "", err
	}
	if err := handle.Wait(ctx); err != nil {
		return "", err
	}

	cached, err := s.Store.Open(ctx, key)
	if err != nil {
		return "", fmt.Errorf("open generated media derivative: %w", err)
	}
	_ = cached.Close()
	return key, nil
}

func mediaDerivativeIdentity(
	node meta.Node,
	metadata meta.MediaMetadata,
	kind mediaDerivativeKind,
) (key string, edge, version int, err error) {
	switch kind {
	case mediaDerivativeThumbnail:
		return mediaThumbnailStorageKey(node, metadata),
			mediaThumbnailEdge,
			mediaThumbnailDerivativeVersion,
			nil
	case mediaDerivativeAnalysis:
		return mediaAnalysisPreviewStorageKey(node, metadata),
			mediapkg.AnalysisPreviewEdge,
			mediapkg.AnalysisPreviewVersion,
			nil
	default:
		return "", 0, 0, errMediaDerivativeUnsupported
	}
}

func (s *Server) generateMediaDerivative(
	ctx context.Context,
	node meta.Node,
	metadata meta.MediaMetadata,
	kind mediaDerivativeKind,
	key string,
	edge int,
) error {
	allowDeleted := kind == mediaDerivativeThumbnail && node.DeletedAt != nil
	current, err := s.currentMediaDerivativeInput(
		ctx,
		node,
		metadata,
		allowDeleted,
	)
	if err != nil {
		return err
	}
	if cached, openErr := s.Store.Open(ctx, key); openErr == nil {
		_ = cached.Close()
		return nil
	}

	file, err := s.Store.Open(ctx, current.File.StorageKey)
	if err != nil {
		return fmt.Errorf("%w: %v", errMediaDerivativeSourceMissing, err)
	}
	defer file.Close()

	previewSource, err := s.mediaImagePreviewSource(
		ctx,
		current,
		metadata,
		file,
	)
	if err != nil {
		return fmt.Errorf("%w: %v", errMediaDerivativeUnsupported, err)
	}
	preview, err := mediapkg.ThumbnailJPEG(
		previewSource,
		metadata.Orientation,
		edge,
	)
	if err != nil {
		return fmt.Errorf("%w: %v", errMediaDerivativeUnsupported, err)
	}

	if _, err := s.currentMediaDerivativeInput(
		ctx,
		node,
		metadata,
		allowDeleted,
	); err != nil {
		return err
	}
	if _, err := s.Store.Put(ctx, key, bytes.NewReader(preview.Data)); err != nil {
		return fmt.Errorf("store media derivative: %w", err)
	}

	if kind == mediaDerivativeThumbnail {
		now := time.Now().UTC()
		result := s.DB.WithContext(ctx).
			Model(&meta.MediaMetadata{}).
			Where(
				"node_id = ? AND owner_id = ? AND node_revision = ? AND sha256 = ?",
				node.ID,
				node.OwnerID,
				node.Revision,
				metadata.SHA256,
			).
			Updates(map[string]any{
				"thumbnail_key":       key,
				"thumbnail_mime_type": preview.MIMEType,
				"thumbnail_width":     preview.Width,
				"thumbnail_height":    preview.Height,
				"updated_at":          now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return background.ErrSuperseded
		}
	}
	return nil
}

func (s *Server) currentMediaDerivativeInput(
	ctx context.Context,
	expected meta.Node,
	metadata meta.MediaMetadata,
	allowDeleted bool,
) (meta.Node, error) {
	var current meta.Node
	query := s.DB.WithContext(ctx).
		Preload("File").
		Where(
			"id = ? AND owner_id = ? AND type = ?",
			expected.ID,
			expected.OwnerID,
			meta.NodeTypeFile,
		)
	if !allowDeleted {
		query = query.Where("deleted_at IS NULL")
	}
	err := query.First(&current).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return meta.Node{}, errMediaDerivativeSourceMissing
		}
		return meta.Node{}, err
	}
	if current.File == nil {
		return meta.Node{}, errMediaDerivativeSourceMissing
	}
	if current.Revision != expected.Revision ||
		current.File.SHA256 != metadata.SHA256 ||
		(expected.File != nil && current.File.StorageKey != expected.File.StorageKey) {
		return meta.Node{}, background.ErrSuperseded
	}
	return current, nil
}

func (s *Server) tryServeMediaDerivative(
	c *gin.Context,
	key, name, contentType string,
	modifiedAt time.Time,
) bool {
	if strings.TrimSpace(key) == "" {
		return false
	}
	file, err := s.Store.Open(c.Request.Context(), key)
	if err != nil {
		return false
	}
	defer file.Close()
	if strings.TrimSpace(contentType) == "" {
		contentType = "image/jpeg"
	}
	c.Header("Content-Type", contentType)
	http.ServeContent(
		c.Writer,
		c.Request,
		name,
		modifiedAt,
		file,
	)
	return true
}

func writeMediaDerivativeError(
	c *gin.Context,
	err error,
	unsupportedMessage string,
) {
	if err == nil {
		return
	}
	if c.Request.Context().Err() != nil {
		return
	}
	switch {
	case errors.Is(err, background.ErrQueueFull):
		c.Header("Retry-After", "1")
		fail(c, http.StatusServiceUnavailable, "media processing queue is full")
	case errors.Is(err, background.ErrClosed),
		errors.Is(err, errMediaDerivativeSchedulerUnavailable):
		c.Header("Retry-After", "1")
		fail(c, http.StatusServiceUnavailable, "media processing is unavailable")
	case errors.Is(err, background.ErrRunTimeout):
		fail(c, http.StatusGatewayTimeout, "media processing timed out")
	case errors.Is(err, background.ErrSuperseded):
		fail(c, http.StatusConflict, "media changed while processing; retry")
	case errors.Is(err, errMediaDerivativeSourceMissing):
		fail(c, http.StatusNotFound, "stored content not found")
	case errors.Is(err, errMediaDerivativeUnsupported):
		fail(c, http.StatusUnsupportedMediaType, unsupportedMessage)
	default:
		fail(c, http.StatusInternalServerError, "media processing failed")
	}
}
