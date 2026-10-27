package api

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
)

type baiduNativeMapCellsDTO struct {
	CoordinateSpace string              `json:"coordinate_space"`
	IndexScope      string              `json:"index_scope"`
	Cells           []baiduPhotoMapCell `json:"cells"`
	TotalCount      int64               `json:"total_count"`
	GridColumns     int                 `json:"grid_columns"`
	GridRows        int                 `json:"grid_rows"`
}

// A3c19: no limit, offset, zoom, user, coordinate tag or arbitrary geometry
// parameters. This endpoint summarizes one exact BD09 rectangle into at most
// 64 cells regardless of how many opted-in PhotoAssets it contains.
func parseBaiduNativeMapCells(raw string) (baiduPhotoMapBounds, error) {
	vals, err := url.ParseQuery(raw)
	if err != nil || len(vals) != 4 {
		return baiduPhotoMapBounds{}, errBaiduJSAPIResourceDenied
	}
	for _, k := range []string{"west", "south", "east", "north"} {
		if len(vals[k]) != 1 {
			return baiduPhotoMapBounds{}, errBaiduJSAPIResourceDenied
		}
	}
	bounds, _, _, err := parseBaiduNativeMapViewport(raw)
	if err != nil || bounds.CoordinateSpace != meta.BaiduPhotoMapSpaceBD09LL {
		return baiduPhotoMapBounds{}, errBaiduJSAPIResourceDenied
	}
	if _, _, err := baiduPhotoMapCellSteps(bounds); err != nil {
		return baiduPhotoMapBounds{}, errBaiduJSAPIResourceDenied
	}
	return bounds, nil
}

// Only the reviewed Gallery membership keys may accompany a native BD09
// viewport. Do not allow unknown filters to silently widen a cell query.
func parseBaiduNativeMapCellsScope(raw string) (baiduPhotoMapBounds, string, error) {
	deny := func() (baiduPhotoMapBounds, string, error) {
		return baiduPhotoMapBounds{}, "", errBaiduJSAPIResourceDenied
	}
	vals, err := url.ParseQuery(raw)
	if err != nil || len(vals) < 4 || len(vals) > 12 {
		return deny()
	}
	allowed := map[string]bool{
		"west": true, "south": true, "east": true, "north": true,
		"sort_by": true, "sort_dir": true, "time_zone": true,
		"kind": true, "favorite": true, "captured_from": true,
		"captured_to": true, "album": true,
	}
	geometry := url.Values{}
	for key, values := range vals {
		if !allowed[key] || len(values) != 1 || values[0] == "" ||
			strings.TrimSpace(values[0]) != values[0] {
			return deny()
		}
		if key == "west" || key == "south" || key == "east" || key == "north" {
			geometry.Set(key, values[0])
		}
	}
	bounds, err := parseBaiduNativeMapCells(geometry.Encode())
	if err != nil {
		return deny()
	}
	album := vals.Get("album")
	if album != "" && (!validMediaAlbumKey(album) ||
		utf8.RuneCountInString(album) > 512) {
		return deny()
	}
	return bounds, album, nil
}

// baiduNativeMapCoverCellsForClient preserves the original Cell wire shape
// for installed older Web/PWA clients. A shallow copy ensures the visibility
// negotiation cannot mutate the source Owner response or its selected IDs.
func baiduNativeMapCoverCellsForClient(cells []baiduPhotoMapCell, includeKind bool) []baiduPhotoMapCell {
	if includeKind {
		return cells
	}
	out := make([]baiduPhotoMapCell, len(cells))
	copy(out, cells)
	for i := range out {
		out[i].MediaKind = ""
	}
	return out
}

// An authenticated, release-fenced, no-provider-egress summary. It never
// issues map Cookie, calls Baidu, grants media bytes or returns original WGS84.
// The same post-query Owner/session/epoch/signed-release checks as the raw
// Owner viewport are mandatory, including immediately before writing JSON.
func (s *Server) listBaiduNativeMapCells(c *gin.Context) {
	baiduJSAPI4NoStore(c)
	authority, err := s.currentBaiduJSAPI4OperatorRelease(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "map_runtime_unavailable"})
		return
	}
	auths := c.Request.Header.Values("Authorization")
	if len(auths) != 1 || !strings.HasPrefix(auths[0], "Bearer ") ||
		len(auths[0]) <= len("Bearer ") {
		c.JSON(http.StatusForbidden, gin.H{"error": "map_cells_denied"})
		return
	}
	bearer := strings.TrimPrefix(auths[0], "Bearer ")
	prior, oldEpoch, err := s.verifiedMapBootstrapIdentity(
		c.Request.Context(), bearer, time.Now().UTC())
	if err != nil || prior.UserID == 0 || prior.UserID != userID(c) ||
		oldEpoch.OwnerID != prior.UserID || oldEpoch.Epoch == 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "map_cells_denied"})
		return
	}
	bounds, album, err := parseBaiduNativeMapCellsScope(c.Request.URL.RawQuery)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_map_cells_viewport"})
		return
	}
	options, valid := mediaQueryFromRequest(c)
	if !valid {
		return
	}
	ctx, stop := context.WithTimeout(c.Request.Context(), baiduPhotoMapQueryTimeout)
	defer stop()
	// Reuse the original Owner/PhotoMetadata/Album query from Gallery Range,
	// then intersect with the signed, live BD09 Owner/GPS/source-revision predicate.
	gallery, err := s.mediaItemsBaseQuery(ctx, prior.UserID, options, album)
	if err != nil || ctx.Err() != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "map_cells_unavailable"})
		return
	}
	page, err := queryBaiduPhotoMapCellsScoped(ctx, s.DB, prior.UserID,
		bounds, gallery.Select("n.id"), options)
	if err != nil || ctx.Err() != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "map_cells_unavailable"})
		return
	}
	current, currentEpoch, err := s.verifiedMapBootstrapIdentity(
		ctx, bearer, time.Now().UTC())
	if err != nil || ctx.Err() != nil ||
		!baiduNativeViewportOwnerStillCurrent(prior, oldEpoch, current, currentEpoch) {
		c.JSON(http.StatusForbidden, gin.H{"error": "map_cells_denied"})
		return
	}
	live, err := s.currentBaiduJSAPI4OperatorRelease(c.Request.Context())
	if err != nil || live != authority || ctx.Err() != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "map_runtime_unavailable"})
		return
	}
	// Older installed PWAs strictly validate the historical 8-field Cell.
	// Keep the old wire shape unless the same-origin authenticated Client
	// opts into the new reviewed representative-kind field. This header is
	// NOT authority or a request for more media bytes; Owner/Scope checks
	// above still run in full before any response is written.
	kindHeader := c.Request.Header.Values("X-XDrive-Map-Cover-Kind")
	wantsKind := len(kindHeader) == 1 && kindHeader[0] == "video-poster-v1"
	c.JSON(http.StatusOK, baiduNativeMapCellsDTO{
		CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL,
		IndexScope:      baiduNativeMapIndexScope,
		Cells:           baiduNativeMapCoverCellsForClient(page.Items, wantsKind),
		TotalCount:      page.TotalCount,
		GridColumns:     page.GridColumns,
		GridRows:        page.GridRows,
	})
}
