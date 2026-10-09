package api

import (
	"errors"
	"time"

	"gorm.io/gorm"
)

type mediaAnchorRow struct {
	NodeID     uint64     `gorm:"column:node_id"`
	CapturedAt *time.Time `gorm:"column:captured_at"`
	CreatedAt  time.Time  `gorm:"column:created_at"`
}

// mediaAnchorBeforeClause shares the exact strict sort order used by materializeMediaItems.
// Invalid sort values cannot reach this function from an HTTP request.
func mediaAnchorBeforeClause(options mediaQueryOptions, anchor mediaAnchorRow) (string, []interface{}) {
	operator := ">"
	if options.SortDir == "asc" {
		operator = "<"
	}
	created := "(n.created_at " + operator + " ? OR (n.created_at = ? AND n.id " + operator + " ?))"
	args := []interface{}{anchor.CreatedAt, anchor.CreatedAt, anchor.NodeID}
	if options.SortBy == "added" {
		return created, args
	}
	if anchor.CapturedAt == nil {
		if options.SortDir == "asc" && options.UnknownFirst {
			return "(xd_media_metadata.captured_at IS NULL AND " + created + ")", args
		}
		return "(xd_media_metadata.captured_at IS NOT NULL OR (xd_media_metadata.captured_at IS NULL AND " + created + "))", args
	}
	captured := "(xd_media_metadata.captured_at IS NOT NULL AND (xd_media_metadata.captured_at " +
		operator + " ? OR (xd_media_metadata.captured_at = ? AND " + created + ")))"
	if options.SortDir == "asc" && options.UnknownFirst {
		return "(xd_media_metadata.captured_at IS NULL OR " + captured + ")", append([]interface{}{*anchor.CapturedAt, *anchor.CapturedAt}, args...)
	}
	return captured, append([]interface{}{*anchor.CapturedAt, *anchor.CapturedAt}, args...)
}

// mediaItemAnchorIndex queries only the owner/collection-filtered rows already used
// by range pagination. It never constructs an in-memory list of media to find a rank.
func mediaItemAnchorIndex(query *gorm.DB, options mediaQueryOptions) (*int64, error) {
	if options.AnchorNodeID == 0 {
		return nil, nil
	}
	var anchor mediaAnchorRow
	err := query.Session(&gorm.Session{}).
		Select("xd_media_metadata.node_id AS node_id, xd_media_metadata.captured_at AS captured_at, n.created_at AS created_at").
		Where("n.id = ?", options.AnchorNodeID).
		Take(&anchor).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// A concurrently removed asset or a changed filter cannot be restored.
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	where, args := mediaAnchorBeforeClause(options, anchor)
	var index int64
	if err := query.Session(&gorm.Session{}).
		Where(where, args...).
		Distinct("xd_media_metadata.node_id").
		Count(&index).Error; err != nil {
		return nil, err
	}
	return &index, nil
}
