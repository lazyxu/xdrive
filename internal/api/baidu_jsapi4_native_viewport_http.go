package api

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
)

// A3c13: a real, bounded Server Owner API for CURRENT consent-fenced BD-09
// derived photo positions. This is NOT a generic Baidu resource proxy and
// never performs coordinate conversion, AK access or provider egress.
//
// Do not reuse /media/places/viewport: that endpoint accepts original WGS84;
// BD-09 map-native bounds are fundamentally different coordinate contracts.
// This endpoint is unusable until the independent signed JSAPI4 production
// release is active. Saved admin "desired_enabled" is NOT authorization.
type baiduNativeMapViewportDTO struct {
	CoordinateSpace string               `json:"coordinate_space"`
	IndexScope      string               `json:"index_scope"`
	Items           []baiduPhotoMapPoint `json:"items"`
	TotalCount      int64                `json:"total_count"`
	Offset          int                  `json:"offset"`
	Limit           int                  `json:"limit"`
	HasMore         bool                 `json:"has_more"`
}

const baiduNativeMapIndexScope = "explicit_opt_in_only"

// The client MUST send only BD-09 map geometry. There is intentionally no
// "coordinate_space" query argument: the Server fixes the frame and rejects
// unknown fields (including a forged WGS84/GCJ02 tag).
func parseBaiduNativeMapViewport(raw string) (baiduPhotoMapBounds, int, int, error) {
	rect, limit, offset, err := parseMediaPlaceViewport(raw)
	if err != nil {
		return baiduPhotoMapBounds{}, 0, 0, err
	}
	bounds := baiduPhotoMapBounds{
		West: rect.West, South: rect.South,
		East: rect.East, North: rect.North,
		CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL,
	}
	if !bounds.valid() {
		return baiduPhotoMapBounds{}, 0, 0, errBaiduJSAPIResourceDenied
	}
	return bounds, limit, offset, nil
}

func (s *Server) listBaiduNativeMapViewport(c *gin.Context) {
	baiduJSAPI4NoStore(c)
	// Release and credential proof is checked BEFORE parsing an untrusted
	// map envelope or touching the spatial index. No map metadata is exposed
	// in an unlicensed deployment.
	authority, err := s.currentBaiduJSAPI4OperatorRelease(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "map_runtime_unavailable"})
		return
	}
	headers := c.Request.Header.Values("Authorization")
	if len(headers) != 1 || !strings.HasPrefix(headers[0], "Bearer ") ||
		len(headers[0]) <= len("Bearer ") {
		c.JSON(http.StatusForbidden, gin.H{"error": "map_viewport_denied"})
		return
	}
	bearer := strings.TrimPrefix(headers[0], "Bearer ")
	// The regular Gin authorization middleware has already identified the
	// Owner. Independently check current JWT issued-at, DB SessionVersion
	// and revocation map epoch, so an old login cannot reuse released maps.
	access, _, err := s.verifiedMapBootstrapIdentity(c.Request.Context(), bearer, time.Now().UTC())
	if err != nil || access.UserID == 0 || access.UserID != userID(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "map_viewport_denied"})
		return
	}
	bounds, limit, offset, err := parseBaiduNativeMapViewport(c.Request.URL.RawQuery)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_map_viewport"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), baiduPhotoMapQueryTimeout)
	defer cancel()
	// queryBaiduPhotoMapViewport itself joins current User, PhotoAsset, Node,
	// ready MediaMetadata and explicit unexpired source/version-bound opt-in.
	// It counts ALL eligible points, pages at most 100, supports antimeridian,
	// and never returns any original WGS84 coordinates to the map SDK.
	page, err := queryBaiduPhotoMapViewport(ctx, s.DB, access.UserID,
		bounds, limit, offset)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "map_viewport_unavailable"})
		return
	}
	// Revocation/Browser AK rotation during a slow DB query must not send
	// an obsolete collection after its signed release has been retired.
	current, err := s.currentBaiduJSAPI4OperatorRelease(c.Request.Context())
	if err != nil || current != authority || ctx.Err() != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "map_runtime_unavailable"})
		return
	}
	if page.Items == nil {
		page.Items = []baiduPhotoMapPoint{}
	}
	c.JSON(http.StatusOK, baiduNativeMapViewportDTO{
		CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL,
		IndexScope:      baiduNativeMapIndexScope,
		Items:           page.Items,
		TotalCount:      page.TotalCount,
		Offset:          page.Offset,
		Limit:           page.Limit,
		HasMore:         page.HasMore,
	})
}
