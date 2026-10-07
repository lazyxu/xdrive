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
	semanticAnalysisBatchSize      = 2
	semanticAnalysisRetryInterval  = 6 * time.Hour
	semanticAnalysisRunningTimeout = 30 * time.Minute
)

type SemanticRunner struct {
	DB         *gorm.DB
	Analyzer   SemanticAnalyzer
	PreviewURL FacePreviewURLFunc
	Now        func() time.Time
	OnUpdated  func(uint64)
}

type semanticCandidate struct {
	AssetID          uint64
	OwnerID          uint64
	SessionVersion   uint64
	NodeID           uint64
	NodeRevision     uint64
	SHA256           string
	InputFingerprint string
}

func (r *SemanticRunner) RunOwnerBatch(
	ctx context.Context,
	ownerID uint64,
	limit int,
) (int, error) {
	if ownerID == 0 {
		return 0, fmt.Errorf("photo semantic-search owner id is required")
	}
	processed, err := r.runBatch(ctx, ownerID, limit)
	if processed > 0 && r.OnUpdated != nil {
		r.OnUpdated(ownerID)
	}
	return processed, err
}

func (r *SemanticRunner) CandidateOwnerIDs(
	ctx context.Context,
	limit int,
) ([]uint64, error) {
	if r == nil || r.DB == nil || r.Analyzer == nil || r.PreviewURL == nil {
		return nil, fmt.Errorf("photo semantic-search runner is not configured")
	}
	if limit <= 0 {
		limit = 64
	}
	now := time.Now().UTC()
	if r.Now != nil {
		now = r.Now().UTC()
	}
	info, err := r.Analyzer.Info(ctx)
	if err != nil {
		return nil, err
	}
	if err := ValidateSemanticAnalyzerInfo(info); err != nil {
		return nil, err
	}
	version := SemanticAnalyzerVersion(info)

	type ownerRow struct {
		OwnerID uint64 `gorm:"column:owner_id"`
	}
	var rows []ownerRow
	err = r.semanticCandidateQuery(ctx, version, now).
		Select("pa.owner_id AS owner_id").
		Group("pa.owner_id").
		Order(
			"MIN(COALESCE(se.updated_at, TIMESTAMP '1970-01-01')) ASC, " +
				"pa.owner_id ASC",
		).
		Limit(limit).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	owners := make([]uint64, 0, len(rows))
	for _, row := range rows {
		if row.OwnerID != 0 {
			owners = append(owners, row.OwnerID)
		}
	}
	return owners, nil
}

func (r *SemanticRunner) runBatch(
	ctx context.Context,
	ownerID uint64,
	limit int,
) (int, error) {
	if r == nil || r.DB == nil || r.Analyzer == nil || r.PreviewURL == nil {
		return 0, fmt.Errorf("photo semantic-search runner is not configured")
	}
	if limit <= 0 {
		limit = semanticAnalysisBatchSize
	}
	now := time.Now().UTC()
	if r.Now != nil {
		now = r.Now().UTC()
	}

	info, err := r.Analyzer.Info(ctx)
	if err != nil {
		return 0, err
	}
	if err := ValidateSemanticAnalyzerInfo(info); err != nil {
		return 0, err
	}
	version := SemanticAnalyzerVersion(info)

	candidates, err := r.semanticCandidatesForOwner(
		ctx,
		ownerID,
		version,
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
		if err := r.markSemanticAnalysisRunning(
			ctx,
			candidate.AssetID,
			version,
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
			r.failSemanticAnalysis(ctx, candidate.AssetID, previewErr, now)
			if firstError == nil {
				firstError = previewErr
			}
			processed++
			continue
		}
		task := SemanticImageTask{
			PreviewURL:       previewURL,
			PreviewVersion:   mediapkg.AnalysisPreviewVersion,
			PreviewEdge:      mediapkg.AnalysisPreviewEdge,
			InputFingerprint: candidate.InputFingerprint,
		}
		if err := ValidateSemanticImageTask(task); err != nil {
			r.failSemanticAnalysis(ctx, candidate.AssetID, err, now)
			if firstError == nil {
				firstError = err
			}
			processed++
			continue
		}

		embedding, analyzeErr := r.Analyzer.EmbedImage(ctx, task)
		if analyzeErr != nil {
			r.failSemanticAnalysis(ctx, candidate.AssetID, analyzeErr, now)
			if firstError == nil {
				firstError = analyzeErr
			}
			processed++
			continue
		}
		embedding, validateErr := ValidateSemanticEmbedding(info, embedding)
		if validateErr != nil {
			r.failSemanticAnalysis(ctx, candidate.AssetID, validateErr, now)
			if firstError == nil {
				firstError = validateErr
			}
			processed++
			continue
		}
		if err := r.finishSemanticAnalysis(
			ctx,
			candidate,
			embedding,
			version,
			now,
		); err != nil {
			r.failSemanticAnalysis(ctx, candidate.AssetID, err, now)
			if firstError == nil {
				firstError = err
			}
		}
		processed++
	}
	return processed, firstError
}

func (r *SemanticRunner) semanticCandidatesForOwner(
	ctx context.Context,
	ownerID uint64,
	version string,
	now time.Time,
	limit int,
) ([]semanticCandidate, error) {
	inputExpr := faceInputFingerprintSQL()
	query := r.semanticCandidateQuery(ctx, version, now)
	if ownerID != 0 {
		query = query.Where("pa.owner_id = ?", ownerID)
	}
	var candidates []semanticCandidate
	err := query.
		Select(
			"pa.id AS asset_id, pa.owner_id, u.session_version, " +
				"n.id AS node_id, n.revision AS node_revision, f.sha256, " +
				inputExpr + " AS input_fingerprint",
		).
		Order(
			"COALESCE(se.updated_at, TIMESTAMP '1970-01-01') ASC, pa.id ASC",
		).
		Limit(limit).
		Scan(&candidates).Error
	return candidates, err
}

func (r *SemanticRunner) semanticCandidateQuery(
	ctx context.Context,
	version string,
	now time.Time,
) *gorm.DB {
	inputExpr := faceInputFingerprintSQL()
	return r.DB.WithContext(ctx).
		Table("xd_photo_assets AS pa").
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
			"LEFT JOIN xd_photo_analysis_states AS se "+
				"ON se.asset_id = pa.id AND se.kind = ?",
			meta.PhotoAnalysisKindSemanticEmbedding,
		).
		Where(
			"mm.media_kind = ? AND mm.index_state = ? AND "+
				"mm.node_revision = n.revision AND mm.sha256 = f.sha256",
			meta.MediaKindImage,
			meta.MediaIndexStateReady,
		).
		Where(
			"se.id IS NULL OR se.analyzer_version <> ? OR "+
				"se.input_fingerprint <> "+inputExpr+" OR "+
				"se.state IN (?, ?) OR "+
				"(se.state = ? AND se.updated_at <= ?) OR "+
				"(se.state = ? AND se.updated_at <= ?)",
			version,
			meta.PhotoAnalysisStatePending,
			meta.PhotoAnalysisStateStale,
			meta.PhotoAnalysisStateFailed,
			now.Add(-semanticAnalysisRetryInterval),
			meta.PhotoAnalysisStateRunning,
			now.Add(-semanticAnalysisRunningTimeout),
		)
}

func (r *SemanticRunner) markSemanticAnalysisRunning(
	ctx context.Context,
	assetID uint64,
	version, fingerprint string,
	now time.Time,
) error {
	return upsertRunningFaceState(
		r.DB.WithContext(ctx),
		assetID,
		meta.PhotoAnalysisKindSemanticEmbedding,
		version,
		fingerprint,
		now,
	)
}

func (r *SemanticRunner) finishSemanticAnalysis(
	ctx context.Context,
	candidate semanticCandidate,
	embedding SemanticEmbedding,
	version string,
	now time.Time,
) error {
	return r.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		row := meta.PhotoSemanticEmbedding{
			AssetID:         candidate.AssetID,
			OwnerID:         candidate.OwnerID,
			AnalyzerVersion: version,
			Embedding:       append([]byte(nil), embedding.Embedding...),
			EmbeddingFormat: embedding.Format,
			Dimensions:      embedding.Dimensions,
			CreatedAt:       now,
			UpdatedAt:       now,
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "asset_id"}},
			DoUpdates: clause.Assignments(map[string]any{
				"owner_id":         candidate.OwnerID,
				"analyzer_version": version,
				"embedding":        row.Embedding,
				"embedding_format": row.EmbeddingFormat,
				"dimensions":       row.Dimensions,
				"updated_at":       now,
			}),
		}).Create(&row).Error; err != nil {
			return err
		}
		completed := now
		result := tx.Model(&meta.PhotoAnalysisState{}).
			Where(
				"asset_id = ? AND kind = ?",
				candidate.AssetID,
				meta.PhotoAnalysisKindSemanticEmbedding,
			).
			Updates(map[string]any{
				"analyzer_version":  version,
				"input_fingerprint": candidate.InputFingerprint,
				"state":             meta.PhotoAnalysisStateReady,
				"last_error":        "",
				"completed_at":      &completed,
				"updated_at":        now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return fmt.Errorf("photo semantic analysis state is missing")
		}
		return nil
	})
}

func (r *SemanticRunner) failSemanticAnalysis(
	ctx context.Context,
	assetID uint64,
	cause error,
	now time.Time,
) {
	message := strings.TrimSpace(cause.Error())
	if len(message) > 2000 {
		message = message[:2000]
	}
	_ = r.DB.WithContext(ctx).
		Model(&meta.PhotoAnalysisState{}).
		Where(
			"asset_id = ? AND kind = ?",
			assetID,
			meta.PhotoAnalysisKindSemanticEmbedding,
		).
		Updates(map[string]any{
			"state":        meta.PhotoAnalysisStateFailed,
			"last_error":   message,
			"completed_at": nil,
			"updated_at":   now,
		}).Error
}
