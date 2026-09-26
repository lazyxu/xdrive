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
	Position       int64                  `json:"position"`
	SourceItemID   uint64                 `json:"source_item_id"`
	ExternalID     string                 `json:"external_id"`
	NodeID         *uint64                `json:"node_id,omitempty"`
	Kind           string                 `json:"kind"`
	Path           string                 `json:"path"`
	Size           int64                  `json:"size"`
	ModifiedAt     *time.Time             `json:"modified_at,omitempty"`
	SHA256         string                 `json:"sha256,omitempty"`
	RemoteRevision string                 `json:"remote_revision,omitempty"`
	State          string                 `json:"state"`
	Metadata       *sourceItemMetadataDTO `json:"metadata,omitempty"`
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

	limit, offset, ok := sourceListWindow(c)
	if !ok {
		return
	}

	var rows []sourceItemRow
	if err := s.DB.Table("xd_source_collection_items AS ci").
		Select("ci.position, "+sourceItemSelect).
		Joins("JOIN xd_source_items AS si ON si.id = ci.source_item_id").
		Joins("LEFT JOIN xd_source_item_metadata AS sm ON sm.source_item_id = si.id").
		Where("ci.collection_id = ? AND si.source_id = ?", collection.ID, sourceID).
		Order("ci.position ASC, ci.id ASC").
		Limit(limit).Offset(offset).
		Scan(&rows).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list source collection items failed")
		return
	}
	out := make([]sourceCollectionItemDTO, 0, len(rows))
	for _, row := range rows {
		item := row.dto()
		out = append(out, sourceCollectionItemDTO{
			Position:       row.Position,
			SourceItemID:   item.SourceItemID,
			ExternalID:     item.ExternalID,
			NodeID:         item.NodeID,
			Kind:           item.Kind,
			Path:           item.Path,
			Size:           item.Size,
			ModifiedAt:     item.ModifiedAt,
			SHA256:         item.SHA256,
			RemoteRevision: item.RemoteRevision,
			State:          item.State,
			Metadata:       item.Metadata,
		})
	}
	c.Header("X-XDrive-Collection-ID", strconv.FormatUint(collection.ID, 10))
	c.JSON(http.StatusOK, out)
}
