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
	smartAnalysisBatchSize      = 2
	smartAnalysisRetryInterval  = 6 * time.Hour
	smartAnalysisRunningTimeout = 30 * time.Minute
)

type SmartRunner struct {
	DB         *gorm.DB
	Analyzer   SmartAnalyzer
	PreviewURL FacePreviewURLFunc
	Now        func() time.Time
}

type smartCandidate struct {
	AssetID          uint64
	OwnerID          uint64
	SessionVersion   uint64
	NodeID           uint64
	NodeRevision     uint64
	SHA256           string
	InputFingerprint string
}

func (r *SmartRunner) RunOwnerBatch(
	ctx context.Context,
	ownerID uint64,
	limit int,
) (int, error) {
	if ownerID == 0 {
		return 0, fmt.Errorf("photo smart-search owner id is required")
	}
	return r.runBatch(ctx, ownerID, limit)
}

func (r *SmartRunner) CandidateOwnerIDs(
	ctx context.Context,
	limit int,
) ([]uint64, error) {
	if r == nil || r.DB == nil || r.Analyzer == nil || r.PreviewURL == nil {
		return nil, fmt.Errorf("photo smart-search runner is not configured")
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
	if err := ValidateSmartAnalyzerInfo(info); err != nil {
		return nil, err
	}
	visualVersion := SmartVisualAnalyzerVersion(info)
	ocrVersion := SmartOCRAnalyzerVersion(info)

	type ownerRow struct {
		OwnerID uint64 `gorm:"column:owner_id"`
	}
	var rows []ownerRow
	err = r.smartCandidateQuery(ctx, visualVersion, ocrVersion, now).
		Select("pa.owner_id AS owner_id").
		Group("pa.owner_id").
		Order(
			"MIN(COALESCE(vl.updated_at, ot.updated_at, TIMESTAMP '1970-01-01')) ASC, " +
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

func (r *SmartRunner) runBatch(
	ctx context.Context,
	ownerID uint64,
	limit int,
) (int, error) {
	if r == nil || r.DB == nil || r.Analyzer == nil || r.PreviewURL == nil {
		return 0, fmt.Errorf("photo smart-search runner is not configured")
	}
	if limit <= 0 {
		limit = smartAnalysisBatchSize
	}
	now := time.Now().UTC()
	if r.Now != nil {
		now = r.Now().UTC()
	}

	info, err := r.Analyzer.Info(ctx)
	if err != nil {
		return 0, err
	}
	if err := ValidateSmartAnalyzerInfo(info); err != nil {
		return 0, err
	}
	visualVersion := SmartVisualAnalyzerVersion(info)
	ocrVersion := SmartOCRAnalyzerVersion(info)

	candidates, err := r.smartCandidatesForOwner(
		ctx,
		ownerID,
		visualVersion,
		ocrVersion,
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
		if err := r.markSmartAnalysisRunning(
			ctx,
			candidate.AssetID,
			visualVersion,
			ocrVersion,
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
			r.failSmartAnalysis(ctx, candidate.AssetID, previewErr, now)
			if firstError == nil {
				firstError = previewErr
			}
			processed++
			continue
		}
		task := SmartAnalysisTask{
			PreviewURL:       previewURL,
			PreviewVersion:   mediapkg.AnalysisPreviewVersion,
			PreviewEdge:      mediapkg.AnalysisPreviewEdge,
			InputFingerprint: candidate.InputFingerprint,
		}
		if err := ValidateSmartAnalysisTask(task); err != nil {
			r.failSmartAnalysis(ctx, candidate.AssetID, err, now)
			if firstError == nil {
				firstError = err
			}
			processed++
			continue
		}

		result, analyzeErr := r.Analyzer.Analyze(ctx, task)
		if analyzeErr != nil {
			r.failSmartAnalysis(ctx, candidate.AssetID, analyzeErr, now)
			if firstError == nil {
				firstError = analyzeErr
			}
			processed++
			continue
		}
		result, validateErr := ValidateSmartAnalysisResult(result)
		if validateErr != nil {
			r.failSmartAnalysis(ctx, candidate.AssetID, validateErr, now)
			if firstError == nil {
				firstError = validateErr
			}
			processed++
			continue
		}
		if err := r.finishSmartAnalysis(
			ctx,
			candidate.AssetID,
			result,
			visualVersion,
			ocrVersion,
			candidate.InputFingerprint,
			now,
		); err != nil {
			r.failSmartAnalysis(ctx, candidate.AssetID, err, now)
			if firstError == nil {
				firstError = err
			}
		}
		processed++
	}
	return processed, firstError
}

func (r *SmartRunner) smartCandidatesForOwner(
	ctx context.Context,
	ownerID uint64,
	visualVersion, ocrVersion string,
	now time.Time,
	limit int,
) ([]smartCandidate, error) {
	inputExpr := faceInputFingerprintSQL()
	query := r.smartCandidateQuery(
		ctx,
		visualVersion,
		ocrVersion,
		now,
	)
	if ownerID != 0 {
		query = query.Where("pa.owner_id = ?", ownerID)
	}
	var candidates []smartCandidate
	err := query.
		Select(
			"pa.id AS asset_id, pa.owner_id, u.session_version, " +
				"n.id AS node_id, n.revision AS node_revision, f.sha256, " +
				inputExpr + " AS input_fingerprint",
		).
		Order(
			"COALESCE(vl.updated_at, ot.updated_at, TIMESTAMP '1970-01-01') ASC, " +
				"pa.id ASC",
		).
		Limit(limit).
		Scan(&candidates).Error
	return candidates, err
}

func (r *SmartRunner) smartCandidateQuery(
	ctx context.Context,
	visualVersion, ocrVersion string,
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
			"LEFT JOIN xd_photo_analysis_states AS vl "+
				"ON vl.asset_id = pa.id AND vl.kind = ?",
			meta.PhotoAnalysisKindVisualLabel,
		).
		Joins(
			"LEFT JOIN xd_photo_analysis_states AS ot "+
				"ON ot.asset_id = pa.id AND ot.kind = ?",
			meta.PhotoAnalysisKindOCRText,
		).
		Where(
			"mm.media_kind = ? AND mm.index_state = ? AND "+
				"mm.node_revision = n.revision AND mm.sha256 = f.sha256",
			meta.MediaKindImage,
			meta.MediaIndexStateReady,
		).
		Where(
			"vl.id IS NULL OR vl.analyzer_version <> ? OR "+
				"vl.input_fingerprint <> "+inputExpr+" OR "+
				"vl.state IN (?, ?) OR "+
				"(vl.state = ? AND vl.updated_at <= ?) OR "+
				"(vl.state = ? AND vl.updated_at <= ?) OR "+
				"ot.id IS NULL OR ot.analyzer_version <> ? OR "+
				"ot.input_fingerprint <> "+inputExpr+" OR "+
				"ot.state IN (?, ?) OR "+
				"(ot.state = ? AND ot.updated_at <= ?) OR "+
				"(ot.state = ? AND ot.updated_at <= ?)",
			visualVersion,
			meta.PhotoAnalysisStatePending,
			meta.PhotoAnalysisStateStale,
			meta.PhotoAnalysisStateFailed,
			now.Add(-smartAnalysisRetryInterval),
			meta.PhotoAnalysisStateRunning,
			now.Add(-smartAnalysisRunningTimeout),
			ocrVersion,
			meta.PhotoAnalysisStatePending,
			meta.PhotoAnalysisStateStale,
			meta.PhotoAnalysisStateFailed,
			now.Add(-smartAnalysisRetryInterval),
			meta.PhotoAnalysisStateRunning,
			now.Add(-smartAnalysisRunningTimeout),
		)
}

func (r *SmartRunner) markSmartAnalysisRunning(
	ctx context.Context,
	assetID uint64,
	visualVersion, ocrVersion, fingerprint string,
	now time.Time,
) error {
	return r.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := upsertRunningFaceState(
			tx,
			assetID,
			meta.PhotoAnalysisKindVisualLabel,
			visualVersion,
			fingerprint,
			now,
		); err != nil {
			return err
		}
		return upsertRunningFaceState(
			tx,
			assetID,
			meta.PhotoAnalysisKindOCRText,
			ocrVersion,
			fingerprint,
			now,
		)
	})
}

func (r *SmartRunner) finishSmartAnalysis(
	ctx context.Context,
	assetID uint64,
	result SmartAnalysisResult,
	visualVersion, ocrVersion, fingerprint string,
	now time.Time,
) error {
	labels := make([]meta.PhotoVisualLabel, 0, len(result.Labels))
	for _, item := range result.Labels {
		labels = append(labels, meta.PhotoVisualLabel{
			AssetID:    assetID,
			Label:      item.Label,
			LabelIndex: item.Index,
			Confidence: item.Confidence,
			CreatedAt:  now,
			UpdatedAt:  now,
		})
	}

	return r.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("asset_id = ?", assetID).
			Delete(&meta.PhotoVisualLabel{}).Error; err != nil {
			return err
		}
		if len(labels) != 0 {
			if err := tx.Create(&labels).Error; err != nil {
				return err
			}
		}
		ocr := meta.PhotoOCRText{
			AssetID:   assetID,
			Text:      result.OCRText,
			Language:  result.OCRLanguage,
			CreatedAt: now,
			UpdatedAt: now,
		}
		if strings.TrimSpace(ocr.Language) == "" {
			ocr.Language = "zh-en"
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "asset_id"}},
			DoUpdates: clause.Assignments(map[string]any{
				"text":       ocr.Text,
				"language":   ocr.Language,
				"updated_at": now,
			}),
		}).Create(&ocr).Error; err != nil {
			return err
		}
		completed := now
		for _, state := range []struct {
			kind    string
			version string
		}{
			{kind: meta.PhotoAnalysisKindVisualLabel, version: visualVersion},
			{kind: meta.PhotoAnalysisKindOCRText, version: ocrVersion},
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
					"photo smart analysis state %q is missing",
					state.kind,
				)
			}
		}
		return nil
	})
}

func (r *SmartRunner) failSmartAnalysis(
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
		meta.PhotoAnalysisKindVisualLabel,
		meta.PhotoAnalysisKindOCRText,
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
