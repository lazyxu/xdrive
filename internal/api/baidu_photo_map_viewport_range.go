package api

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// P0 viewport wall: select CURRENT authorized photos by the native BD09
// camera without converting its bounds back into original photo WGS84.
// The result is the existing sparse Gallery Media Range (Count/Anchor/Viewer),
// never a separate photo index or an unbounded list for the browser/SDK.
func parseBaiduNativeMapViewportItems(raw string) (baiduPhotoMapBounds, int, int, string, error) {
	fail := func() (baiduPhotoMapBounds, int, int, string, error) {
		return baiduPhotoMapBounds{}, 0, 0, "", errBaiduJSAPIResourceDenied
	}
	values, err := url.ParseQuery(raw)
	if err != nil || len(values) < 7 || len(values) > 16 {
		return fail()
	}
	required := []string{"west", "south", "east", "north", "limit", "offset", "range"}
	allowed := make(map[string]bool, 16)
	for _, name := range required {
		allowed[name] = true
	}
	// The surrounding Gallery filters narrow the already-authorized map view.
	// No client-supplied Owner, latitude space, arbitrary bbox, URL or consent
	// override. No fold_duplicates: map totals remain logical PhotoAsset counts.
	for _, name := range []string{"sort_by", "sort_dir", "anchor_node_id",
		"album", "favorite", "captured_from", "captured_to", "kind", "time_zone"} {
		allowed[name] = true
	}
	for name, list := range values {
		if !allowed[name] || len(list) != 1 || strings.TrimSpace(list[0]) == "" {
			return fail()
		}
	}
	for _, name := range required {
		if len(values[name]) != 1 {
			return fail()
		}
	}
	if values.Get("range") != "true" {
		return fail()
	}
	coords := url.Values{}
	for _, name := range []string{"west", "south", "east", "north", "limit", "offset"} {
		coords.Set(name, values.Get(name))
	}
	bounds, limit, offset, err := parseBaiduNativeMapViewport(coords.Encode())
	if err != nil || bounds.CoordinateSpace != meta.BaiduPhotoMapSpaceBD09LL {
		return fail()
	}
	album := values.Get("album")
	if album != "" && !validMediaAlbumKey(album) {
		return fail()
	}
	return bounds, limit, offset, album, nil
}

// Check EVERY returned Node against the current source/Consent/Owner relation
// after the potentially slow sparse Gallery SQL. A revocation while a page is
// being computed must never publish its thumbnail/metadata to the Parent.
func baiduMapViewportPageMembersStillAuthorized(
	ctx context.Context, db *gorm.DB, ownerID uint64,
	bounds baiduPhotoMapBounds, page mediaItemRangeDTO,
) (bool, error) {
	if ctx == nil || ctx.Err() != nil || db == nil || ownerID == 0 ||
		bounds.CoordinateSpace != meta.BaiduPhotoMapSpaceBD09LL || !bounds.valid() ||
		len(page.Items) > baiduPhotoMapViewportMaxLimit || page.TotalCount < 0 {
		return false, fmt.Errorf("invalid map viewport verification")
	}
	if len(page.Items) == 0 {
		return true, nil
	}
	ids := make([]uint64, 0, len(page.Items))
	seen := make(map[uint64]bool, len(page.Items))
	for _, item := range page.Items {
		id := item.Node.ID
		if id == 0 || seen[id] {
			return false, nil
		}
		seen[id] = true
		ids = append(ids, id)
	}
	projection, ok := meta.BaiduPhotoMapProjectionForSpace(bounds.CoordinateSpace)
	if !ok {
		return false, fmt.Errorf("invalid BD09 projection")
	}
	var fresh int64
	err := baiduPhotoMapOwnerEligibleQuery(ctx, db, ownerID, bounds, projection).
		Where("p.primary_node_id IN ?", ids).
		Distinct("p.primary_node_id").Count(&fresh).Error
	if err != nil || ctx.Err() != nil {
		return false, fmt.Errorf("map viewport member revalidation unavailable")
	}
	return fresh == int64(len(ids)), nil
}

func (s *Server) listBaiduNativeMapViewportItems(c *gin.Context) {
	baiduJSAPI4NoStore(c)
	// Signed runtime first: no metadata leaks or parsing side effects when the
	// isolated map release is not currently authorized.
	release, err := s.currentBaiduJSAPI4OperatorRelease(c.Request.Context())
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
	before, beforeEpoch, err := s.verifiedMapBootstrapIdentity(
		c.Request.Context(), bearer, time.Now().UTC())
	if err != nil || before.UserID == 0 || before.UserID != userID(c) ||
		beforeEpoch.OwnerID != before.UserID || beforeEpoch.Epoch == 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "map_viewport_denied"})
		return
	}
	bounds, limit, offset, album, err := parseBaiduNativeMapViewportItems(c.Request.URL.RawQuery)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_map_viewport_range"})
		return
	}
	// Only standard Gallery filters are admitted by the strict parser above.
	// The new privileged BD09 selection is never accepted by /media/items.
	options, valid := mediaQueryFromRequest(c)
	if !valid {
		return
	}
	options.BaiduViewport = &bounds
	ctx, cancel := context.WithTimeout(c.Request.Context(), 8*time.Second)
	defer cancel()
	page, err := s.queryMediaItemRange(ctx, before.UserID, options, album, limit, offset)
	if err != nil || ctx.Err() != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "map_viewport_unavailable"})
		return
	}
	stillCurrent, err := baiduMapViewportPageMembersStillAuthorized(
		ctx, s.DB, before.UserID, bounds, page)
	if err != nil || ctx.Err() != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "map_viewport_unavailable"})
		return
	}
	if !stillCurrent {
		c.JSON(http.StatusConflict, gin.H{"error": "map_viewport_changed"})
		return
	}
	after, afterEpoch, err := s.verifiedMapBootstrapIdentity(ctx, bearer, time.Now().UTC())
	if err != nil || ctx.Err() != nil ||
		!baiduNativeViewportOwnerStillCurrent(before, beforeEpoch, after, afterEpoch) {
		c.JSON(http.StatusForbidden, gin.H{"error": "map_viewport_denied"})
		return
	}
	currentRelease, err := s.currentBaiduJSAPI4OperatorRelease(c.Request.Context())
	if err != nil || currentRelease != release || ctx.Err() != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "map_runtime_unavailable"})
		return
	}
	c.JSON(http.StatusOK, page)
}
