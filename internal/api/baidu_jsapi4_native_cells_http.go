package api

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"time"

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
	bounds, err := parseBaiduNativeMapCells(c.Request.URL.RawQuery)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_map_cells_viewport"})
		return
	}
	ctx, stop := context.WithTimeout(c.Request.Context(), baiduPhotoMapQueryTimeout)
	defer stop()
	page, err := queryBaiduPhotoMapCells(ctx, s.DB, prior.UserID, bounds)
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
	c.JSON(http.StatusOK, baiduNativeMapCellsDTO{
		CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL,
		IndexScope:      baiduNativeMapIndexScope,
		Cells:           page.Items,
		TotalCount:      page.TotalCount,
		GridColumns:     page.GridColumns,
		GridRows:        page.GridRows,
	})
}
