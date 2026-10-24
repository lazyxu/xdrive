package api

import (
	"context"
	"errors"
	"fmt"
	"strings"

	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
	"gorm.io/gorm"
)

// mediaOCRDTO is returned only from GET /media/items/:id, not list/range.
// Errors and raw OCR are never exposed through the administrator model canary.
type mediaOCRDTO struct {
	State    string `json:"state"`
	Text     string `json:"text,omitempty"`
	Language string `json:"language,omitempty"`
	Reason   string `json:"reason,omitempty"`
}

func mediaOCRInputFingerprint(sha string, nodeID, revision uint64) string {
	sha = strings.ToLower(strings.TrimSpace(sha))
	if sha != "" {
		return fmt.Sprintf("media-analysis-%s-v%d-%d", sha, mediapkg.AnalysisPreviewVersion, mediapkg.AnalysisPreviewEdge)
	}
	return fmt.Sprintf("media-analysis-node-%d-%d-v%d-%d", nodeID, revision, mediapkg.AnalysisPreviewVersion, mediapkg.AnalysisPreviewEdge)
}

// Must match photointelligence.faceInputFingerprintSQL. Alias is a fixed
// source-code identifier, never derived from an HTTP/query parameter.
func mediaOCRInputFingerprintSQL(fileAlias string) string {
	return fmt.Sprintf("CASE WHEN COALESCE(trim(%[1]s.sha256), '') <> '' "+
		"THEN 'media-analysis-' || lower(trim(%[1]s.sha256)) || '-v%[2]d-%[3]d' "+
		"ELSE 'media-analysis-node-' || n.id::text || '-' || n.revision::text || '-v%[2]d-%[3]d' END",
		fileAlias, mediapkg.AnalysisPreviewVersion, mediapkg.AnalysisPreviewEdge)
}

// Read only after the caller has passed ownedNode() and media asset
// reconciliation. The current file revision, content and index must all match
// the analysis evidence before any private recognized text is returned.
func (s *Server) mediaOCRDetails(ctx context.Context, ownerID uint64, node meta.Node, metadata meta.MediaMetadata) (*mediaOCRDTO, error) {
	if node.File == nil || metadata.MediaKind != meta.MediaKindImage {
		return nil, nil
	}
	var asset meta.PhotoAsset
	if err := s.DB.WithContext(ctx).Select("id").
		Where("owner_id = ? AND primary_node_id = ?", ownerID, node.ID).
		Take(&asset).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return &mediaOCRDTO{State: "pending"}, nil
		}
		return nil, err
	}
	var state meta.PhotoAnalysisState
	if err := s.DB.WithContext(ctx).Select("state", "input_fingerprint", "last_error").
		Where("asset_id = ? AND kind = ?", asset.ID, meta.PhotoAnalysisKindOCRText).
		Take(&state).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return &mediaOCRDTO{State: "pending"}, nil
		}
		return nil, err
	}
	if metadata.IndexState != meta.MediaIndexStateReady ||
		metadata.NodeRevision != node.Revision ||
		!strings.EqualFold(metadata.SHA256, node.File.SHA256) ||
		state.InputFingerprint != mediaOCRInputFingerprint(node.File.SHA256, node.ID, node.Revision) {
		return &mediaOCRDTO{State: "stale"}, nil
	}
	switch state.State {
	case meta.PhotoAnalysisStateReady:
		var ocr meta.PhotoOCRText
		err := s.DB.WithContext(ctx).Select("asset_id", "text", "language").
			Where("asset_id = ?", asset.ID).Take(&ocr).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return &mediaOCRDTO{State: "unavailable"}, nil
		}
		if err != nil {
			return nil, err
		}
		return &mediaOCRDTO{State: "ready", Text: ocr.Text, Language: ocr.Language}, nil
	case meta.PhotoAnalysisStateFailed:
		// Legacy rows may still contain raw upstream errors; classify only
		// after the current Owner/revision/fingerprint checks and never expose
		// their original private strings to a client.
		return &mediaOCRDTO{
			State:  state.State,
			Reason: photointelligence.SmartFailureCodeFromStored(state.LastError),
		}, nil
	case meta.PhotoAnalysisStateRunning, meta.PhotoAnalysisStatePending,
		meta.PhotoAnalysisStateStale:
		return &mediaOCRDTO{State: state.State}, nil
	default:
		return &mediaOCRDTO{State: "unavailable"}, nil
	}
}
