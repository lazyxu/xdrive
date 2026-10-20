package api

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// A3h-W1: one server-verified BD09 bin from an exact 8x8 /cells response.
// This is NOT an original WGS84 box, a share-token capability, or a grant
// from a provider-controlled JS click. Every member must still pass the
// original Owner, explicit consent and source revision SQL predicate.
type baiduPhotoMapCellSelection struct {
	Bounds                 baiduPhotoMapBounds
	CellX                  int
	CellY                  int
	RepresentativeAssetID  uint64
	RepresentativeNodeID   uint64
	RepresentativeRevision uint64
	PhotoCount             int64
}

func (s baiduPhotoMapCellSelection) valid() bool {
	_, _, err := baiduPhotoMapCellSteps(s.Bounds)
	return err == nil && s.CellX >= 0 && s.CellX < baiduPhotoMapCellGrid &&
		s.CellY >= 0 && s.CellY < baiduPhotoMapCellGrid &&
		s.RepresentativeAssetID > 0 && s.RepresentativeNodeID > 0 &&
		s.RepresentativeRevision > 0 && s.PhotoCount > 0
}

// Only exact, single-valued, source-reviewed fields are accepted. No user-
// supplied WGS84 tag, arbitrary URL, account/Owner, Browser AK or map Cookie.
func parseBaiduNativeMapCellItems(raw string) (baiduPhotoMapCellSelection, int, int, mediaQueryOptions, error) {
	fail := func() (baiduPhotoMapCellSelection, int, int, mediaQueryOptions, error) {
		return baiduPhotoMapCellSelection{}, 0, 0, mediaQueryOptions{}, errBaiduJSAPIResourceDenied
	}
	values, err := url.ParseQuery(raw)
	if err != nil || len(values) < 13 || len(values) > 16 {
		return fail()
	}
	required := []string{
		"west", "south", "east", "north", "cell_x", "cell_y",
		"asset_id", "node_id", "node_revision", "photo_count",
		"limit", "offset", "range",
	}
	allowed := make(map[string]bool, len(required)+3)
	for _, name := range required {
		allowed[name] = true
		if len(values[name]) != 1 || strings.TrimSpace(values[name][0]) == "" {
			return fail()
		}
	}
	for _, name := range []string{"sort_by", "sort_dir", "anchor_node_id"} {
		allowed[name] = true
	}
	for key, value := range values {
		if !allowed[key] || len(value) != 1 {
			return fail()
		}
	}
	if values.Get("range") != "true" {
		return fail()
	}
	coords := url.Values{}
	for _, name := range []string{"west", "south", "east", "north"} {
		coords.Set(name, values.Get(name))
	}
	bounds, err := parseBaiduNativeMapCells(coords.Encode())
	if err != nil {
		return fail()
	}
	cellX, errX := strconv.Atoi(values.Get("cell_x"))
	cellY, errY := strconv.Atoi(values.Get("cell_y"))
	assetID, errAsset := strconv.ParseUint(values.Get("asset_id"), 10, 64)
	nodeID, errNode := strconv.ParseUint(values.Get("node_id"), 10, 64)
	revision, errRev := strconv.ParseUint(values.Get("node_revision"), 10, 64)
	count, errCount := strconv.ParseInt(values.Get("photo_count"), 10, 64)
	limit, errLimit := strconv.Atoi(values.Get("limit"))
	offset, errOffset := strconv.Atoi(values.Get("offset"))
	if errX != nil || errY != nil || errAsset != nil || errNode != nil ||
		errRev != nil || errCount != nil || errLimit != nil || errOffset != nil ||
		limit < 1 || limit > baiduPhotoMapViewportMaxLimit ||
		offset < 0 || offset > baiduPhotoMapViewportMaxOffset {
		return fail()
	}
	selection := baiduPhotoMapCellSelection{
		Bounds: bounds, CellX: cellX, CellY: cellY,
		RepresentativeAssetID: assetID, RepresentativeNodeID: nodeID,
		RepresentativeRevision: revision, PhotoCount: count,
	}
	if !selection.valid() {
		return fail()
	}
	by := values.Get("sort_by")
	if by == "" {
		by = "captured"
	}
	if by != "captured" && by != "added" {
		return fail()
	}
	dir := values.Get("sort_dir")
	if dir == "" {
		dir = "desc"
	}
	if dir != "asc" && dir != "desc" {
		return fail()
	}
	var anchor uint64
	if rawAnchor := values.Get("anchor_node_id"); rawAnchor != "" {
		anchor, err = strconv.ParseUint(rawAnchor, 10, 64)
		if err != nil || anchor == 0 {
			return fail()
		}
	}
	options := mediaQueryOptions{SortBy: by, SortDir: dir, AnchorNodeID: anchor}
	// The pointer never leaves the Server; generic /media/items parsing cannot
	// grant this privileged BD09 scope from a URL query argument.
	options.BaiduCell = &selection
	return selection, limit, offset, options, nil
}

// The same production source + consent predicate and exact grid math as
// /cells, but filter to the chosen bin and return ONLY bounded Node IDs via a
// PostgreSQL subquery. Gallery's original ranged query owns Count, sorting,
// sparse page, virtual timeline, metadata/Live still and Viewer semantics.
func baiduPhotoMapCellMemberNodes(
	ctx context.Context, db *gorm.DB, ownerID uint64,
	selection baiduPhotoMapCellSelection,
) (*gorm.DB, error) {
	if ctx == nil || ctx.Err() != nil || db == nil || ownerID == 0 ||
		!selection.valid() {
		return nil, fmt.Errorf("invalid baidu cell member scope")
	}
	dx, dy, _ := baiduPhotoMapCellSteps(selection.Bounds)
	projection, ok := meta.BaiduPhotoMapProjectionForSpace(selection.Bounds.CoordinateSpace)
	if !ok {
		return nil, fmt.Errorf("invalid baidu cell projection")
	}
	subquery := baiduPhotoMapOwnerEligibleQuery(
		ctx, db, ownerID, selection.Bounds, projection).
		Select("p.primary_node_id").
		Where("LEAST(7, GREATEST(0, FLOOR((p.latitude - ?) / ?)))::integer = ?",
			selection.Bounds.South, dy, selection.CellY)
	if selection.Bounds.West < selection.Bounds.East {
		subquery = subquery.Where(
			"LEAST(7, GREATEST(0, FLOOR((p.longitude - ?) / ?)))::integer = ?",
			selection.Bounds.West, dx, selection.CellX)
	} else {
		// Match original /cells' wrapped [0,360) bin, never inverse-geoconvert.
		subquery = subquery.Where(
			"LEAST(7, GREATEST(0, FLOOR((CASE WHEN p.longitude >= ? THEN p.longitude - ? ELSE p.longitude + 360 - ? END) / ?)))::integer = ?",
			selection.Bounds.West, selection.Bounds.West,
			selection.Bounds.West, dx, selection.CellX)
	}
	return subquery, nil
}

func baiduPhotoMapCellSelectionCurrent(
	selection baiduPhotoMapCellSelection, page baiduPhotoMapCellPage,
) bool {
	if !selection.valid() || len(page.Items) == 0 || len(page.Items) > baiduPhotoMapCellMax ||
		page.GridColumns != baiduPhotoMapCellGrid ||
		page.GridRows != baiduPhotoMapCellGrid {
		return false
	}
	for _, cell := range page.Items {
		if cell.CellX == selection.CellX && cell.CellY == selection.CellY {
			return cell.AssetID == selection.RepresentativeAssetID &&
				cell.NodeID == selection.RepresentativeNodeID &&
				cell.NodeRevision == selection.RepresentativeRevision &&
				cell.PhotoCount == selection.PhotoCount
		}
	}
	return false
}

// W1 exposes a map-scoped *original Gallery Range DTO*, NOT a new media byte
// route or a second collection implementation. Every request is already
// authenticated by authed Router and rechecks the signed Owner after SQL.
// A stale map click is 409, never silently interpreted as a WGS84 range.
func (s *Server) listBaiduNativeMapCellItems(c *gin.Context) {
	baiduJSAPI4NoStore(c)
	release, err := s.currentBaiduJSAPI4OperatorRelease(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "map_runtime_unavailable"})
		return
	}
	headers := c.Request.Header.Values("Authorization")
	if len(headers) != 1 || !strings.HasPrefix(headers[0], "Bearer ") ||
		len(headers[0]) <= len("Bearer ") {
		c.JSON(http.StatusForbidden, gin.H{"error": "map_cell_denied"})
		return
	}
	bearer := strings.TrimPrefix(headers[0], "Bearer ")
	before, beforeEpoch, err := s.verifiedMapBootstrapIdentity(
		c.Request.Context(), bearer, time.Now().UTC())
	if err != nil || before.UserID == 0 || before.UserID != userID(c) ||
		beforeEpoch.OwnerID != before.UserID || beforeEpoch.Epoch == 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "map_cell_denied"})
		return
	}
	selection, limit, offset, options, err := parseBaiduNativeMapCellItems(c.Request.URL.RawQuery)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_map_cell_range"})
		return
	}
	ctx, stop := context.WithTimeout(c.Request.Context(), 8*time.Second)
	defer stop()
	sourcePage, err := queryBaiduPhotoMapCells(ctx, s.DB, before.UserID, selection.Bounds)
	if err != nil || ctx.Err() != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "map_cell_unavailable"})
		return
	}
	if !baiduPhotoMapCellSelectionCurrent(selection, sourcePage) {
		c.JSON(http.StatusConflict, gin.H{"error": "map_cell_changed"})
		return
	}
	// Same original Gallery Count/Anchor/VirtualCollection/Viewer paging.
	page, err := s.queryMediaItemRange(ctx, before.UserID, options, "", limit, offset)
	if err != nil || ctx.Err() != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "map_cell_unavailable"})
		return
	}
	// Map grid counts authorized PhotoAssets; regular Gallery may additionally
	// collapse Live motion via its standard folding rules, never widen scope.
	if page.TotalCount > selection.PhotoCount {
		c.JSON(http.StatusConflict, gin.H{"error": "map_cell_changed"})
		return
	}
	freshPage, err := queryBaiduPhotoMapCells(ctx, s.DB, before.UserID, selection.Bounds)
	if err != nil || ctx.Err() != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "map_cell_unavailable"})
		return
	}
	if !baiduPhotoMapCellSelectionCurrent(selection, freshPage) {
		c.JSON(http.StatusConflict, gin.H{"error": "map_cell_changed"})
		return
	}
	after, afterEpoch, err := s.verifiedMapBootstrapIdentity(ctx, bearer, time.Now().UTC())
	if err != nil || ctx.Err() != nil ||
		!baiduNativeViewportOwnerStillCurrent(before, beforeEpoch, after, afterEpoch) {
		c.JSON(http.StatusForbidden, gin.H{"error": "map_cell_denied"})
		return
	}
	currentRelease, err := s.currentBaiduJSAPI4OperatorRelease(c.Request.Context())
	if err != nil || currentRelease != release || ctx.Err() != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "map_runtime_unavailable"})
		return
	}
	c.JSON(http.StatusOK, page)
}
