package photointelligence

import (
	"context"
	"fmt"
	"strings"
	"time"

	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	faceAnalysisBatchSize      = 4
	faceAnalysisRetryInterval  = 6 * time.Hour
	faceAnalysisRunningTimeout = 30 * time.Minute
)

type FacePreviewURLFunc func(
	context.Context,
	uint64,
	uint64,
	uint64,
	uint64,
) (string, error)

type FaceRunner struct {
	DB         *gorm.DB
	Analyzer   FaceAnalyzer
	PreviewURL FacePreviewURLFunc
	Now        func() time.Time
}

type faceCandidate struct {
	AssetID          uint64
	OwnerID          uint64
	SessionVersion   uint64
	NodeID           uint64
	NodeRevision     uint64
	SHA256           string
	InputFingerprint string
}

func (r *FaceRunner) RunBatch(
	ctx context.Context,
	limit int,
) (int, error) {
	if r == nil || r.DB == nil || r.Analyzer == nil || r.PreviewURL == nil {
		return 0, fmt.Errorf("photo face runner is not configured")
	}
	if limit <= 0 {
		limit = faceAnalysisBatchSize
	}
	now := time.Now().UTC()
	if r.Now != nil {
		now = r.Now().UTC()
	}

	info, err := r.Analyzer.Info(ctx)
	if err != nil {
		return 0, err
	}
	if err := ValidateFaceAnalyzerInfo(info); err != nil {
		return 0, err
	}
	detectorVersion := FaceDetectorAnalyzerVersion(info)
	embeddingVersion := FaceEmbeddingAnalyzerVersion(info)

	candidates, err := r.faceCandidates(
		ctx,
		detectorVersion,
		embeddingVersion,
		now,
		limit,
	)
	if err != nil {
		return 0, err
	}

	processed := 0
	var firstError error
	for _, candidate := range candidates {
		if ctx.Err() != nil {
			return processed, ctx.Err()
		}
		if err := r.markFaceAnalysisRunning(
			ctx,
			candidate.AssetID,
			detectorVersion,
			embeddingVersion,
			candidate.InputFingerprint,
			now,
		); err != nil {
			if firstError == nil {
				firstError = err
			}
			continue
		}

		previewURL, previewErr := r.PreviewURL(
			ctx,
			candidate.OwnerID,
			candidate.SessionVersion,
			candidate.NodeID,
			candidate.NodeRevision,
		)
		if previewErr != nil {
			r.failFaceAnalysis(ctx, candidate.AssetID, previewErr, now)
			if firstError == nil {
				firstError = previewErr
			}
			processed++
			continue
		}
		task := FaceAnalysisTask{
			PreviewURL:       previewURL,
			PreviewVersion:   mediapkg.AnalysisPreviewVersion,
			PreviewEdge:      mediapkg.AnalysisPreviewEdge,
			InputFingerprint: candidate.InputFingerprint,
		}
		if err := ValidateFaceAnalysisTask(task); err != nil {
			r.failFaceAnalysis(ctx, candidate.AssetID, err, now)
			if firstError == nil {
				firstError = err
			}
			processed++
			continue
		}

		faces, analyzeErr := r.Analyzer.Analyze(ctx, task)
		if analyzeErr != nil {
			r.failFaceAnalysis(ctx, candidate.AssetID, analyzeErr, now)
			if firstError == nil {
				firstError = analyzeErr
			}
			processed++
			continue
		}
		faces, validateErr := ValidateFaceObservations(info, faces)
		if validateErr != nil {
			r.failFaceAnalysis(ctx, candidate.AssetID, validateErr, now)
			if firstError == nil {
				firstError = validateErr
			}
			processed++
			continue
		}
		if err := r.finishFaceAnalysis(
			ctx,
			candidate.AssetID,
			faces,
			info,
			detectorVersion,
			embeddingVersion,
			candidate.InputFingerprint,
			now,
		); err != nil {
			r.failFaceAnalysis(ctx, candidate.AssetID, err, now)
			if firstError == nil {
				firstError = err
			}
		}
		processed++
	}
	return processed, firstError
}

func (r *FaceRunner) faceCandidates(
	ctx context.Context,
	detectorVersion, embeddingVersion string,
	now time.Time,
	limit int,
) ([]faceCandidate, error) {
	inputExpr := faceInputFingerprintSQL()
	var candidates []faceCandidate
	err := r.DB.WithContext(ctx).
		Table("xd_photo_assets AS pa").
		Select(
			"pa.id AS asset_id, pa.owner_id, u.session_version, "+
				"n.id AS node_id, n.revision AS node_revision, f.sha256, "+
				inputExpr+" AS input_fingerprint",
		).
		Joins(
			"JOIN xd_users AS u ON u.id = pa.owner_id "+
				"AND u.disabled_at IS NULL AND u.must_change_password = false",
		).
		Joins(
			"JOIN xd_nodes AS n ON n.id = pa.primary_node_id AND n.deleted_at IS NULL",
		).
		Joins("JOIN xd_files AS f ON f.node_id = n.id").
		Joins(
			"JOIN xd_media_metadata AS mm ON mm.node_id = n.id "+
				"AND mm.owner_id = pa.owner_id",
		).
		Joins(
			"LEFT JOIN xd_photo_analysis_states AS fd "+
				"ON fd.asset_id = pa.id AND fd.kind = ?",
			meta.PhotoAnalysisKindFaceDetection,
		).
		Joins(
			"LEFT JOIN xd_photo_analysis_states AS fe "+
				"ON fe.asset_id = pa.id AND fe.kind = ?",
			meta.PhotoAnalysisKindFaceEmbedding,
		).
		Where(
			"mm.media_kind = ? AND mm.index_state = ? AND "+
				"mm.node_revision = n.revision AND mm.sha256 = f.sha256",
			meta.MediaKindImage,
			meta.MediaIndexStateReady,
		).
		Where(
			"fd.id IS NULL OR fd.analyzer_version <> ? OR "+
				"fd.input_fingerprint <> "+inputExpr+" OR "+
				"fd.state IN (?, ?) OR "+
				"(fd.state = ? AND fd.updated_at <= ?) OR "+
				"(fd.state = ? AND fd.updated_at <= ?) OR "+
				"fe.id IS NULL OR fe.analyzer_version <> ? OR "+
				"fe.input_fingerprint <> "+inputExpr+" OR "+
				"fe.state IN (?, ?) OR "+
				"(fe.state = ? AND fe.updated_at <= ?) OR "+
				"(fe.state = ? AND fe.updated_at <= ?)",
			detectorVersion,
			meta.PhotoAnalysisStatePending,
			meta.PhotoAnalysisStateStale,
			meta.PhotoAnalysisStateFailed,
			now.Add(-faceAnalysisRetryInterval),
			meta.PhotoAnalysisStateRunning,
			now.Add(-faceAnalysisRunningTimeout),
			embeddingVersion,
			meta.PhotoAnalysisStatePending,
			meta.PhotoAnalysisStateStale,
			meta.PhotoAnalysisStateFailed,
			now.Add(-faceAnalysisRetryInterval),
			meta.PhotoAnalysisStateRunning,
			now.Add(-faceAnalysisRunningTimeout),
		).
		Order(
			"COALESCE(fd.updated_at, fe.updated_at, TIMESTAMP '1970-01-01') ASC, " +
				"pa.id ASC",
		).
		Limit(limit).
		Scan(&candidates).Error
	return candidates, err
}

func faceInputFingerprintSQL() string {
	return fmt.Sprintf(
		"CASE WHEN COALESCE(trim(f.sha256), '') <> '' "+
			"THEN 'media-analysis-' || lower(trim(f.sha256)) || '-v%d-%d' "+
			"ELSE 'media-analysis-node-' || n.id::text || '-' || "+
			"n.revision::text || '-v%d-%d' END",
		mediapkg.AnalysisPreviewVersion,
		mediapkg.AnalysisPreviewEdge,
		mediapkg.AnalysisPreviewVersion,
		mediapkg.AnalysisPreviewEdge,
	)
}

func (r *FaceRunner) markFaceAnalysisRunning(
	ctx context.Context,
	assetID uint64,
	detectorVersion, embeddingVersion, fingerprint string,
	now time.Time,
) error {
	return r.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := upsertRunningFaceState(
			tx,
			assetID,
			meta.PhotoAnalysisKindFaceDetection,
			detectorVersion,
			fingerprint,
			now,
		); err != nil {
			return err
		}
		return upsertRunningFaceState(
			tx,
			assetID,
			meta.PhotoAnalysisKindFaceEmbedding,
			embeddingVersion,
			fingerprint,
			now,
		)
	})
}

func upsertRunningFaceState(
	tx *gorm.DB,
	assetID uint64,
	kind, analyzerVersion, fingerprint string,
	now time.Time,
) error {
	row := meta.PhotoAnalysisState{
		AssetID:          assetID,
		Kind:             kind,
		AnalyzerVersion:  analyzerVersion,
		InputFingerprint: fingerprint,
		State:            meta.PhotoAnalysisStateRunning,
		Attempt:          1,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	return tx.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "asset_id"}, {Name: "kind"}},
		DoUpdates: clause.Assignments(map[string]any{
			"analyzer_version":  analyzerVersion,
			"input_fingerprint": fingerprint,
			"state":             meta.PhotoAnalysisStateRunning,
			"attempt":           gorm.Expr("\"xd_photo_analysis_states\".\"attempt\" + 1"),
			"last_error":        "",
			"completed_at":      nil,
			"updated_at":        now,
		}),
	}).Create(&row).Error
}

func (r *FaceRunner) finishFaceAnalysis(
	ctx context.Context,
	assetID uint64,
	faces []FaceObservation,
	info FaceAnalyzerInfo,
	detectorVersion, embeddingVersion, fingerprint string,
	now time.Time,
) error {
	rows := make([]meta.PhotoFace, 0, len(faces))
	for index, face := range faces {
		landmarks, err := EncodeFaceLandmarks(face.Landmarks)
		if err != nil {
			return err
		}
		rows = append(rows, meta.PhotoFace{
			AssetID:          assetID,
			DetectionKey:     fmt.Sprintf("face:%03d", index),
			AnalyzerVersion:  detectorVersion,
			X:                face.Box.X,
			Y:                face.Box.Y,
			Width:            face.Box.Width,
			Height:           face.Box.Height,
			Confidence:       face.Confidence,
			LandmarksJSON:    landmarks,
			Embedding:        append([]byte(nil), face.Embedding...),
			EmbeddingFormat:  strings.ToLower(strings.TrimSpace(info.EmbeddingFormat)),
			EmbeddingVersion: embeddingVersion,
			CreatedAt:        now,
			UpdatedAt:        now,
		})
	}

	return r.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("asset_id = ?", assetID).
			Delete(&meta.PhotoFace{}).Error; err != nil {
			return err
		}
		if len(rows) != 0 {
			if err := tx.Create(&rows).Error; err != nil {
				return err
			}
		}
		completed := now
		for _, state := range []struct {
			kind    string
			version string
		}{
			{
				kind:    meta.PhotoAnalysisKindFaceDetection,
				version: detectorVersion,
			},
			{
				kind:    meta.PhotoAnalysisKindFaceEmbedding,
				version: embeddingVersion,
			},
		} {
			result := tx.Model(&meta.PhotoAnalysisState{}).
				Where("asset_id = ? AND kind = ?", assetID, state.kind).
				Updates(map[string]any{
					"analyzer_version":  state.version,
					"input_fingerprint": fingerprint,
					"state":             meta.PhotoAnalysisStateReady,
					"last_error":        "",
					"completed_at":      &completed,
					"updated_at":        now,
				})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return fmt.Errorf(
					"photo face analysis state %q is missing",
					state.kind,
				)
			}
		}
		return nil
	})
}

func (r *FaceRunner) failFaceAnalysis(
	ctx context.Context,
	assetID uint64,
	cause error,
	now time.Time,
) {
	message := strings.TrimSpace(cause.Error())
	if len(message) > 2000 {
		message = message[:2000]
	}
	for _, kind := range []string{
		meta.PhotoAnalysisKindFaceDetection,
		meta.PhotoAnalysisKindFaceEmbedding,
	} {
		_ = r.DB.WithContext(ctx).
			Model(&meta.PhotoAnalysisState{}).
			Where("asset_id = ? AND kind = ?", assetID, kind).
			Updates(map[string]any{
				"state":        meta.PhotoAnalysisStateFailed,
				"last_error":   message,
				"completed_at": nil,
				"updated_at":   now,
			}).Error
	}
}
