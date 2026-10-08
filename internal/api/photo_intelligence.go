package api

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"
)

const photoFacePreviewTicketTTL = 5 * time.Minute

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
		return "", fmt.Errorf("photo analysis preview base URL is not configured")
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
		return "", fmt.Errorf("issue photo analysis preview ticket: %w", err)
	}
	return fmt.Sprintf(
		"%s/api/v1/media-analysis-preview/%d?ticket=%s",
		baseURL,
		nodeID,
		url.QueryEscape(ticket),
	), nil
}

func (s *Server) photoCreativePreviewURL(
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
		return "", fmt.Errorf("photo creative preview base URL is not configured")
	}
	ticket, _, err := s.Auth.IssuePreviewStream(
		ownerID,
		sessionVersion,
		nodeID,
		nodeRevision,
		mediaCreativePreviewTicketKind,
		photoFacePreviewTicketTTL,
	)
	if err != nil {
		return "", fmt.Errorf("issue photo creative preview ticket: %w", err)
	}
	return fmt.Sprintf(
		"%s/api/v1/media-creative-preview/%d?ticket=%s",
		baseURL,
		nodeID,
		url.QueryEscape(ticket),
	), nil
}
