package api

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const baiduPhotoFocusMaxID uint64 = 9007199254740991

// A Parent-only, current Owner photo camera hint; NOT an authorized Gallery
// collection, a provider/Child capability or original WGS84 provenance.
type baiduPhotoFocusDTO struct {
	CoordinateSpace string  `json:"coordinate_space"`
	IndexScope      string  `json:"index_scope"`
	NodeID          uint64  `json:"node_id"`
	NodeRevision    uint64  `json:"node_revision"`
	Latitude        float64 `json:"latitude"`
	Longitude       float64 `json:"longitude"`
}

// Only exact, canonical current Node identity; never user/account/GPS geometry.
func parseBaiduPhotoFocusQuery(raw string) (nodeID, revision uint64, ok bool) {
	q, err := url.ParseQuery(raw)
	if err != nil || len(q) != 2 || len(q["node_id"]) != 1 || len(q["node_revision"]) != 1 {
		return 0, 0, false
	}
	nodeID, err = strconv.ParseUint(q.Get("node_id"), 10, 64)
	if err != nil || nodeID == 0 || nodeID > baiduPhotoFocusMaxID ||
		strconv.FormatUint(nodeID, 10) != q.Get("node_id") {
		return 0, 0, false
	}
	revision, err = strconv.ParseUint(q.Get("node_revision"), 10, 64)
	if err != nil || revision == 0 || revision > baiduPhotoFocusMaxID ||
		strconv.FormatUint(revision, 10) != q.Get("node_revision") {
		return 0, 0, false
	}
	return nodeID, revision, true
}

// One exact derived point through the existing current Owner/PhotoAsset/Node,
// source Media updated_at+GPS and BD09 projection predicate used by /cells.
// No obsolete additional per-photo Consent is required or consulted.
func queryBaiduPhotoFocus(
	ctx context.Context, db *gorm.DB, ownerID, nodeID, revision uint64,
) (baiduPhotoFocusDTO, bool, error) {
	if ctx == nil || ctx.Err() != nil || db == nil || ownerID == 0 ||
		nodeID == 0 || revision == 0 ||
		nodeID > baiduPhotoFocusMaxID || revision > baiduPhotoFocusMaxID {
		return baiduPhotoFocusDTO{}, false, errBaiduJSAPIResourceDenied
	}
	bounds := baiduPhotoMapBounds{
		West: -180, South: -90, East: 180, North: 90,
		CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL,
	}
	projection, valid := meta.BaiduPhotoMapProjectionForSpace(bounds.CoordinateSpace)
	if !valid {
		return baiduPhotoFocusDTO{}, false, errBaiduJSAPIResourceDenied
	}
	var rows []struct {
		NodeID       uint64
		NodeRevision uint64
		Latitude     float64
		Longitude    float64
	}
	err := baiduPhotoMapOwnerEligibleQuery(ctx, db, ownerID, bounds, projection).
		Where("p.primary_node_id = ? AND p.node_revision = ?", nodeID, revision).
		Select("p.primary_node_id AS node_id, p.node_revision AS node_revision, p.latitude AS latitude, p.longitude AS longitude").
		Limit(2).Scan(&rows).Error
	if err != nil {
		return baiduPhotoFocusDTO{}, false, err
	}
	if err := ctx.Err(); err != nil {
		return baiduPhotoFocusDTO{}, false, err
	}
	// Multiple distinct PhotoAssets for one Node cannot confer arbitrary focus.
	if len(rows) != 1 || rows[0].NodeID != nodeID || rows[0].NodeRevision != revision {
		return baiduPhotoFocusDTO{}, false, nil
	}
	return baiduPhotoFocusDTO{
		CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL,
		IndexScope:      baiduNativeMapIndexScope,
		NodeID:          nodeID, NodeRevision: revision,
		Latitude: rows[0].Latitude, Longitude: rows[0].Longitude,
	}, true, nil
}

func (s *Server) getBaiduNativeMapPhotoFocus(c *gin.Context) {
	baiduJSAPI4NoStore(c)
	// Check signed release BEFORE parsing or disclosing any private point.
	release, err := s.currentBaiduJSAPI4OperatorRelease(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "map_runtime_unavailable"})
		return
	}
	auths := c.Request.Header.Values("Authorization")
	if len(auths) != 1 || !strings.HasPrefix(auths[0], "Bearer ") ||
		len(auths[0]) <= len("Bearer ") {
		c.JSON(http.StatusForbidden, gin.H{"error": "map_photo_focus_denied"})
		return
	}
	bearer := strings.TrimPrefix(auths[0], "Bearer ")
	before, previousEpoch, err := s.verifiedMapBootstrapIdentity(
		c.Request.Context(), bearer, time.Now().UTC())
	if err != nil || before.UserID == 0 || before.UserID != userID(c) ||
		previousEpoch.OwnerID != before.UserID || previousEpoch.Epoch == 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "map_photo_focus_denied"})
		return
	}
	nodeID, revision, valid := parseBaiduPhotoFocusQuery(c.Request.URL.RawQuery)
	if !valid {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_map_photo_focus"})
		return
	}
	ctx, stop := context.WithTimeout(c.Request.Context(), baiduPhotoMapQueryTimeout)
	defer stop()
	focus, found, err := queryBaiduPhotoFocus(ctx, s.DB, before.UserID, nodeID, revision)
	if err != nil || ctx.Err() != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "map_photo_focus_unavailable"})
		return
	}
	after, currentEpoch, err := s.verifiedMapBootstrapIdentity(ctx, bearer, time.Now().UTC())
	if err != nil || ctx.Err() != nil ||
		!baiduNativeViewportOwnerStillCurrent(before, previousEpoch, after, currentEpoch) {
		c.JSON(http.StatusForbidden, gin.H{"error": "map_photo_focus_denied"})
		return
	}
	current, err := s.currentBaiduJSAPI4OperatorRelease(c.Request.Context())
	if err != nil || current != release || ctx.Err() != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "map_runtime_unavailable"})
		return
	}
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "map_photo_focus_unavailable"})
		return
	}
	c.JSON(http.StatusOK, focus)
}
