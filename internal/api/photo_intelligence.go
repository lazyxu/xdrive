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
