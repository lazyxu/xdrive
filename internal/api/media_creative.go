package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/background"
	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	mediaCreativePreviewTicketKind = "creative"
	mediaCreativeRunTimeout        = 5 * time.Minute
	mediaCreativeMovieRunTimeout   = 15 * time.Minute
	mediaCreativeReconcileInterval = 30 * time.Second
	mediaCreativeReconcileLimit    = 64
)

var (
	errMediaCreativeSourceChanged = errors.New("creative source changed")
	errMediaCreativeCancelled     = errors.New("creative generation cancelled")
)

type mediaCreativeMovieSource struct {
	AssetID      uint64 `json:"asset_id"`
	NodeID       uint64 `json:"node_id"`
	NodeRevision uint64 `json:"node_revision"`
	SHA256       string `json:"sha256"`
}

type mediaCreativeRecipe struct {
	OutputName      string                             `json:"output_name,omitempty"`
	CutoutMode      string                             `json:"cutout_mode,omitempty"`
	Points          []photointelligence.CreativePoint  `json:"points,omitempty"`
	Strokes         []photointelligence.CreativeStroke `json:"strokes,omitempty"`
	MovieSources    []mediaCreativeMovieSource         `json:"movie_sources,omitempty"`
	CollageSources  []mediaCreativeMovieSource         `json:"collage_sources,omitempty"`
	CollageTemplate string                             `json:"collage_template,omitempty"`
	FrameDurationMS int                                `json:"frame_duration_ms,omitempty"`
	TransitionMS    int                                `json:"transition_ms,omitempty"`
}

type mediaCreativeInput struct {
	Kind            string                             `json:"kind"`
	OutputName      string                             `json:"output_name,omitempty"`
	CutoutMode      string                             `json:"cutout_mode,omitempty"`
	Points          []photointelligence.CreativePoint  `json:"points,omitempty"`
	Strokes         []photointelligence.CreativeStroke `json:"strokes,omitempty"`
	SourceNodeIDs   []uint64                           `json:"source_node_ids,omitempty"`
	CollageTemplate string                             `json:"collage_template,omitempty"`
	FrameDurationMS int                                `json:"frame_duration_ms,omitempty"`
	TransitionMS    *int                               `json:"transition_ms,omitempty"`
}

type mediaCreativeGenerationDTO struct {
	ID                 string     `json:"id"`
	Kind               string     `json:"kind"`
	State              string     `json:"state"`
	SourceAssetID      uint64     `json:"source_asset_id"`
	SourceNodeID       uint64     `json:"source_node_id"`
	SourceNodeRevision uint64     `json:"source_node_revision"`
	AnalyzerVersion    string     `json:"analyzer_version,omitempty"`
	OutputNodeID       *uint64    `json:"output_node_id,omitempty"`
	LastError          string     `json:"last_error,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
	CompletedAt        *time.Time `json:"completed_at,omitempty"`
}

func toMediaCreativeGenerationDTO(
	generation meta.PhotoCreativeGeneration,
) mediaCreativeGenerationDTO {
	return mediaCreativeGenerationDTO{
		ID:                 generation.ID,
		Kind:               generation.Kind,
		State:              generation.State,
		SourceAssetID:      generation.SourceAssetID,
		SourceNodeID:       generation.SourceNodeID,
		SourceNodeRevision: generation.SourceNodeRevision,
		AnalyzerVersion:    generation.AnalyzerVersion,
		OutputNodeID:       generation.OutputNodeID,
		LastError:          generation.LastError,
		CreatedAt:          generation.CreatedAt,
		UpdatedAt:          generation.UpdatedAt,
		CompletedAt:        generation.CompletedAt,
	}
}

func mediaCreativeTaskKey(id string) string {
	return "media-creative:" + strings.TrimSpace(id)
}

func mediaCreativeTaskKind(kind string) string {
	return "media.creative." + strings.TrimSpace(kind)
}

func normalizeMediaCreativeInput(
	input mediaCreativeInput,
	value editableMediaAsset,
) (mediaCreativeInput, error) {
	input.Kind = strings.TrimSpace(input.Kind)
	input.CutoutMode = strings.TrimSpace(input.CutoutMode)
	input.OutputName = strings.TrimSpace(input.OutputName)
	input.CollageTemplate = strings.ToLower(strings.TrimSpace(input.CollageTemplate))
	if value.Metadata.MediaKind != meta.MediaKindImage ||
		value.Asset.Kind != meta.PhotoAssetKindImage {
		return input, errors.New("AI creative tools support plain image assets only")
	}
	if input.OutputName != "" {
		if err := meta.ValidateName(input.OutputName); err != nil {
			return input, err
		}
	}
	if input.Kind == meta.PhotoCreativeKindMovie ||
		input.Kind == meta.PhotoCreativeKindCollage {
		label := "movie"
		if input.Kind == meta.PhotoCreativeKindCollage {
			label = "collage"
		}
		seen := map[uint64]struct{}{value.Node.ID: {}}
		normalized := []uint64{value.Node.ID}
		for _, nodeID := range input.SourceNodeIDs {
			if nodeID == 0 {
				return input, fmt.Errorf("%s source node id is invalid", label)
			}
			if _, exists := seen[nodeID]; exists {
				continue
			}
			seen[nodeID] = struct{}{}
			normalized = append(normalized, nodeID)
		}
		input.SourceNodeIDs = normalized
		frames := make([]photointelligence.CreativeMovieFrame, 0, len(normalized))
		for range normalized {
			frames = append(frames, photointelligence.CreativeMovieFrame{
				PreviewURL:       "https://xdrive.invalid/creative-frame",
				PreviewVersion:   mediapkg.CreativePreviewVersion,
				PreviewEdge:      mediapkg.CreativePreviewEdge,
				InputFingerprint: "creative-multi-image-validation",
			})
		}
		probe := photointelligence.CreativeTask{
			Kind:             input.Kind,
			PreviewURL:       "https://xdrive.invalid/creative",
			PreviewVersion:   mediapkg.CreativePreviewVersion,
			PreviewEdge:      mediapkg.CreativePreviewEdge,
			InputFingerprint: "creative-validation",
		}
		if input.Kind == meta.PhotoCreativeKindMovie {
			if input.CollageTemplate != "" {
				return input, errors.New("movie does not accept collage template")
			}
			if input.FrameDurationMS == 0 {
				input.FrameDurationMS = 2000
			}
			transition := 350
			if input.TransitionMS != nil {
				transition = *input.TransitionMS
			}
			input.TransitionMS = &transition
			probe.MovieFrames = frames
			probe.FrameDurationMS = input.FrameDurationMS
			probe.TransitionMS = transition
		} else {
			if input.FrameDurationMS != 0 || input.TransitionMS != nil {
				return input, errors.New("collage does not accept movie timing")
			}
			if input.CollageTemplate == "" {
				input.CollageTemplate = photointelligence.CreativeCollageTemplateGrid
			}
			probe.CollageImages = frames
			probe.CollageTemplate = input.CollageTemplate
		}
		if err := photointelligence.ValidateCreativeTask(probe); err != nil {
			return input, err
		}
		return input, nil
	}
	if len(input.SourceNodeIDs) != 0 ||
		input.CollageTemplate != "" ||
		input.FrameDurationMS != 0 ||
		input.TransitionMS != nil {
		return input, errors.New("single-image creative tools do not accept multi-image inputs")
	}
	probe := photointelligence.CreativeTask{
		Kind:             input.Kind,
		PreviewURL:       "https://xdrive.invalid/creative",
		PreviewVersion:   mediapkg.CreativePreviewVersion,
		PreviewEdge:      mediapkg.CreativePreviewEdge,
		InputFingerprint: "creative-validation",
		CutoutMode:       input.CutoutMode,
		Points:           input.Points,
		Strokes:          input.Strokes,
	}
	if err := photointelligence.ValidateCreativeTask(probe); err != nil {
		return input, err
	}
	return input, nil
}

func mediaCreativeRunTimeoutFor(kind string) time.Duration {
	if strings.TrimSpace(kind) == meta.PhotoCreativeKindMovie {
		return mediaCreativeMovieRunTimeout
	}
	return mediaCreativeRunTimeout
}

func (s *Server) resolveMediaCreativeMovieSources(
	ctx context.Context,
	ownerID uint64,
	nodeIDs []uint64,
) ([]mediaCreativeMovieSource, error) {
	if len(nodeIDs) < photointelligence.CreativeMovieMinFrames ||
		len(nodeIDs) > photointelligence.CreativeMovieMaxFrames {
		return nil, errors.New("movie source count is invalid")
	}
	out := make([]mediaCreativeMovieSource, 0, len(nodeIDs))
	seen := make(map[uint64]struct{}, len(nodeIDs))
	for _, nodeID := range nodeIDs {
		if nodeID == 0 {
			return nil, errors.New("movie source node id is invalid")
		}
		if _, exists := seen[nodeID]; exists {
			return nil, errors.New("movie source node ids must be unique")
		}
		seen[nodeID] = struct{}{}
		node, err := s.ownedNode(ownerID, nodeID, true)
		if err != nil || node.Type != meta.NodeTypeFile || node.File == nil {
			return nil, fmt.Errorf("movie source %d is unavailable", nodeID)
		}
		metadata, err := s.ensureMediaMetadata(ctx, node)
		if err != nil {
			return nil, fmt.Errorf("index movie source %d: %w", nodeID, err)
		}
		if metadata.MediaKind != meta.MediaKindImage ||
			metadata.IndexState != meta.MediaIndexStateReady ||
			metadata.NodeRevision != node.Revision ||
			!strings.EqualFold(metadata.SHA256, node.File.SHA256) {
			return nil, fmt.Errorf("movie source %d is not a ready image", nodeID)
		}
		var asset meta.PhotoAsset
		if err := s.DB.WithContext(ctx).
			Where(
				"owner_id = ? AND primary_node_id = ? AND kind = ?",
				ownerID,
				nodeID,
				meta.PhotoAssetKindImage,
			).
			First(&asset).Error; err != nil {
			return nil, fmt.Errorf("movie source %d is not a plain image asset", nodeID)
		}
		out = append(out, mediaCreativeMovieSource{
			AssetID:      asset.ID,
			NodeID:       node.ID,
			NodeRevision: node.Revision,
			SHA256:       strings.ToLower(strings.TrimSpace(node.File.SHA256)),
		})
	}
	return out, nil
}

func (s *Server) resolveMediaCreativeCollageSources(
	ctx context.Context,
	ownerID uint64,
	nodeIDs []uint64,
) ([]mediaCreativeMovieSource, error) {
	if len(nodeIDs) < photointelligence.CreativeCollageMinImages ||
		len(nodeIDs) > photointelligence.CreativeCollageMaxImages {
		return nil, errors.New("collage source count is invalid")
	}
	sources, err := s.resolveMediaCreativeMovieSources(ctx, ownerID, nodeIDs)
	if err != nil {
		return nil, fmt.Errorf("collage source validation failed: %w", err)
	}
	return sources, nil
}

func (s *Server) mediaCreativeMovieFrames(
	ctx context.Context,
	generation meta.PhotoCreativeGeneration,
	user meta.User,
	recipe mediaCreativeRecipe,
) ([]photointelligence.CreativeMovieFrame, error) {
	if len(recipe.MovieSources) < photointelligence.CreativeMovieMinFrames ||
		len(recipe.MovieSources) > photointelligence.CreativeMovieMaxFrames {
		return nil, errors.New("creative movie source recipe is invalid")
	}
	first := recipe.MovieSources[0]
	if first.AssetID != generation.SourceAssetID ||
		first.NodeID != generation.SourceNodeID ||
		first.NodeRevision != generation.SourceNodeRevision ||
		!strings.EqualFold(first.SHA256, generation.SourceSHA256) {
		return nil, errMediaCreativeSourceChanged
	}
	frames := make([]photointelligence.CreativeMovieFrame, 0, len(recipe.MovieSources))
	for _, source := range recipe.MovieSources {
		var node meta.Node
		if err := s.DB.WithContext(ctx).
			Preload("File").
			Where(
				"id = ? AND owner_id = ? AND type = ? AND revision = ? AND deleted_at IS NULL",
				source.NodeID,
				generation.OwnerID,
				meta.NodeTypeFile,
				source.NodeRevision,
			).
			First(&node).Error; err != nil {
			return nil, errMediaCreativeSourceChanged
		}
		if node.File == nil ||
			!strings.EqualFold(
				strings.TrimSpace(node.File.SHA256),
				strings.TrimSpace(source.SHA256),
			) {
			return nil, errMediaCreativeSourceChanged
		}
		var asset meta.PhotoAsset
		if err := s.DB.WithContext(ctx).
			Where(
				"id = ? AND owner_id = ? AND primary_node_id = ? AND kind = ?",
				source.AssetID,
				generation.OwnerID,
				source.NodeID,
				meta.PhotoAssetKindImage,
			).
			First(&asset).Error; err != nil {
			return nil, errMediaCreativeSourceChanged
		}
		var metadata meta.MediaMetadata
		if err := s.DB.WithContext(ctx).
			Where(
				"owner_id = ? AND node_id = ? AND node_revision = ? AND sha256 = ? AND index_state = ? AND media_kind = ?",
				generation.OwnerID,
				source.NodeID,
				source.NodeRevision,
				source.SHA256,
				meta.MediaIndexStateReady,
				meta.MediaKindImage,
			).
			First(&metadata).Error; err != nil {
			return nil, errMediaCreativeSourceChanged
		}
		previewURL, err := s.photoCreativePreviewURL(
			ctx,
			generation.OwnerID,
			user.SessionVersion,
			source.NodeID,
			source.NodeRevision,
		)
		if err != nil {
			return nil, err
		}
		frames = append(frames, photointelligence.CreativeMovieFrame{
			PreviewURL:     previewURL,
			PreviewVersion: mediapkg.CreativePreviewVersion,
			PreviewEdge:    mediapkg.CreativePreviewEdge,
			InputFingerprint: mediapkg.CreativePreviewFingerprint(
				source.NodeID,
				source.NodeRevision,
				source.SHA256,
			),
		})
	}
	return frames, nil
}

func (s *Server) mediaCreativeCollageImages(
	ctx context.Context,
	generation meta.PhotoCreativeGeneration,
	user meta.User,
	recipe mediaCreativeRecipe,
) ([]photointelligence.CreativeMovieFrame, error) {
	if len(recipe.CollageSources) < photointelligence.CreativeCollageMinImages ||
		len(recipe.CollageSources) > photointelligence.CreativeCollageMaxImages {
		return nil, errors.New("creative collage source recipe is invalid")
	}
	movieRecipe := recipe
	movieRecipe.MovieSources = recipe.CollageSources
	return s.mediaCreativeMovieFrames(ctx, generation, user, movieRecipe)
}

func validateMediaCreativeSourcesTx(
	tx *gorm.DB,
	generation meta.PhotoCreativeGeneration,
	recipe mediaCreativeRecipe,
) error {
	var sources []mediaCreativeMovieSource
	switch generation.Kind {
	case meta.PhotoCreativeKindMovie:
		sources = recipe.MovieSources
	case meta.PhotoCreativeKindCollage:
		if len(recipe.CollageSources) < photointelligence.CreativeCollageMinImages ||
			len(recipe.CollageSources) > photointelligence.CreativeCollageMaxImages {
			return errMediaCreativeSourceChanged
		}
		sources = recipe.CollageSources
	default:
		return nil
	}
	for _, source := range sources {
		var node meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Preload("File").
			Where(
				"id = ? AND owner_id = ? AND revision = ? AND deleted_at IS NULL",
				source.NodeID,
				generation.OwnerID,
				source.NodeRevision,
			).
			First(&node).Error; err != nil {
			return errMediaCreativeSourceChanged
		}
		if node.File == nil ||
			!strings.EqualFold(
				strings.TrimSpace(node.File.SHA256),
				strings.TrimSpace(source.SHA256),
			) {
			return errMediaCreativeSourceChanged
		}
	}
	return nil
}

func creativeOutputName(
	sourceName, requestedName, kind, mimeType string,
) (string, error) {
	requestedName = strings.TrimSpace(requestedName)
	if requestedName != "" {
		if err := meta.ValidateName(requestedName); err != nil {
			return "", err
		}
		return requestedName, nil
	}
	extension := ".jpg"
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/png":
		extension = ".png"
	case "video/mp4":
		extension = ".mp4"
	}
	ext := path.Ext(sourceName)
	stem := strings.TrimSpace(strings.TrimSuffix(sourceName, ext))
	if stem == "" {
		stem = "image"
	}
	suffix := "-erase"
	switch kind {
	case meta.PhotoCreativeKindCutout:
		suffix = "-cutout"
	case meta.PhotoCreativeKindMovie:
		suffix = "-movie"
	case meta.PhotoCreativeKindCollage:
		suffix = "-collage"
	}
	name := stem + suffix + extension
	if err := meta.ValidateName(name); err != nil {
		return "", err
	}
	return name, nil
}

func (s *Server) createMediaCreativeGeneration(c *gin.Context) {
	if s.PhotoCreativeAnalyzer == nil || s.BackgroundScheduler == nil {
		fail(c, http.StatusServiceUnavailable, "local creative analyzer is not configured")
		return
	}
	value, ok := s.resolveEditableMediaAsset(c)
	if !ok {
		return
	}
	var input mediaCreativeInput
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid creative request")
		return
	}
	input, err := normalizeMediaCreativeInput(input, value)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	recipe := mediaCreativeRecipe{
		OutputName: input.OutputName,
		CutoutMode: input.CutoutMode,
		Points:     append([]photointelligence.CreativePoint(nil), input.Points...),
		Strokes:    append([]photointelligence.CreativeStroke(nil), input.Strokes...),
	}
	switch input.Kind {
	case meta.PhotoCreativeKindMovie:
		sources, sourceErr := s.resolveMediaCreativeMovieSources(
			c.Request.Context(),
			value.Node.OwnerID,
			input.SourceNodeIDs,
		)
		if sourceErr != nil {
			fail(c, http.StatusBadRequest, sourceErr.Error())
			return
		}
		recipe.MovieSources = sources
		recipe.FrameDurationMS = input.FrameDurationMS
		recipe.TransitionMS = *input.TransitionMS
	case meta.PhotoCreativeKindCollage:
		sources, sourceErr := s.resolveMediaCreativeCollageSources(
			c.Request.Context(),
			value.Node.OwnerID,
			input.SourceNodeIDs,
		)
		if sourceErr != nil {
			fail(c, http.StatusBadRequest, sourceErr.Error())
			return
		}
		recipe.CollageSources = sources
		recipe.CollageTemplate = input.CollageTemplate
	}
	recipeJSON, err := json.Marshal(recipe)
	if err != nil {
		fail(c, http.StatusInternalServerError, "encode creative recipe failed")
		return
	}
	now := time.Now().UTC()
	generation := meta.PhotoCreativeGeneration{
		ID:                 uuid.NewString(),
		OwnerID:            value.Node.OwnerID,
		Kind:               input.Kind,
		SourceAssetID:      value.Asset.ID,
		SourceNodeID:       value.Node.ID,
		SourceNodeRevision: value.Node.Revision,
		SourceSHA256:       strings.ToLower(strings.TrimSpace(value.Node.File.SHA256)),
		RecipeJSON:         string(recipeJSON),
		State:              meta.PhotoCreativeStateQueued,
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	if err := s.DB.WithContext(c.Request.Context()).Create(&generation).Error; err != nil {
		fail(c, http.StatusInternalServerError, "create creative generation failed")
		return
	}
	if err := s.submitMediaCreativeGeneration(
		generation,
		background.TriggerUserAction,
		background.InitiatorUser,
		value.Node.OwnerID,
		requestIDFromContext(c),
	); err != nil {
		_ = s.failMediaCreativeGeneration(
			context.Background(),
			generation.ID,
			err,
		)
		fail(c, http.StatusServiceUnavailable, "queue creative generation failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusAccepted, toMediaCreativeGenerationDTO(generation))
}

func (s *Server) ownedMediaCreativeGeneration(
	ctx context.Context,
	ownerID uint64,
	id string,
) (meta.PhotoCreativeGeneration, error) {
	var out meta.PhotoCreativeGeneration
	err := s.DB.WithContext(ctx).
		Where("id = ? AND owner_id = ?", strings.TrimSpace(id), ownerID).
		First(&out).Error
	return out, err
}

func (s *Server) getMediaCreativeGeneration(c *gin.Context) {
	generation, err := s.ownedMediaCreativeGeneration(
		c.Request.Context(),
		userID(c),
		c.Param("generationID"),
	)
	if err != nil {
		fail(c, http.StatusNotFound, "creative generation not found")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, toMediaCreativeGenerationDTO(generation))
}

func (s *Server) cancelMediaCreativeGeneration(c *gin.Context) {
	generation, err := s.ownedMediaCreativeGeneration(
		c.Request.Context(),
		userID(c),
		c.Param("generationID"),
	)
	if err != nil {
		fail(c, http.StatusNotFound, "creative generation not found")
		return
	}
	if generation.State == meta.PhotoCreativeStateCompleted ||
		generation.State == meta.PhotoCreativeStateFailed ||
		generation.State == meta.PhotoCreativeStateCancelled {
		c.Header("Cache-Control", "no-store")
		c.JSON(http.StatusOK, toMediaCreativeGenerationDTO(generation))
		return
	}
	now := time.Now().UTC()
	if err := s.DB.WithContext(c.Request.Context()).
		Model(&meta.PhotoCreativeGeneration{}).
		Where(
			"id = ? AND owner_id = ? AND state IN ?",
			generation.ID,
			generation.OwnerID,
			[]string{
				meta.PhotoCreativeStateQueued,
				meta.PhotoCreativeStateRunning,
			},
		).
		Updates(map[string]any{
			"state":        meta.PhotoCreativeStateCancelled,
			"last_error":   "",
			"completed_at": &now,
			"updated_at":   now,
		}).Error; err != nil {
		fail(c, http.StatusInternalServerError, "cancel creative generation failed")
		return
	}
	if s.BackgroundScheduler != nil {
		_ = s.BackgroundScheduler.Cancel(background.Identity{
			Scope:   background.ScopeUser,
			OwnerID: generation.OwnerID,
			Key:     mediaCreativeTaskKey(generation.ID),
		})
	}
	generation, _ = s.ownedMediaCreativeGeneration(
		c.Request.Context(),
		generation.OwnerID,
		generation.ID,
	)
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, toMediaCreativeGenerationDTO(generation))
}

func (s *Server) StartMediaCreativeGenerations(ctx context.Context) {
	if s == nil || s.DB == nil || s.BackgroundScheduler == nil ||
		s.PhotoCreativeAnalyzer == nil {
		return
	}
	_ = s.DB.WithContext(ctx).
		Model(&meta.PhotoCreativeGeneration{}).
		Where("state = ?", meta.PhotoCreativeStateRunning).
		Updates(map[string]any{
			"state":        meta.PhotoCreativeStateQueued,
			"last_error":   "",
			"completed_at": nil,
			"updated_at":   time.Now().UTC(),
		}).Error
	go func() {
		ticker := time.NewTicker(mediaCreativeReconcileInterval)
		defer ticker.Stop()
		for {
			s.reconcileMediaCreativeGenerations(ctx)
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

func (s *Server) reconcileMediaCreativeGenerations(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}
	var rows []meta.PhotoCreativeGeneration
	if err := s.DB.WithContext(ctx).
		Where("state = ?", meta.PhotoCreativeStateQueued).
		Order("created_at ASC").
		Limit(mediaCreativeReconcileLimit).
		Find(&rows).Error; err != nil {
		return
	}
	for _, generation := range rows {
		if ctx.Err() != nil {
			return
		}
		_ = s.submitMediaCreativeGeneration(
			generation,
			background.TriggerReconcile,
			background.InitiatorSystem,
			0,
			"",
		)
	}
}

func (s *Server) submitMediaCreativeGeneration(
	generation meta.PhotoCreativeGeneration,
	trigger background.Trigger,
	initiator background.Initiator,
	initiatorID uint64,
	traceID string,
) error {
	if s == nil || s.BackgroundScheduler == nil {
		return background.ErrClosed
	}
	taskKey := mediaCreativeTaskKey(generation.ID)
	_, err := s.BackgroundScheduler.Submit(background.Task{
		Key:         taskKey,
		Kind:        mediaCreativeTaskKind(generation.Kind),
		GroupKey:    "media.creative",
		Scope:       background.ScopeUser,
		OwnerID:     generation.OwnerID,
		Trigger:     trigger,
		Initiator:   initiator,
		InitiatorID: initiatorID,
		TraceID:     strings.TrimSpace(traceID),
		Priority:    background.PriorityP1,
		Resource:    background.ResourceMLCPU,
		Retry: background.RetryPolicy{
			MaxAttempts: 2,
			Initial:     2 * time.Second,
			Max:         10 * time.Second,
		},
		Lease:             s.mediaDerivativeLeaseProvider(taskKey),
		HeartbeatInterval: mediaDerivativeLeaseHeartbeatInterval,
		RunTimeout:        mediaCreativeRunTimeoutFor(generation.Kind),
		Run: func(taskCtx context.Context) error {
			return s.runMediaCreativeGeneration(taskCtx, generation.ID)
		},
	})
	return err
}

func (s *Server) runMediaCreativeGeneration(
	ctx context.Context,
	generationID string,
) error {
	var generation meta.PhotoCreativeGeneration
	now := time.Now().UTC()
	if err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", generationID).
			First(&generation).Error; err != nil {
			return err
		}
		switch generation.State {
		case meta.PhotoCreativeStateCompleted,
			meta.PhotoCreativeStateFailed:
			return nil
		case meta.PhotoCreativeStateCancelled:
			return errMediaCreativeCancelled
		case meta.PhotoCreativeStateQueued, meta.PhotoCreativeStateRunning:
		default:
			return fmt.Errorf("unsupported creative generation state %q", generation.State)
		}
		return tx.Model(&meta.PhotoCreativeGeneration{}).
			Where("id = ?", generation.ID).
			Updates(map[string]any{
				"state":        meta.PhotoCreativeStateRunning,
				"last_error":   "",
				"completed_at": nil,
				"updated_at":   now,
			}).Error
	}); err != nil {
		return err
	}
	if generation.State == meta.PhotoCreativeStateCompleted ||
		generation.State == meta.PhotoCreativeStateFailed {
		return nil
	}

	background.ReportProgress(ctx, background.TaskProgress{
		Phase: "preparing", Total: 3, Unit: "step",
	})
	source, user, err := s.loadMediaCreativeSource(ctx, generation)
	if err != nil {
		return s.finishMediaCreativeRunError(ctx, generation.ID, err)
	}
	info, err := s.PhotoCreativeAnalyzer.Info(ctx)
	if err != nil {
		return s.finishMediaCreativeRunError(ctx, generation.ID, err)
	}
	if err := photointelligence.ValidateCreativeAnalyzerInfo(info); err != nil {
		return s.finishMediaCreativeRunError(ctx, generation.ID, err)
	}
	if generation.Kind == meta.PhotoCreativeKindMovie &&
		!photointelligence.CreativeAnalyzerSupports(
			info,
			photointelligence.CreativeCapabilityMovie,
		) {
		return s.finishMediaCreativeRunError(
			ctx,
			generation.ID,
			errors.New("local creative analyzer does not support automatic movies"),
		)
	}
	if generation.Kind == meta.PhotoCreativeKindCollage &&
		!photointelligence.CreativeAnalyzerSupports(
			info,
			photointelligence.CreativeCapabilityCollage,
		) {
		return s.finishMediaCreativeRunError(
			ctx,
			generation.ID,
			errors.New("local creative analyzer does not support collages"),
		)
	}
	analyzerVersion := photointelligence.CreativeAnalyzerVersion(info)
	_ = s.DB.WithContext(ctx).Model(&meta.PhotoCreativeGeneration{}).
		Where("id = ? AND state = ?", generation.ID, meta.PhotoCreativeStateRunning).
		Updates(map[string]any{
			"analyzer_version": analyzerVersion,
			"updated_at":       time.Now().UTC(),
		}).Error

	var recipe mediaCreativeRecipe
	if err := json.Unmarshal([]byte(generation.RecipeJSON), &recipe); err != nil {
		return s.finishMediaCreativeRunError(ctx, generation.ID, err)
	}
	previewURL, err := s.photoCreativePreviewURL(
		ctx,
		generation.OwnerID,
		user.SessionVersion,
		source.ID,
		source.Revision,
	)
	if err != nil {
		return s.finishMediaCreativeRunError(ctx, generation.ID, err)
	}
	task := photointelligence.CreativeTask{
		Kind:           generation.Kind,
		PreviewURL:     previewURL,
		PreviewVersion: mediapkg.CreativePreviewVersion,
		PreviewEdge:    mediapkg.CreativePreviewEdge,
		InputFingerprint: mediapkg.CreativePreviewFingerprint(
			source.ID,
			source.Revision,
			source.File.SHA256,
		),
		CutoutMode: recipe.CutoutMode,
		Points:     recipe.Points,
		Strokes:    recipe.Strokes,
	}
	switch generation.Kind {
	case meta.PhotoCreativeKindMovie:
		frames, frameErr := s.mediaCreativeMovieFrames(
			ctx,
			generation,
			user,
			recipe,
		)
		if frameErr != nil {
			return s.finishMediaCreativeRunError(ctx, generation.ID, frameErr)
		}
		task.MovieFrames = frames
		task.FrameDurationMS = recipe.FrameDurationMS
		task.TransitionMS = recipe.TransitionMS
	case meta.PhotoCreativeKindCollage:
		images, imageErr := s.mediaCreativeCollageImages(
			ctx,
			generation,
			user,
			recipe,
		)
		if imageErr != nil {
			return s.finishMediaCreativeRunError(ctx, generation.ID, imageErr)
		}
		task.CollageImages = images
		task.CollageTemplate = recipe.CollageTemplate
	}
	if err := photointelligence.ValidateCreativeTask(task); err != nil {
		return s.finishMediaCreativeRunError(ctx, generation.ID, err)
	}
	background.ReportProgress(ctx, background.TaskProgress{
		Phase: "generating", Current: 1, Total: 3, Unit: "step",
	})
	result, err := s.PhotoCreativeAnalyzer.Generate(ctx, task)
	if err != nil {
		return s.finishMediaCreativeRunError(ctx, generation.ID, err)
	}
	result, err = photointelligence.ValidateCreativeResult(result)
	if err != nil {
		return s.finishMediaCreativeRunError(ctx, generation.ID, err)
	}
	background.ReportProgress(ctx, background.TaskProgress{
		Phase: "saving", Current: 2, Total: 3, Unit: "step",
	})
	if err := s.commitMediaCreativeResult(
		ctx,
		generation,
		source,
		recipe,
		analyzerVersion,
		result,
	); err != nil {
		return s.finishMediaCreativeRunError(ctx, generation.ID, err)
	}
	background.ReportProgress(ctx, background.TaskProgress{
		Phase: "completed", Current: 3, Total: 3, Unit: "step",
	})
	return nil
}

func (s *Server) loadMediaCreativeSource(
	ctx context.Context,
	generation meta.PhotoCreativeGeneration,
) (meta.Node, meta.User, error) {
	var node meta.Node
	if err := s.DB.WithContext(ctx).
		Preload("File").
		Where(
			"id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			generation.SourceNodeID,
			generation.OwnerID,
			meta.NodeTypeFile,
		).
		First(&node).Error; err != nil {
		return meta.Node{}, meta.User{}, err
	}
	if node.File == nil ||
		node.Revision != generation.SourceNodeRevision ||
		!strings.EqualFold(
			strings.TrimSpace(node.File.SHA256),
			strings.TrimSpace(generation.SourceSHA256),
		) {
		return meta.Node{}, meta.User{}, errMediaCreativeSourceChanged
	}
	var user meta.User
	if err := s.DB.WithContext(ctx).First(&user, generation.OwnerID).Error; err != nil {
		return meta.Node{}, meta.User{}, err
	}
	if user.DisabledAt != nil || user.MustChangePassword {
		return meta.Node{}, meta.User{}, errors.New("creative owner is unavailable")
	}
	return node, user, nil
}

func (s *Server) finishMediaCreativeRunError(
	ctx context.Context,
	generationID string,
	cause error,
) error {
	if cause == nil {
		return nil
	}
	state := meta.PhotoCreativeStateFailed
	message := strings.TrimSpace(cause.Error())
	if len(message) > 2000 {
		message = message[:2000]
	}
	if errors.Is(cause, errMediaCreativeCancelled) ||
		errors.Is(cause, context.Canceled) {
		state = meta.PhotoCreativeStateCancelled
		message = ""
	}
	if errors.Is(context.Cause(ctx), background.ErrClosed) {
		state = meta.PhotoCreativeStateQueued
		message = ""
	}
	now := time.Now().UTC()
	completedAt := any(&now)
	if state == meta.PhotoCreativeStateQueued {
		completedAt = nil
	}
	_ = s.DB.WithContext(context.Background()).
		Model(&meta.PhotoCreativeGeneration{}).
		Where("id = ? AND state = ?", generationID, meta.PhotoCreativeStateRunning).
		Updates(map[string]any{
			"state":        state,
			"last_error":   message,
			"completed_at": completedAt,
			"updated_at":   now,
		}).Error
	return cause
}

func (s *Server) failMediaCreativeGeneration(
	ctx context.Context,
	generationID string,
	cause error,
) error {
	message := ""
	if cause != nil {
		message = strings.TrimSpace(cause.Error())
	}
	if len(message) > 2000 {
		message = message[:2000]
	}
	now := time.Now().UTC()
	return s.DB.WithContext(ctx).
		Model(&meta.PhotoCreativeGeneration{}).
		Where("id = ?", generationID).
		Updates(map[string]any{
			"state":        meta.PhotoCreativeStateFailed,
			"last_error":   message,
			"completed_at": &now,
			"updated_at":   now,
		}).Error
}

func (s *Server) commitMediaCreativeResult(
	ctx context.Context,
	generation meta.PhotoCreativeGeneration,
	source meta.Node,
	recipe mediaCreativeRecipe,
	analyzerVersion string,
	result photointelligence.CreativeResult,
) error {
	if source.ParentID == nil {
		return errors.New("creative source has no parent directory")
	}
	name, err := creativeOutputName(
		source.Name,
		recipe.OutputName,
		generation.Kind,
		result.MIMEType,
	)
	if err != nil {
		return err
	}
	if err := s.ensureStorageWriteCapacity(ctx, int64(len(result.Data))); err != nil {
		return err
	}

	tempKey := fmt.Sprintf(
		"%s/%d/creative/%s-%s",
		storage.UploadStagingDir,
		generation.OwnerID,
		generation.ID,
		uuid.NewString(),
	)
	hashValue := sha256.Sum256(result.Data)
	hash := hex.EncodeToString(hashValue[:])
	size, err := s.Store.Put(ctx, tempKey, bytes.NewReader(result.Data))
	if err != nil {
		_ = s.Store.Delete(ctx, tempKey)
		return err
	}
	if size != int64(len(result.Data)) {
		_ = s.Store.Delete(ctx, tempKey)
		return errors.New("creative result storage size mismatch")
	}
	casKey, err := storage.ContentAddressedKey(hash)
	if err != nil {
		_ = s.Store.Delete(ctx, tempKey)
		return err
	}
	if err := s.ensureContentBlobObject(ctx, tempKey, casKey, size); err != nil {
		_ = s.Store.Delete(ctx, tempKey)
		return err
	}

	var output meta.Node
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var currentGeneration meta.PhotoCreativeGeneration
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", generation.ID, generation.OwnerID).
			First(&currentGeneration).Error; err != nil {
			return err
		}
		if currentGeneration.State != meta.PhotoCreativeStateRunning {
			return errMediaCreativeCancelled
		}
		var currentSource meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Preload("File").
			Where(
				"id = ? AND owner_id = ? AND revision = ? AND deleted_at IS NULL",
				generation.SourceNodeID,
				generation.OwnerID,
				generation.SourceNodeRevision,
			).
			First(&currentSource).Error; err != nil {
			return errMediaCreativeSourceChanged
		}
		if currentSource.File == nil ||
			!strings.EqualFold(
				strings.TrimSpace(currentSource.File.SHA256),
				strings.TrimSpace(generation.SourceSHA256),
			) {
			return errMediaCreativeSourceChanged
		}
		if err := validateMediaCreativeSourcesTx(
			tx,
			generation,
			recipe,
		); err != nil {
			return err
		}
		if _, err := s.ensureQuotaForStorageKey(
			tx,
			generation.OwnerID,
			size,
			casKey,
			true,
		); err != nil {
			return err
		}
		retainedKey, _, err := s.retainContentBlobTx(
			ctx,
			tx,
			tempKey,
			hash,
			size,
		)
		if err != nil {
			return err
		}
		resolvedName, err := copyDestinationNameTx(
			tx,
			generation.OwnerID,
			*source.ParentID,
			name,
			meta.NodeTypeFile,
			nil,
		)
		if err != nil {
			return err
		}
		output = meta.Node{
			ParentID: source.ParentID,
			Name:     resolvedName,
			Type:     meta.NodeTypeFile,
			OwnerID:  generation.OwnerID,
			Revision: 1,
		}
		if err := tx.Create(&output).Error; err != nil {
			return err
		}
		if err := tx.Create(&meta.File{
			NodeID:     output.ID,
			Size:       size,
			StorageKey: retainedKey,
			SHA256:     hash,
		}).Error; err != nil {
			return err
		}
		now := time.Now().UTC()
		return tx.Model(&meta.PhotoCreativeGeneration{}).
			Where("id = ? AND state = ?", generation.ID, meta.PhotoCreativeStateRunning).
			Updates(map[string]any{
				"state":            meta.PhotoCreativeStateCompleted,
				"output_node_id":   output.ID,
				"analyzer_version": analyzerVersion,
				"last_error":       "",
				"completed_at":     &now,
				"updated_at":       now,
			}).Error
	})
	_ = s.Store.Delete(ctx, tempKey)
	if err != nil {
		s.cleanupUncommittedContentBlob(context.Background(), hash, casKey)
		return err
	}
	return nil
}

func (s *Server) mediaCreativePreviewTicketStream(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid media id")
		return
	}
	claims, err := s.Auth.ParsePreviewStream(strings.TrimSpace(c.Query("ticket")))
	if err != nil ||
		claims.NodeID != id ||
		claims.PreviewKind != mediaCreativePreviewTicketKind {
		fail(c, http.StatusUnauthorized, "invalid creative preview ticket")
		return
	}
	var user meta.User
	if err := s.DB.WithContext(c.Request.Context()).
		First(&user, claims.UserID).Error; err != nil {
		fail(c, http.StatusUnauthorized, "invalid creative preview ticket")
		return
	}
	if user.DisabledAt != nil ||
		user.MustChangePassword ||
		claims.SessionVersion != user.SessionVersion {
		fail(c, http.StatusUnauthorized, "creative preview ticket is no longer valid")
		return
	}
	node, err := s.ownedNode(claims.UserID, id, true)
	if err != nil || node.Type != meta.NodeTypeFile || node.File == nil {
		fail(c, http.StatusNotFound, "file not found")
		return
	}
	if node.Revision != claims.NodeRevision {
		fail(c, http.StatusGone, "creative preview ticket is stale")
		return
	}
	metadata, err := s.ensureMediaMetadata(c.Request.Context(), node)
	if err != nil {
		fail(c, http.StatusInternalServerError, "media indexing failed")
		return
	}
	if metadata.MediaKind != meta.MediaKindImage ||
		!mediaThumbnailSupported(metadata) {
		fail(c, http.StatusUnsupportedMediaType, "creative preview format is not supported")
		return
	}
	s.serveMediaCreativePreview(c, node, metadata)
}

func (s *Server) serveMediaCreativePreview(
	c *gin.Context,
	node meta.Node,
	metadata meta.MediaMetadata,
) {
	key := mediapkg.CreativePreviewStorageKey(
		node.ID,
		node.Revision,
		metadata.SHA256,
	)
	c.Header(
		"ETag",
		mediapkg.CreativePreviewETag(
			node.ID,
			node.Revision,
			metadata.SHA256,
		),
	)
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header(
		"X-XDrive-Creative-Preview-Version",
		strconv.Itoa(mediapkg.CreativePreviewVersion),
	)
	c.Header(
		"X-XDrive-Creative-Preview-Edge",
		strconv.Itoa(mediapkg.CreativePreviewEdge),
	)
	if s.tryServeMediaDerivative(
		c,
		key,
		node.Name+".creative.jpg",
		"image/jpeg",
		metadata.UpdatedAt,
	) {
		return
	}
	key, err := s.ensureMediaDerivative(
		c.Request.Context(),
		node,
		metadata,
		mediaDerivativeRequest{
			Kind:      mediaDerivativeCreative,
			Priority:  background.PriorityP1,
			Trigger:   background.TriggerSystemEvent,
			Initiator: background.InitiatorService,
			TraceID:   requestIDFromContext(c),
		},
	)
	if err != nil {
		writeMediaDerivativeError(
			c,
			err,
			"creative preview format is not supported",
		)
		return
	}
	if !s.tryServeMediaDerivative(
		c,
		key,
		node.Name+".creative.jpg",
		"image/jpeg",
		metadata.UpdatedAt,
	) {
		fail(c, http.StatusInternalServerError, "generated creative preview is unavailable")
	}
}
