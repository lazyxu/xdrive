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
	baiduPhotoMapWorldStableGrid = "world_stable_v1"
)

type baiduPhotoMapCell struct {
	CellX        int     `json:"cell_x"`
	CellY        int     `json:"cell_y"`
	PhotoCount   int64   `json:"photo_count"`
	AssetID      uint64  `json:"asset_id"`
	NodeID       uint64  `json:"node_id"`
	NodeRevision uint64  `json:"node_revision"`        // Current Owner-bound revision, never a new media grant.
	MediaKind    string  `json:"media_kind,omitempty"` // Opt-in Parent-only kind; never sent to the Child.
	Latitude     float64 `json:"latitude"`
	Longitude    float64 `json:"longitude"`
}

type baiduPhotoMapCellPage struct {
	GridScheme  string // legacy zero value leaves wire shape unchanged
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

// World-fixed power-of-two BD09 grid. Unlike viewport-local 8x8 bins,
// these tile BOUNDARIES do not move under a same-zoom camera pan. The
// viewport still filters exact current Owner positions, so entering/leaving
// edge photos can change only the genuinely affected tiles. At most eight
// tiles per axis intersect a viewport (step >= viewport span / 7).
//
// Use the SAME base 360/180, maximum 26 halvings, and -180/-90 origins in
// the trusted TypeScript validator; neither Host nor Baidu derives a group.
type baiduPhotoMapWorldGrid struct {
	StepX, StepY float64
	WestTile, SouthTile float64
}

func baiduPhotoMapWorldCellGrid(bounds baiduPhotoMapBounds) (baiduPhotoMapWorldGrid, error) {
	dx, dy, err := baiduPhotoMapCellSteps(bounds)
	if err != nil {
		return baiduPhotoMapWorldGrid{}, err
	}
	step := func(worldWidth, span float64) float64 {
		value := worldWidth
		for i := 0; i < 26 && value/2 >= span/7; i++ {
			value /= 2
		}
		return value
	}
	width := dx * baiduPhotoMapCellGrid
	height := dy * baiduPhotoMapCellGrid
	x, y := step(360, width), step(180, height)
	return baiduPhotoMapWorldGrid{
		StepX: x, StepY: y,
		WestTile: math.Floor((bounds.West + 180) / x),
		SouthTile: math.Floor((bounds.South + 90) / y),
	}, nil
}

// Reference math for DB and old/new client compatibility regression tests.
// The SQL expressions below use identical floors, wrapped longitude, and
// [0,7] clipping; no fabricated coordinate is ever used as a photo sample.
func baiduPhotoMapWorldCellIndex(bounds baiduPhotoMapBounds, lon, lat float64) (int, int, error) {
	grid, err := baiduPhotoMapWorldCellGrid(bounds)
	if err != nil || math.IsNaN(lon) || math.IsInf(lon, 0) ||
		math.IsNaN(lat) || math.IsInf(lat, 0) {
		return 0, 0, fmt.Errorf("invalid stable map point")
	}
	if bounds.West > bounds.East && lon < bounds.West {
		lon += 360
	}
	x := math.Floor((lon+180)/grid.StepX) - grid.WestTile
	y := math.Floor((lat+90)/grid.StepY) - grid.SouthTile
	return int(math.Min(7, math.Max(0, x))), int(math.Min(7, math.Max(0, y))), nil
}

// queryBaiduPhotoMapCells uses ONE PostgreSQL statement and the EXACT SAME
// Owner+PhotoAsset+Node+MediaMetadata current-source predicate as the
// native photo viewport; no per-photo Consent is joined or required.
// COUNT(*) OVER(...) is computed BEFORE one representative
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
	return queryBaiduPhotoMapCellsScoped(ctx, db, ownerID, bounds, nil, mediaQueryOptions{})
}

// A filtered map is the intersection of current derived BD09 Owner positions
// and the Gallery's Owner/Album/Filter membership SQL. The filtered
// subset is evaluated BEFORE the 8x8 counts and representative selection.
func queryBaiduPhotoMapCellsScoped(
	ctx context.Context, db *gorm.DB, ownerID uint64,
	bounds baiduPhotoMapBounds, galleryMemberNodes *gorm.DB,
	options mediaQueryOptions,
) (baiduPhotoMapCellPage, error) {
	return queryBaiduPhotoMapCellsScopedGrid(ctx, db, ownerID, bounds, galleryMemberNodes, options, false)
}

// Only explicitly opted-in clients receive world-anchored cell semantics.
// Legacy saved PWAs preserve their viewport-local bin indexes and exact DTO.
func queryBaiduPhotoMapCellsScopedGrid(
	ctx context.Context, db *gorm.DB, ownerID uint64,
	bounds baiduPhotoMapBounds, galleryMemberNodes *gorm.DB,
	options mediaQueryOptions, stable bool,
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

	// All user-supplied values remain bound parameters. Legacy clients retain
	// EXACTLY the old viewport-grid SQL; v1 opt-in quantizes world-anchored
	// tiles, while still filtering the ORIGINAL live viewport and Owner Scope.
	const yCell = "LEAST(7, GREATEST(0, FLOOR((p.latitude - ?) / ?)))::integer AS cell_y"
	const xCell = "LEAST(7, GREATEST(0, FLOOR((p.longitude - ?) / ?)))::integer AS cell_x"
	const xWrapCell = "LEAST(7, GREATEST(0, FLOOR((CASE WHEN p.longitude >= ? THEN p.longitude - ? ELSE p.longitude + 360 - ? END) / ?)))::integer AS cell_x"
	selectCells := "p.asset_id AS asset_id, p.primary_node_id AS node_id, p.node_revision AS node_revision, " +
		"p.latitude AS latitude, p.longitude AS longitude, " +
		"m.media_kind AS media_kind, m.captured_at AS captured_at, n.created_at AS added_at, "
	var values []any
	if stable {
		grid, errorGrid := baiduPhotoMapWorldCellGrid(bounds)
		if errorGrid != nil {
			return empty, errorGrid
		}
		selectCells += "LEAST(7, GREATEST(0, FLOOR((p.latitude + 90) / ?) - ?))::integer AS cell_y, "
		values = append(values, grid.StepY, grid.SouthTile)
		if bounds.West < bounds.East {
			selectCells += "LEAST(7, GREATEST(0, FLOOR((p.longitude + 180) / ?) - ?))::integer AS cell_x"
			values = append(values, grid.StepX, grid.WestTile)
		} else {
			selectCells += "LEAST(7, GREATEST(0, FLOOR(((CASE WHEN p.longitude < ? THEN p.longitude + 360 ELSE p.longitude END) + 180) / ?) - ?))::integer AS cell_x"
			values = append(values, bounds.West, grid.StepX, grid.WestTile)
		}
	} else {
		selectCells += yCell + ", "
		values = append(values, bounds.South, stepY)
		if bounds.West < bounds.East {
			selectCells += xCell
			values = append(values, bounds.West, stepX)
		} else {
			selectCells += xWrapCell
			values = append(values, bounds.West, bounds.West, bounds.West, stepX)
		}
	}
	scoped := baiduPhotoMapOwnerEligibleQuery(readCtx, db, ownerID, bounds, projection).
		Select(selectCells, values...)
	// NULL means legacy unfiltered behavior for existing internal callers.
	// HTTP cells always supplies the same validated member Range as Gallery.
	order := "scoped.asset_id ASC"
	if galleryMemberNodes != nil {
		if (options.SortBy != "" && options.SortBy != "captured" && options.SortBy != "added") ||
			(options.SortDir != "" && options.SortDir != "asc" && options.SortDir != "desc") {
			return empty, fmt.Errorf("invalid Gallery map sort")
		}
		scoped = scoped.Where("p.primary_node_id IN (?)", galleryMemberNodes)
		direction := "DESC"
		if options.SortDir == "asc" {
			direction = "ASC"
		}
		if options.SortBy == "added" {
			order = "scoped.added_at " + direction + ", scoped.node_id " + direction
		} else {
			// Match the Gallery's captured-date NULL policy, created-at and
			// Node-ID tie breakers without disclosing capture metadata to SDK.
			order = "CASE WHEN scoped.captured_at IS NULL THEN 1 ELSE 0 END ASC, " +
				"scoped.captured_at " + direction + ", scoped.added_at " + direction +
				", scoped.node_id " + direction
		}
	}
	ranked := db.WithContext(readCtx).Table("(?) AS scoped", scoped).
		Select("scoped.*, COUNT(*) OVER (PARTITION BY scoped.cell_x, scoped.cell_y) AS photo_count, " +
			"ROW_NUMBER() OVER (PARTITION BY scoped.cell_x, scoped.cell_y ORDER BY " + order + ") AS row_in_cell")
	var cells []baiduPhotoMapCell
	err = db.WithContext(readCtx).Table("(?) AS ranked", ranked).
		Select("ranked.cell_x, ranked.cell_y, ranked.photo_count, ranked.asset_id, "+
			"ranked.node_id, ranked.node_revision, ranked.media_kind, ranked.latitude, ranked.longitude").
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
			(cell.MediaKind != meta.MediaKindImage && cell.MediaKind != meta.MediaKindVideo) ||
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
	result := baiduPhotoMapCellPage{
		Items: cells, TotalCount: total,
		GridColumns: baiduPhotoMapCellGrid, GridRows: baiduPhotoMapCellGrid,
	}
	if stable {
		result.GridScheme = baiduPhotoMapWorldStableGrid
	}
	return result, nil
}
