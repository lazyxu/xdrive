package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const mediaPetVisualMinConfidence = 0.10

const (
	mediaPetKindDog = "dog"
	mediaPetKindCat = "cat"
)

type mediaPetFacetDTO struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	ItemCount   int64      `json:"item_count"`
	CoverNodeID *uint64    `json:"cover_node_id,omitempty"`
	UpdatedAt   *time.Time `json:"updated_at,omitempty"`
}

func mediaPetLabelRange(kind string) (int, int, bool) {
	switch strings.TrimSpace(kind) {
	case mediaPetKindDog:
		return 151, 268, true
	case mediaPetKindCat:
		return 281, 285, true
	default:
		return 0, 0, false
	}
}

func mediaPetName(kind string) string {
	switch kind {
	case mediaPetKindDog:
		return "狗"
	case mediaPetKindCat:
		return "猫"
	default:
		return "宠物"
	}
}

func mediaPetLabelQuery(
	ctx context.Context,
	db *gorm.DB,
	ownerID uint64,
	kind string,
) (*gorm.DB, error) {
	minIndex, maxIndex, ok := mediaPetLabelRange(kind)
	if !ok {
		return nil, gorm.ErrRecordNotFound
	}
	return db.WithContext(ctx).
		Table("xd_photo_visual_labels AS pet_label").
		Joins(
			"JOIN xd_photo_analysis_states AS pet_state ON pet_state.asset_id = pet_label.asset_id "+
				"AND pet_state.kind = ? AND pet_state.state = ?",
			meta.PhotoAnalysisKindVisualLabel,
			meta.PhotoAnalysisStateReady,
		).
		Joins(
			"JOIN xd_photo_assets AS pet_asset ON pet_asset.id = pet_label.asset_id "+
				"AND pet_asset.owner_id = ?",
			ownerID,
		).
		Joins(
			"JOIN xd_nodes AS pet_node ON pet_node.id = pet_asset.primary_node_id "+
				"AND pet_node.deleted_at IS NULL",
		).
		Where(
			"pet_label.label_index BETWEEN ? AND ? AND pet_label.confidence >= ?",
			minIndex,
			maxIndex,
			mediaPetVisualMinConfidence,
		), nil
}

func queryMediaPetFacets(
	ctx context.Context,
	db *gorm.DB,
	ownerID uint64,
) ([]mediaPetFacetDTO, error) {
	if db == nil || ownerID == 0 {
		return nil, fmt.Errorf("media pet query is not configured")
	}
	out := make([]mediaPetFacetDTO, 0, 2)
	for _, kind := range []string{mediaPetKindDog, mediaPetKindCat} {
		query, err := mediaPetLabelQuery(ctx, db, ownerID, kind)
		if err != nil {
			return nil, err
		}
		var itemCount int64
		if err := query.Session(&gorm.Session{}).
			Distinct("pet_label.asset_id").
			Count(&itemCount).Error; err != nil {
			return nil, err
		}
		if itemCount == 0 {
			continue
		}
		type coverRow struct {
			NodeID    uint64
			UpdatedAt *time.Time
		}
		var cover coverRow
		if err := query.Session(&gorm.Session{}).
			Select(
				"pet_asset.primary_node_id AS node_id, pet_label.updated_at AS updated_at",
			).
			Order(
				"pet_label.confidence DESC, pet_label.updated_at DESC, " +
					"pet_asset.id DESC",
			).
			Limit(1).
			Scan(&cover).Error; err != nil {
			return nil, err
		}
		nodeID := cover.NodeID
		out = append(out, mediaPetFacetDTO{
			ID:          kind,
			Name:        mediaPetName(kind),
			ItemCount:   itemCount,
			CoverNodeID: &nodeID,
			UpdatedAt:   cover.UpdatedAt,
		})
	}
	return out, nil
}

func applyMediaPetFilter(query *gorm.DB, kind string) (*gorm.DB, error) {
	minIndex, maxIndex, ok := mediaPetLabelRange(kind)
	if !ok {
		return nil, gorm.ErrRecordNotFound
	}
	return query.Where(
		"EXISTS ("+
			"SELECT 1 FROM xd_photo_visual_labels AS pet_filter_label "+
			"JOIN xd_photo_analysis_states AS pet_filter_state "+
			"ON pet_filter_state.asset_id = pet_filter_label.asset_id "+
			"AND pet_filter_state.kind = ? AND pet_filter_state.state = ? "+
			"WHERE pet_filter_label.asset_id = pa.id "+
			"AND pet_filter_label.label_index BETWEEN ? AND ? "+
			"AND pet_filter_label.confidence >= ?"+
			")",
		meta.PhotoAnalysisKindVisualLabel,
		meta.PhotoAnalysisStateReady,
		minIndex,
		maxIndex,
		mediaPetVisualMinConfidence,
	), nil
}

func (s *Server) listMediaPets(c *gin.Context) {
	items, err := queryMediaPetFacets(
		c.Request.Context(),
		s.DB,
		userID(c),
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "list pets failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, items)
}

func (s *Server) listMediaPetItems(c *gin.Context) {
	kind := strings.TrimSpace(c.Param("petKind"))
	if _, _, ok := mediaPetLabelRange(kind); !ok {
		fail(c, http.StatusNotFound, "pet collection not found")
		return
	}
	limit, offset, ok := mediaListWindow(c)
	if !ok {
		return
	}
	rangeRequested, ok := mediaRangeRequested(c)
	if !ok {
		return
	}
	query, err := s.mediaItemsBaseQuery(
		c.Request.Context(),
		userID(c),
		mediaQueryOptions{},
		"",
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "resolve pet collection failed")
		return
	}
	query, err = applyMediaPetFilter(query, kind)
	if err != nil {
		fail(c, http.StatusNotFound, "pet collection not found")
		return
	}
	var total int64
	if err := query.Session(&gorm.Session{}).
		Distinct("xd_media_metadata.node_id").
		Count(&total).Error; err != nil {
		fail(c, http.StatusInternalServerError, "count pet items failed")
		return
	}
	items, err := s.materializeMediaItems(
		c.Request.Context(),
		userID(c),
		query,
		limit,
		offset,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "list pet items failed")
		return
	}
	page := mediaItemRangeDTO{
		Items:      items,
		TotalCount: total,
		Offset:     offset,
		Limit:      limit,
	}
	c.Header("Cache-Control", "no-store")
	if rangeRequested {
		c.JSON(http.StatusOK, page)
		return
	}
	c.JSON(http.StatusOK, page.Items)
}
