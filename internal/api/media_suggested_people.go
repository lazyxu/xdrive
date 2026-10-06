package api

import (
	"context"
	"encoding/hex"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const (
	mediaSuggestedPeopleDefaultLimit = 24
	mediaSuggestedPeopleMaxLimit     = 100
	mediaSuggestedPersonKeyPrefix    = "auto:v1:"
)

type mediaSuggestedPersonDTO struct {
	ID          string     `json:"id"`
	FaceCount   int64      `json:"face_count"`
	ItemCount   int64      `json:"item_count"`
	CoverNodeID *uint64    `json:"cover_node_id,omitempty"`
	UpdatedAt   *time.Time `json:"updated_at,omitempty"`
}

func validMediaSuggestedPersonID(value string) bool {
	value = strings.TrimSpace(value)
	if !strings.HasPrefix(value, mediaSuggestedPersonKeyPrefix) {
		return false
	}
	raw := strings.TrimPrefix(value, mediaSuggestedPersonKeyPrefix)
	if len(raw) != 64 {
		return false
	}
	_, err := hex.DecodeString(raw)
	return err == nil
}

func (s *Server) listMediaSuggestedPeople(c *gin.Context) {
	limit := mediaSuggestedPeopleDefaultLimit
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > mediaSuggestedPeopleMaxLimit {
			fail(c, http.StatusBadRequest, "limit must be between 1 and 100")
			return
		}
		limit = value
	}

	items, err := queryMediaSuggestedPeople(
		c.Request.Context(),
		s.DB,
		userID(c),
		limit,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "list suggested people failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, items)
}

func queryMediaSuggestedPeople(
	ctx context.Context,
	db *gorm.DB,
	ownerID uint64,
	limit int,
) ([]mediaSuggestedPersonDTO, error) {
	if db == nil || ownerID == 0 {
		return nil, fmt.Errorf("suggested people query is not configured")
	}
	if limit <= 0 || limit > mediaSuggestedPeopleMaxLimit {
		limit = mediaSuggestedPeopleDefaultLimit
	}

	type row struct {
		ID          string
		FaceCount   int64
		ItemCount   int64
		CoverNodeID *uint64
		UpdatedAt   *time.Time
	}
	var rows []row
	if err := db.WithContext(ctx).
		Table("xd_photo_person_clusters AS pc").
		Select(
			"pc.cluster_key AS id, "+
				"COUNT(pcf.face_id) AS face_count, "+
				"COUNT(DISTINCT pf.asset_id) AS item_count, "+
				"(SELECT pa_cover.primary_node_id "+
				"FROM xd_photo_person_cluster_faces AS pcf_cover "+
				"JOIN xd_photo_faces AS pf_cover ON pf_cover.id = pcf_cover.face_id "+
				"JOIN xd_photo_assets AS pa_cover ON pa_cover.id = pf_cover.asset_id "+
				"WHERE pcf_cover.cluster_id = pc.id AND pa_cover.owner_id = pc.owner_id "+
				"ORDER BY pcf_cover.confidence DESC, pf_cover.confidence DESC, pf_cover.id ASC "+
				"LIMIT 1) AS cover_node_id, "+
				"MAX(pcf.updated_at) AS updated_at",
		).
		Joins(
			"JOIN xd_photo_person_cluster_states AS pcs ON pcs.owner_id = pc.owner_id "+
				"AND pcs.state = ? "+
				"AND pcs.analyzer_version = pc.analyzer_version "+
				"AND pcs.embedding_version = pc.embedding_version",
			meta.PhotoAnalysisStateReady,
		).
		Joins(
			"JOIN xd_photo_person_cluster_faces AS pcf ON pcf.cluster_id = pc.id",
		).
		Joins("JOIN xd_photo_faces AS pf ON pf.id = pcf.face_id").
		Joins(
			"JOIN xd_photo_assets AS pa ON pa.id = pf.asset_id AND pa.owner_id = pc.owner_id",
		).
		Joins(
			"JOIN xd_nodes AS n ON n.id = pa.primary_node_id AND n.deleted_at IS NULL",
		).
		Where("pc.owner_id = ?", ownerID).
		Group("pc.id, pc.cluster_key, pc.owner_id").
		Order(
			"item_count DESC, face_count DESC, updated_at DESC NULLS LAST, pc.cluster_key ASC",
		).
		Limit(limit).
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	out := make([]mediaSuggestedPersonDTO, 0, len(rows))
	for _, row := range rows {
		if !validMediaSuggestedPersonID(row.ID) {
			continue
		}
		out = append(out, mediaSuggestedPersonDTO{
			ID:          row.ID,
			FaceCount:   row.FaceCount,
			ItemCount:   row.ItemCount,
			CoverNodeID: row.CoverNodeID,
			UpdatedAt:   row.UpdatedAt,
		})
	}
	return out, nil
}

func (s *Server) listMediaSuggestedPersonItems(c *gin.Context) {
	clusterID := strings.TrimSpace(c.Param("clusterID"))
	if !validMediaSuggestedPersonID(clusterID) {
		fail(c, http.StatusBadRequest, "invalid suggested person id")
		return
	}
	options, ok := mediaQueryFromRequest(c)
	if !ok {
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
	if err := s.refreshMediaIndexForOwner(
		c.Request.Context(),
		userID(c),
		mediaRequestIndexBatch,
	); err != nil {
		fail(c, http.StatusInternalServerError, "refresh media projection failed")
		return
	}
	if err := ensureCurrentSuggestedPerson(
		c.Request.Context(),
		s.DB,
		userID(c),
		clusterID,
	); err != nil {
		if err == gorm.ErrRecordNotFound {
			fail(c, http.StatusNotFound, "suggested person not found")
			return
		}
		fail(c, http.StatusInternalServerError, "resolve suggested person failed")
		return
	}
	options.PersonCluster = clusterID
	if rangeRequested {
		page, err := s.queryMediaItemRange(
			c.Request.Context(),
			userID(c),
			options,
			"",
			limit,
			offset,
		)
		if err != nil {
			fail(c, http.StatusInternalServerError, "list suggested person items failed")
			return
		}
		c.Header("Cache-Control", "no-store")
		c.JSON(http.StatusOK, page)
		return
	}
	items, err := s.queryMediaItems(
		c.Request.Context(),
		userID(c),
		options,
		"",
		limit,
		offset,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "list suggested person items failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, items)
}

func ensureCurrentSuggestedPerson(
	ctx context.Context,
	db *gorm.DB,
	ownerID uint64,
	clusterID string,
) error {
	if db == nil || ownerID == 0 || !validMediaSuggestedPersonID(clusterID) {
		return gorm.ErrRecordNotFound
	}
	var cluster meta.PhotoPersonCluster
	return db.WithContext(ctx).
		Table("xd_photo_person_clusters AS pc").
		Select("pc.*").
		Joins(
			"JOIN xd_photo_person_cluster_states AS pcs ON pcs.owner_id = pc.owner_id "+
				"AND pcs.state = ? "+
				"AND pcs.analyzer_version = pc.analyzer_version "+
				"AND pcs.embedding_version = pc.embedding_version",
			meta.PhotoAnalysisStateReady,
		).
		Where(
			"pc.owner_id = ? AND pc.cluster_key = ?",
			ownerID,
			clusterID,
		).
		Take(&cluster).Error
}
