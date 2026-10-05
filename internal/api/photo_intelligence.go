package api

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/photointelligence"
)

const (
	photoPlaceBatchSize     = 32
	photoPlaceBusyInterval  = 250 * time.Millisecond
	photoPlaceIdleInterval  = 30 * time.Second
	photoPlaceErrorInterval = time.Minute

	photoFaceBatchSize        = 4
	photoFaceBusyInterval     = 500 * time.Millisecond
	photoFaceIdleInterval     = 30 * time.Second
	photoFaceErrorInterval    = time.Minute
	photoFacePreviewTicketTTL = 5 * time.Minute

	photoPersonClusterBatchSize     = 1
	photoPersonClusterBusyInterval  = time.Second
	photoPersonClusterIdleInterval  = time.Minute
	photoPersonClusterErrorInterval = 5 * time.Minute
)

func (s *Server) StartPhotoIntelligence(ctx context.Context) {
	if s == nil || s.DB == nil {
		return
	}
	if s.PhotoPlaceResolver != nil {
		s.startPhotoPlaceIntelligence(ctx)
	}
	if s.PhotoFaceAnalyzer != nil &&
		strings.TrimSpace(s.PhotoFacePreviewBaseURL) != "" {
		s.startPhotoFaceIntelligence(ctx)
	}
	s.startPhotoPersonClustering(ctx)
}

func (s *Server) startPhotoPlaceIntelligence(ctx context.Context) {
	runner := &photointelligence.PlaceRunner{
		DB:       s.DB,
		Resolver: s.PhotoPlaceResolver,
	}
	slog.Info(
		"photo_place_intelligence_started",
		"resolver", s.PhotoPlaceResolver.Name(),
		"resolver_version", s.PhotoPlaceResolver.Version(),
	)
	go func() {
		delay := time.Duration(0)
		for {
			if !waitPhotoIntelligence(ctx, delay) {
				return
			}
			count, err := runner.RunBatch(ctx, photoPlaceBatchSize)
			switch {
			case err != nil:
				slog.Warn(
					"photo_place_batch_failed",
					"error", err,
					"processed", count,
				)
				delay = photoPlaceErrorInterval
			case count > 0:
				delay = photoPlaceBusyInterval
			default:
				delay = photoPlaceIdleInterval
			}
		}
	}()
}

func (s *Server) startPhotoFaceIntelligence(ctx context.Context) {
	runner := &photointelligence.FaceRunner{
		DB:         s.DB,
		Analyzer:   s.PhotoFaceAnalyzer,
		PreviewURL: s.photoFacePreviewURL,
	}
	slog.Info("photo_face_intelligence_started")
	go func() {
		delay := time.Duration(0)
		for {
			if !waitPhotoIntelligence(ctx, delay) {
				return
			}
			count, err := runner.RunBatch(ctx, photoFaceBatchSize)
			switch {
			case err != nil:
				slog.Warn(
					"photo_face_batch_failed",
					"error", err,
					"processed", count,
				)
				delay = photoFaceErrorInterval
			case count > 0:
				delay = photoFaceBusyInterval
			default:
				delay = photoFaceIdleInterval
			}
		}
	}()
}

func (s *Server) photoFacePreviewURL(
	ctx context.Context,
	ownerID, sessionVersion, nodeID, nodeRevision uint64,
) (string, error) {
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	baseURL := strings.TrimRight(
		strings.TrimSpace(s.PhotoFacePreviewBaseURL),
		"/",
	)
	if baseURL == "" {
		return "", fmt.Errorf("photo face preview base URL is not configured")
	}
	ticket, _, err := s.Auth.IssuePreviewStream(
		ownerID,
		sessionVersion,
		nodeID,
		nodeRevision,
		mediaAnalysisPreviewTicketKind,
		photoFacePreviewTicketTTL,
	)
	if err != nil {
		return "", fmt.Errorf("issue photo face preview ticket: %w", err)
	}
	return fmt.Sprintf(
		"%s/api/v1/media-analysis-preview/%d?ticket=%s",
		baseURL,
		nodeID,
		url.QueryEscape(ticket),
	), nil
}

func (s *Server) startPhotoPersonClustering(ctx context.Context) {
	runner := &photointelligence.PersonClusterRunner{DB: s.DB}
	slog.Info(
		"photo_person_clustering_started",
		"analyzer_version", photointelligence.PersonClusterAnalyzerVersion(),
	)
	go func() {
		delay := time.Duration(0)
		for {
			if !waitPhotoIntelligence(ctx, delay) {
				return
			}
			count, err := runner.RunBatch(ctx, photoPersonClusterBatchSize)
			switch {
			case err != nil:
				slog.Warn(
					"photo_person_cluster_batch_failed",
					"error", err,
					"processed", count,
				)
				delay = photoPersonClusterErrorInterval
			case count > 0:
				delay = photoPersonClusterBusyInterval
			default:
				delay = photoPersonClusterIdleInterval
			}
		}
	}()
}

func waitPhotoIntelligence(
	ctx context.Context,
	delay time.Duration,
) bool {
	if delay <= 0 {
		return ctx.Err() == nil
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
