package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

type sourceCollectionDTO struct {
	ID             uint64    `json:"id"`
	ExternalID     string    `json:"external_id"`
	Kind           string    `json:"kind"`
	Name           string    `json:"name"`
	State          string    `json:"state"`
	RemoteRevision string    `json:"remote_revision,omitempty"`
	ItemCount      int64     `json:"item_count"`
	LastSeenAt     time.Time `json:"last_seen_at"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type sourceCollectionItemDTO struct {
	Position       int64      `json:"position"`
	SourceItemID   uint64     `json:"source_item_id"`
	ExternalID     string     `json:"external_id"`
	NodeID         *uint64    `json:"node_id,omitempty"`
	Kind           string     `json:"kind"`
	Path           string     `json:"path"`
	Size           int64      `json:"size"`
	ModifiedAt     *time.Time `json:"modified_at,omitempty"`
	RemoteRevision string     `json:"remote_revision,omitempty"`
	State          string     `json:"state"`
}

func (s *Server) listSourceCollections(c *gin.Context) {
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	if _, err := s.ownedSource(userID(c), sourceID); err != nil {
		fail(c, statusForLookup(err), "source not found")
		return
	}

	state := strings.TrimSpace(c.Query("state"))
	if state != "" && !meta.ValidSourceCollectionState(state) {
		fail(c, http.StatusBadRequest, "invalid collection state")
		return
	}

	type row struct {
		meta.SourceCollection
		ItemCount int64 `gorm:"column:item_count"`
	}
	query := s.DB.Model(&meta.SourceCollection{}).
		Select(`xd_source_collections.*,
			(SELECT COUNT(*) FROM xd_source_collection_items
			 WHERE xd_source_collection_items.collection_id = xd_source_collections.id) AS item_count`).
		Where("xd_source_collections.source_id = ?", sourceID)
	if state != "" {
		query = query.Where("xd_source_collections.state = ?", state)
	}
	var rows []row
	if err := query.Order("xd_source_collections.name ASC, xd_source_collections.id ASC").Find(&rows).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list source collections failed")
		return
	}

	out := make([]sourceCollectionDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, sourceCollectionDTO{
			ID: row.ID, ExternalID: row.ExternalID, Kind: row.Kind, Name: row.Name,
			State: row.State, RemoteRevision: row.RemoteRevision, ItemCount: row.ItemCount,
			LastSeenAt: row.LastSeenAt, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
		})
	}
	c.JSON(http.StatusOK, out)
}

func (s *Server) listSourceCollectionItems(c *gin.Context) {
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	collectionID, ok := parseID(c.Param("collectionID"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid collection id")
		return
	}
	if _, err := s.ownedSource(userID(c), sourceID); err != nil {
		fail(c, statusForLookup(err), "source not found")
		return
	}

	var collection meta.SourceCollection
	if err := s.DB.Where("id = ? AND source_id = ?", collectionID, sourceID).First(&collection).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "source collection not found")
		} else {
			fail(c, http.StatusInternalServerError, "read source collection failed")
		}
		return
	}

	limit := 200
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 1000 {
			fail(c, http.StatusBadRequest, "limit must be between 1 and 1000")
			return
		}
		limit = value
	}
	offset := 0
	if raw := strings.TrimSpace(c.Query("offset")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			fail(c, http.StatusBadRequest, "offset must be zero or greater")
			return
		}
		offset = value
	}

	var rows []sourceCollectionItemDTO
	if err := s.DB.Table("xd_source_collection_items AS ci").
		Select(`ci.position,
			si.id AS source_item_id, si.external_id, si.node_id, si.kind, si.path,
			si.size, si.modified_at, si.remote_revision, si.state`).
		Joins("JOIN xd_source_items AS si ON si.id = ci.source_item_id").
		Where("ci.collection_id = ? AND si.source_id = ?", collection.ID, sourceID).
		Order("ci.position ASC, ci.id ASC").
		Limit(limit).Offset(offset).
		Scan(&rows).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list source collection items failed")
		return
	}
	c.Header("X-XDrive-Collection-ID", strconv.FormatUint(collection.ID, 10))
	c.JSON(http.StatusOK, rows)
}
