package photointelligence

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const placeAnalysisRetryInterval = 6 * time.Hour
const placeAnalysisRunningTimeout = 30 * time.Minute

type PlaceRunner struct {
	DB       *gorm.DB
	Resolver PlaceResolver
	Now      func() time.Time
}

type placeCandidate struct {
	AssetID   uint64
	Latitude  float64
	Longitude float64
}

func (r *PlaceRunner) RunBatch(ctx context.Context, limit int) (int, error) {
	if r == nil || r.DB == nil || r.Resolver == nil {
		return 0, fmt.Errorf("photo place runner is not configured")
	}
	if limit <= 0 {
		limit = 32
	}
	now := time.Now().UTC()
	if r.Now != nil {
		now = r.Now().UTC()
	}
	analyzerVersion := r.Resolver.Name() + "@" + r.Resolver.Version()

	var candidates []placeCandidate
	if err := r.DB.WithContext(ctx).
		Table("xd_photo_assets AS pa").
		Select("pa.id AS asset_id, pm.latitude, pm.longitude").
		Joins("JOIN xd_photo_metadata AS pm ON pm.asset_id = pa.id").
		Joins("JOIN xd_nodes AS n ON n.id = pa.primary_node_id AND n.deleted_at IS NULL").
		Joins(
			"LEFT JOIN xd_photo_analysis_states AS pas ON pas.asset_id = pa.id AND pas.kind = ?",
			meta.PhotoAnalysisKindPlaceLabel,
		).
		Joins("LEFT JOIN xd_photo_place_labels AS ppl ON ppl.asset_id = pa.id").
		Where(
			"pm.latitude IS NOT NULL AND pm.longitude IS NOT NULL AND "+
				"pm.latitude BETWEEN -90 AND 90 AND pm.longitude BETWEEN -180 AND 180",
		).
		Where(
			"pas.id IS NULL OR pas.analyzer_version <> ? OR "+
				"pas.state IN (?, ?) OR "+
				"(pas.state = ? AND pas.updated_at <= ?) OR "+
				"(pas.state = ? AND pas.updated_at <= ?) OR "+
				"ppl.asset_id IS NULL OR "+
				"(ppl.asset_id IS NOT NULL AND ("+
				"ppl.resolver <> ? OR ppl.resolver_version <> ? OR "+
				"ppl.latitude <> pm.latitude OR ppl.longitude <> pm.longitude))",
			analyzerVersion,
			meta.PhotoAnalysisStatePending,
			meta.PhotoAnalysisStateStale,
			meta.PhotoAnalysisStateFailed,
			now.Add(-placeAnalysisRetryInterval),
			meta.PhotoAnalysisStateRunning,
			now.Add(-placeAnalysisRunningTimeout),
			r.Resolver.Name(),
			r.Resolver.Version(),
		).
		Order("COALESCE(pas.updated_at, TIMESTAMP '1970-01-01') ASC, pa.id ASC").
		Limit(limit).
		Scan(&candidates).Error; err != nil {
		return 0, err
	}

	processed := 0
	var firstError error
	for _, candidate := range candidates {
		if ctx.Err() != nil {
			return processed, ctx.Err()
		}
		fingerprint := placeInputFingerprint(candidate.Latitude, candidate.Longitude)
		if err := r.markPlaceAnalysisRunning(
			ctx,
			candidate.AssetID,
			analyzerVersion,
			fingerprint,
			now,
		); err != nil {
			if firstError == nil {
				firstError = err
			}
			continue
		}

		label, found, err := r.Resolver.Resolve(candidate.Latitude, candidate.Longitude)
		if err != nil {
			_ = r.markPlaceAnalysisFailed(ctx, candidate.AssetID, err, now)
			if firstError == nil {
				firstError = err
			}
			processed++
			continue
		}
		if err := r.finishPlaceAnalysis(
			ctx,
			candidate,
			label,
			found,
			analyzerVersion,
			fingerprint,
			now,
		); err != nil {
			_ = r.markPlaceAnalysisFailed(ctx, candidate.AssetID, err, now)
			if firstError == nil {
				firstError = err
			}
		}
		processed++
	}
	return processed, firstError
}

func (r *PlaceRunner) markPlaceAnalysisRunning(
	ctx context.Context,
	assetID uint64,
	analyzerVersion, fingerprint string,
	now time.Time,
) error {
	row := meta.PhotoAnalysisState{
		AssetID:          assetID,
		Kind:             meta.PhotoAnalysisKindPlaceLabel,
		AnalyzerVersion:  analyzerVersion,
		InputFingerprint: fingerprint,
		State:            meta.PhotoAnalysisStateRunning,
		Attempt:          1,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	return r.DB.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "asset_id"}, {Name: "kind"}},
			DoUpdates: clause.Assignments(map[string]any{
				"analyzer_version":  analyzerVersion,
				"input_fingerprint": fingerprint,
				"state":             meta.PhotoAnalysisStateRunning,
				"attempt":           gorm.Expr("xd_photo_analysis_states.attempt + 1"),
				"last_error":        "",
				"completed_at":      nil,
				"updated_at":        now,
			}),
		}).
		Create(&row).Error
}

func (r *PlaceRunner) finishPlaceAnalysis(
	ctx context.Context,
	candidate placeCandidate,
	label PlaceLabel,
	found bool,
	analyzerVersion, fingerprint string,
	now time.Time,
) error {
	formatted := strings.TrimSpace(label.Formatted)
	if !found {
		label = PlaceLabel{}
		formatted = ""
	}
	place := meta.PhotoPlaceLabel{
		AssetID:         candidate.AssetID,
		Resolver:        r.Resolver.Name(),
		ResolverVersion: r.Resolver.Version(),
		Latitude:        candidate.Latitude,
		Longitude:       candidate.Longitude,
		CountryCode:     strings.TrimSpace(label.CountryCode),
		Country:         strings.TrimSpace(label.Country),
		Region:          strings.TrimSpace(label.Region),
		City:            strings.TrimSpace(label.City),
		District:        strings.TrimSpace(label.District),
		Locality:        strings.TrimSpace(label.Locality),
		Formatted:       formatted,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	return r.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "asset_id"}},
			DoUpdates: clause.AssignmentColumns([]string{
				"resolver",
				"resolver_version",
				"latitude",
				"longitude",
				"country_code",
				"country",
				"region",
				"city",
				"district",
				"locality",
				"formatted",
				"updated_at",
			}),
		}).Create(&place).Error; err != nil {
			return err
		}
		completed := now
		result := tx.Model(&meta.PhotoAnalysisState{}).
			Where(
				"asset_id = ? AND kind = ?",
				candidate.AssetID,
				meta.PhotoAnalysisKindPlaceLabel,
			).
			Updates(map[string]any{
				"analyzer_version":  analyzerVersion,
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
			return fmt.Errorf("photo place analysis state is missing")
		}
		return nil
	})
}

func (r *PlaceRunner) markPlaceAnalysisFailed(
	ctx context.Context,
	assetID uint64,
	cause error,
	now time.Time,
) error {
	message := strings.TrimSpace(cause.Error())
	if len(message) > 2000 {
		message = message[:2000]
	}
	return r.DB.WithContext(ctx).
		Model(&meta.PhotoAnalysisState{}).
		Where(
			"asset_id = ? AND kind = ?",
			assetID,
			meta.PhotoAnalysisKindPlaceLabel,
		).
		Updates(map[string]any{
			"state":        meta.PhotoAnalysisStateFailed,
			"last_error":   message,
			"completed_at": nil,
			"updated_at":   now,
		}).Error
}

func placeInputFingerprint(latitude, longitude float64) string {
	return fmt.Sprintf(
		"gps:%016x:%016x",
		math.Float64bits(latitude),
		math.Float64bits(longitude),
	)
}
