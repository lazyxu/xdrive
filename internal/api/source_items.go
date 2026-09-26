package api

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
)

type sourceItemMetadataDTO struct {
	OriginalPath    string     `json:"original_path,omitempty"`
	OwnerExternalID string     `json:"owner_external_id,omitempty"`
	RemoteCreatedAt *time.Time `json:"remote_created_at,omitempty"`
	ContentMD5      string     `json:"content_md5,omitempty"`
	ThumbnailURL    string     `json:"thumbnail_url,omitempty"`
	PairGroupID     string     `json:"pair_group_id,omitempty"`
	PairRole        string     `json:"pair_role,omitempty"`
}

type sourceItemDTO struct {
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

type sourceItemRow struct {
	Position             int64
	SourceItemID         uint64
	ExternalID           string
	NodeID               *uint64
	Kind                 string
	Path                 string
	Size                 int64
	ModifiedAt           *time.Time
	SHA256               string
	RemoteRevision       string
	State                string
	MetadataSourceItemID *uint64
	OriginalPath         string
	OwnerExternalID      string
	RemoteCreatedAt      *time.Time
	ContentMD5           string
	ThumbnailURL         string
	PairGroupID          string
	PairRole             string
}

func (r sourceItemRow) dto() sourceItemDTO {
	out := sourceItemDTO{
		SourceItemID:   r.SourceItemID,
		ExternalID:     r.ExternalID,
		NodeID:         r.NodeID,
		Kind:           r.Kind,
		Path:           r.Path,
		Size:           r.Size,
		ModifiedAt:     r.ModifiedAt,
		SHA256:         r.SHA256,
		RemoteRevision: r.RemoteRevision,
		State:          r.State,
	}
	if r.MetadataSourceItemID != nil {
		out.Metadata = &sourceItemMetadataDTO{
			OriginalPath:    r.OriginalPath,
			OwnerExternalID: r.OwnerExternalID,
			RemoteCreatedAt: r.RemoteCreatedAt,
			ContentMD5:      r.ContentMD5,
			ThumbnailURL:    r.ThumbnailURL,
			PairGroupID:     r.PairGroupID,
			PairRole:        r.PairRole,
		}
	}
	return out
}

func (s *Server) listSourceItems(c *gin.Context) {
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
	if state != "" && !meta.ValidSourceItemState(state) {
		fail(c, http.StatusBadRequest, "invalid source item state")
		return
	}
	limit, offset, ok := sourceListWindow(c)
	if !ok {
		return
	}

	query := s.DB.Table("xd_source_items AS si").
		Select(sourceItemSelect).
		Joins("LEFT JOIN xd_source_item_metadata AS sm ON sm.source_item_id = si.id").
		Where("si.source_id = ?", sourceID)
	if state != "" {
		query = query.Where("si.state = ?", state)
	}
	var rows []sourceItemRow
	if err := query.
		Order("lower(si.path) ASC, si.id ASC").
		Limit(limit).Offset(offset).
		Scan(&rows).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list source items failed")
		return
	}

	out := make([]sourceItemDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.dto())
	}
	c.JSON(http.StatusOK, out)
}

func sourceListWindow(c *gin.Context) (int, int, bool) {
	limit := 200
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 1000 {
			fail(c, http.StatusBadRequest, "limit must be between 1 and 1000")
			return 0, 0, false
		}
		limit = value
	}
	offset := 0
	if raw := strings.TrimSpace(c.Query("offset")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			fail(c, http.StatusBadRequest, "offset must be zero or greater")
			return 0, 0, false
		}
		offset = value
	}
	return limit, offset, true
}

const sourceItemSelect = `si.id AS source_item_id,
	si.external_id, si.node_id, si.kind, si.path, si.size, si.modified_at,
	si.sha256, si.remote_revision, si.state,
	sm.source_item_id AS metadata_source_item_id,
	COALESCE(sm.original_path, '') AS original_path,
	COALESCE(sm.owner_external_id, '') AS owner_external_id,
	sm.remote_created_at,
	COALESCE(sm.content_md5, '') AS content_md5,
	COALESCE(sm.thumbnail_url, '') AS thumbnail_url,
	COALESCE(sm.pair_group_id, '') AS pair_group_id,
	COALESCE(sm.pair_role, '') AS pair_role`
