package api

import (
	"context"
	"fmt"
	"math"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// A3c19: ONE source-fenced, Owner-authenticated derived BD09 spatial summary.
// This is a Server-side aggregation over ALL current eligible PhotoAssets,
// not 100 client-side points or fabricated grid-center GPS coordinates.
// 8x8 fixed bins cap the returned cells at 64 at any viewport size.
const (
	baiduPhotoMapCellGrid = 8
	baiduPhotoMapCellMax  = baiduPhotoMapCellGrid * baiduPhotoMapCellGrid
)

type baiduPhotoMapCell struct {
	CellX        int     `json:"cell_x"`
	CellY        int     `json:"cell_y"`
	PhotoCount   int64   `json:"photo_count"`
	AssetID      uint64  `json:"asset_id"`
	NodeID       uint64  `json:"node_id"`
	NodeRevision uint64  `json:"node_revision"` // Current Owner-bound revision, never a new media grant.
	Latitude     float64 `json:"latitude"`
	Longitude    float64 `json:"longitude"`
}

type baiduPhotoMapCellPage struct {
	Items       []baiduPhotoMapCell
	TotalCount  int64
	GridColumns int
	GridRows    int
}

// baiduPhotoMapCellSteps returns only finite positive viewport-local BD09
// widths. Antimeridian rectangles use a wrapped [0,360) longitude offset.
func baiduPhotoMapCellSteps(bounds baiduPhotoMapBounds) (float64, float64, error) {
	if !bounds.valid() || bounds.CoordinateSpace != meta.BaiduPhotoMapSpaceBD09LL {
		return 0, 0, fmt.Errorf("invalid baidu map cell geometry")
	}
	width := bounds.East - bounds.West
	if width < 0 {
		width += 360
	}
	height := bounds.North - bounds.South
	if !finiteBaiduCellDimension(width) || !finiteBaiduCellDimension(height) {
		return 0, 0, fmt.Errorf("invalid baidu map cell bounds")
	}
	return width / baiduPhotoMapCellGrid, height / baiduPhotoMapCellGrid, nil
}

func finiteBaiduCellDimension(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) &&
		value > 1e-10 && value <= 360
}

// queryBaiduPhotoMapCells uses ONE PostgreSQL statement and the EXACT SAME
// Owner+PhotoAsset+Node+MediaMetadata+consent/revision predicate as the native
// photo viewport. COUNT(*) OVER(...) is computed BEFORE one representative
// per bin is selected. This prevents showing the first 100 items as if they
// described a 100k library, without shipping 100k coordinates to a client.
//
// Each representative's latitude+longitude belong to the SAME actual
// approved derived PhotoAsset; they are NEVER a cell-center estimate. The
// derived BD09 positions are not original WGS84 or upload permission.
func queryBaiduPhotoMapCells(
	ctx context.Context, db *gorm.DB, ownerID uint64,
	bounds baiduPhotoMapBounds,
) (baiduPhotoMapCellPage, error) {
	empty := baiduPhotoMapCellPage{}
	if ctx == nil || ctx.Err() != nil || db == nil || ownerID == 0 {
		return empty, fmt.Errorf("invalid map cell caller")
	}
	stepX, stepY, err := baiduPhotoMapCellSteps(bounds)
	if err != nil {
		return empty, err
	}
	projection, ok := meta.BaiduPhotoMapProjectionForSpace(bounds.CoordinateSpace)
	if !ok {
		return empty, fmt.Errorf("invalid map projection")
	}
	readCtx, cancel := context.WithTimeout(ctx, baiduPhotoMapQueryTimeout)
	defer cancel()

	// All user-supplied values remain bound parameters. Only fixed SQL
	// templates for the 8x8 grid are source-controlled.
	const yCell = "LEAST(7, GREATEST(0, FLOOR((p.latitude - ?) / ?)))::integer AS cell_y"
	const xCell = "LEAST(7, GREATEST(0, FLOOR((p.longitude - ?) / ?)))::integer AS cell_x"
	const xWrapCell = "LEAST(7, GREATEST(0, FLOOR((CASE WHEN p.longitude >= ? THEN p.longitude - ? ELSE p.longitude + 360 - ? END) / ?)))::integer AS cell_x"
	selectCells := "p.asset_id AS asset_id, p.primary_node_id AS node_id, p.node_revision AS node_revision, " +
		"p.latitude AS latitude, p.longitude AS longitude, " + yCell + ", "
	var values []any
	values = append(values, bounds.South, stepY)
	if bounds.West < bounds.East {
		selectCells += xCell
		values = append(values, bounds.West, stepX)
	} else {
		selectCells += xWrapCell
		values = append(values, bounds.West, bounds.West, bounds.West, stepX)
	}
	scoped := baiduPhotoMapOwnerEligibleQuery(readCtx, db, ownerID, bounds, projection).
		Select(selectCells, values...)
	ranked := db.WithContext(readCtx).Table("(?) AS scoped", scoped).
		Select("scoped.*, COUNT(*) OVER (PARTITION BY scoped.cell_x, scoped.cell_y) AS photo_count, " +
			"ROW_NUMBER() OVER (PARTITION BY scoped.cell_x, scoped.cell_y ORDER BY scoped.asset_id ASC) AS row_in_cell")
	var cells []baiduPhotoMapCell
	err = db.WithContext(readCtx).Table("(?) AS ranked", ranked).
		Select("ranked.cell_x, ranked.cell_y, ranked.photo_count, ranked.asset_id, "+
			"ranked.node_id, ranked.node_revision, ranked.latitude, ranked.longitude").
		Where("ranked.row_in_cell = ?", 1).
		Order("ranked.cell_y ASC, ranked.cell_x ASC").
		Limit(baiduPhotoMapCellMax + 1).Scan(&cells).Error
	if err != nil || readCtx.Err() != nil || len(cells) > baiduPhotoMapCellMax {
		return empty, fmt.Errorf("baidu photo map cells unavailable")
	}
	var total int64
	for _, cell := range cells {
		if cell.CellX < 0 || cell.CellX >= baiduPhotoMapCellGrid ||
			cell.CellY < 0 || cell.CellY >= baiduPhotoMapCellGrid ||
			cell.PhotoCount <= 0 || cell.PhotoCount > math.MaxInt64-total ||
			cell.AssetID == 0 || cell.NodeID == 0 || cell.NodeRevision == 0 ||
			math.IsNaN(cell.Latitude) || math.IsNaN(cell.Longitude) ||
			math.IsInf(cell.Latitude, 0) || math.IsInf(cell.Longitude, 0) ||
			math.Abs(cell.Latitude) > 90 || math.Abs(cell.Longitude) > 180 {
			return empty, fmt.Errorf("invalid map cell row")
		}
		total += cell.PhotoCount
	}
	if cells == nil {
		cells = []baiduPhotoMapCell{}
	}
	return baiduPhotoMapCellPage{
		Items: cells, TotalCount: total,
		GridColumns: baiduPhotoMapCellGrid, GridRows: baiduPhotoMapCellGrid,
	}, nil
}
