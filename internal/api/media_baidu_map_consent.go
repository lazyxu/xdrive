package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"mime"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	baiduConsentMinimumSeconds int64 = 600
	baiduConsentMaximumSeconds int64 = 30 * 24 * 60 * 60
	baiduConsentBodyMaxBytes         = 1024
)

var errMediaBaiduConsentAuditUnavailable = errors.New("photo map consent audit unavailable")

// "authorized" means this Owner consented to the EXACT source photo. It
// does NOT mean JSAPI4 is enabled or that any GPS was sent to Baidu.
type mediaBaiduConsentDTO struct {
	Status        string     `json:"status"`
	Revision      uint64     `json:"revision"`
	Authorized    bool       `json:"authorized"`
	SourceCurrent bool       `json:"source_current"`
	ExpiresAt     *time.Time `json:"expires_at,omitempty"`
}

type mediaBaiduConsentInput struct {
	ExpectedRevision      *uint64 `json:"expected_revision"`
	ExpiresInSeconds      *int64  `json:"expires_in_seconds"`
	ConsentToBaidu        *bool   `json:"consent_to_baidu_conversion"`
	ConsentToDerivedIndex *bool   `json:"consent_to_derived_index"`
}

func mediaBaiduConsentPrivateHeaders(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	c.Header("Pragma", "no-cache")
	c.Header("Referrer-Policy", "no-referrer")
}

// Browser writes are origin and Fetch-Metadata fenced. Native Agent requests
// may omit Origin only when they supply their own authenticated Bearer token.
func (s *Server) mediaBaiduConsentWriteOrigin(c *gin.Context) bool {
	origin := c.GetHeader("Origin")
	if origin != "" &&
		(s.AllowedOrigin == "" || s.AllowedOrigin == "*" || origin != s.AllowedOrigin) {
		return false
	}
	switch c.GetHeader("Sec-Fetch-Site") {
	case "", "none", "same-origin":
		return true
	case "same-site":
		return origin != "" && origin == s.AllowedOrigin && s.AllowedOrigin != "*"
	default:
		return false
	}
}

// id is the existing Gallery/Viewer primary NODE ID, not an Asset or Owner ID.
// Allow soft-deleted nodes only for Owner privacy revocation, never for grants.
func (s *Server) mediaBaiduConsentAsset(
	c *gin.Context, allowDeleted bool,
) (meta.Node, meta.PhotoAsset, bool) {
	var node meta.Node
	var asset meta.PhotoAsset
	id, valid := parseID(c.Param("id"))
	if !valid || userID(c) == 0 {
		fail(c, http.StatusNotFound, "photo not found")
		return node, asset, false
	}
	q := s.DB.WithContext(c.Request.Context()).Where(
		"id = ? AND owner_id = ? AND type = ?", id, userID(c), meta.NodeTypeFile,
	)
	if !allowDeleted {
		q = q.Where("deleted_at IS NULL")
	}
	if err := q.Take(&node).Error; err != nil {
		fail(c, http.StatusNotFound, "photo not found")
		return node, asset, false
	}
	if err := s.DB.WithContext(c.Request.Context()).Where(
		"owner_id = ? AND primary_node_id = ?", userID(c), node.ID,
	).Take(&asset).Error; err != nil ||
		(asset.Kind != meta.PhotoAssetKindImage && asset.Kind != meta.PhotoAssetKindVideo) {
		fail(c, http.StatusNotFound, "photo not found")
		return node, asset, false
	}
	return node, asset, true
}

func (s *Server) mediaBaiduConsentCurrentMedia(
	ctx context.Context, ownerID uint64, node meta.Node,
) (meta.MediaMetadata, bool) {
	var media meta.MediaMetadata
	if node.DeletedAt != nil || node.Revision == 0 ||
		s.DB.WithContext(ctx).Where(
			"node_id = ? AND owner_id = ? AND node_revision = ? AND index_state = ? AND media_kind IN ?",
			node.ID, ownerID, node.Revision, meta.MediaIndexStateReady,
			[]string{meta.MediaKindImage, meta.MediaKindVideo},
		).Take(&media).Error != nil || media.UpdatedAt.IsZero() ||
		media.Latitude == nil || media.Longitude == nil {
		return media, false
	}
	lat, lng := *media.Latitude, *media.Longitude
	return media, !math.IsNaN(lat) && !math.IsInf(lat, 0) &&
		!math.IsNaN(lng) && !math.IsInf(lng, 0) &&
		lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

func mediaBaiduConsentSourceCurrent(
	grant meta.BaiduPhotoMapConsent, node meta.Node, media meta.MediaMetadata, ready bool,
) bool {
	return ready && grant.SourceNodeID != 0 &&
		grant.SourceNodeID == node.ID && grant.SourceNodeRevision == node.Revision &&
		grant.SourceMediaUpdatedAt != nil &&
		grant.SourceMediaUpdatedAt.Equal(media.UpdatedAt) &&
		grant.SourceLatitude != nil && grant.SourceLongitude != nil &&
		*grant.SourceLatitude == *media.Latitude &&
		*grant.SourceLongitude == *media.Longitude
}

func (s *Server) getMediaBaiduConsent(c *gin.Context) {
	mediaBaiduConsentPrivateHeaders(c)
	node, asset, ok := s.mediaBaiduConsentAsset(c, false)
	if !ok {
		return
	}
	var grant meta.BaiduPhotoMapConsent
	err := s.DB.WithContext(c.Request.Context()).Where(
		"asset_id = ? AND owner_id = ?", asset.ID, userID(c),
	).Take(&grant).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusOK, mediaBaiduConsentDTO{Status: "not_granted"})
		return
	}
	if err != nil {
		fail(c, http.StatusInternalServerError, "read photo consent failed")
		return
	}
	media, ready := s.mediaBaiduConsentCurrentMedia(c.Request.Context(), userID(c), node)
	sourceCurrent := mediaBaiduConsentSourceCurrent(grant, node, media, ready)
	status := "authorized"
	if grant.RevokedAt != nil || !grant.AllowIndex || !grant.AllowBaiduConversion {
		status = "revoked"
	} else if grant.Revision == 0 || !grant.ExpiresAt.After(time.Now().UTC()) {
		status = "expired"
	} else if !sourceCurrent {
		status = "source_changed"
	}
	expiry := grant.ExpiresAt
	c.JSON(http.StatusOK, mediaBaiduConsentDTO{
		Status: status, Revision: grant.Revision,
		Authorized: status == "authorized", SourceCurrent: sourceCurrent, ExpiresAt: &expiry,
	})
}

func (s *Server) putMediaBaiduConsent(c *gin.Context) {
	mediaBaiduConsentPrivateHeaders(c)
	if !s.mediaBaiduConsentWriteOrigin(c) {
		fail(c, http.StatusForbidden, "photo consent origin denied")
		return
	}
	mimeType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || mimeType != "application/json" {
		fail(c, http.StatusUnsupportedMediaType, "application/json required")
		return
	}
	if c.Request.ContentLength > baiduConsentBodyMaxBytes {
		fail(c, http.StatusRequestEntityTooLarge, "photo consent request too large")
		return
	}
	rawBody, err := io.ReadAll(io.LimitReader(c.Request.Body, baiduConsentBodyMaxBytes+1))
	if err != nil || len(rawBody) > baiduConsentBodyMaxBytes {
		fail(c, http.StatusRequestEntityTooLarge, "photo consent request too large")
		return
	}
	var input mediaBaiduConsentInput
	decoder := json.NewDecoder(bytes.NewReader(rawBody))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid photo consent request")
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF ||
		input.ExpectedRevision == nil || input.ExpiresInSeconds == nil ||
		input.ConsentToBaidu == nil || !*input.ConsentToBaidu ||
		input.ConsentToDerivedIndex == nil || !*input.ConsentToDerivedIndex ||
		*input.ExpiresInSeconds < baiduConsentMinimumSeconds ||
		*input.ExpiresInSeconds > baiduConsentMaximumSeconds ||
		*input.ExpectedRevision == ^uint64(0) {
		fail(c, http.StatusBadRequest, "explicit consent, revision and bounded expiry required")
		return
	}
	node, asset, ok := s.mediaBaiduConsentAsset(c, false)
	if !ok {
		return
	}
	media, ready := s.mediaBaiduConsentCurrentMedia(c.Request.Context(), userID(c), node)
	if !ready {
		fail(c, http.StatusConflict, "current photo location unavailable")
		return
	}
	actor, ok := currentUser(c)
	if !ok || actor.ID == 0 || actor.SessionVersion == 0 {
		fail(c, http.StatusUnauthorized, "current session required")
		return
	}
	audit := auditEventFromContext(c, "media.photo_map.consent.grant", "photo_asset",
		strconv.FormatUint(asset.ID, 10), "", auditpkg.ResultSuccess, nil)
	decision := func(ctx context.Context, tx *gorm.DB, ownerID, assetID uint64) (auditpkg.Event, error) {
		var current meta.User
		err := tx.Where(
			"id = ? AND session_version = ? AND disabled_at IS NULL AND must_change_password = ?",
			actor.ID, actor.SessionVersion, false,
		).Take(&current).Error
		if ctx.Err() != nil || err != nil || current.ID != ownerID ||
			assetID != asset.ID || current.ID != userID(c) {
			return auditpkg.Event{}, errBaiduPhotoMapGrantDenied
		}
		uid := current.ID
		audit.ActorUserID = &uid
		return audit, nil
	}
	expiry := time.Now().UTC().Add(time.Duration(*input.ExpiresInSeconds) * time.Second)
	grant, err := grantBaiduPhotoMapConsent(c.Request.Context(), s.DB, baiduPhotoMapGrantCandidate{
		OwnerID: userID(c), AssetID: asset.ID, PrimaryNodeID: node.ID,
		NodeRevision: node.Revision, MediaUpdatedAt: media.UpdatedAt,
		SourceLatitude: *media.Latitude, SourceLongitude: *media.Longitude,
		ExpectedConsentRevision: *input.ExpectedRevision, ExpiresAt: expiry,
	}, decision)
	if err != nil {
		fail(c, http.StatusConflict, "photo consent changed; reload and retry")
		return
	}
	expiry = grant.ExpiresAt
	c.JSON(http.StatusOK, mediaBaiduConsentDTO{
		Status: "authorized", Revision: grant.Revision,
		Authorized: true, SourceCurrent: true, ExpiresAt: &expiry,
	})
}

func (s *Server) deleteMediaBaiduConsent(c *gin.Context) {
	mediaBaiduConsentPrivateHeaders(c)
	if !s.mediaBaiduConsentWriteOrigin(c) {
		fail(c, http.StatusForbidden, "photo consent origin denied")
		return
	}
	_, asset, ok := s.mediaBaiduConsentAsset(c, true)
	if !ok {
		return
	}
	revision, ok := expectedRevision(c)
	if !ok {
		return
	}
	actor, ok := currentUser(c)
	if !ok || actor.ID == 0 || actor.SessionVersion == 0 {
		fail(c, http.StatusUnauthorized, "current session required")
		return
	}
	audit := auditEventFromContext(c, "media.photo_map.consent.revoke",
		"photo_asset", strconv.FormatUint(asset.ID, 10), "", auditpkg.ResultSuccess,
		map[string]any{"revision": revision + 1, "purpose": "baidu-forward-map-index"})
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var current meta.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND session_version = ? AND disabled_at IS NULL AND must_change_password = ?",
				actor.ID, actor.SessionVersion, false).
			Take(&current).Error; err != nil {
			return errBaiduPhotoMapConsentDenied
		}
		// A nested savepoint joins this transaction. Audit failure rolls back
		// BOTH the consent CAS and derived-coordinate purge.
		if err := revokeBaiduPhotoMapConsent(c.Request.Context(), tx, current.ID, asset.ID, revision); err != nil {
			return errBaiduPhotoMapConsentDenied
		}
		uid := current.ID
		audit.ActorUserID = &uid
		audit.ActorUsername = current.Username
		audit.ActorRole = current.Role
		if err := recordAuditTx(tx, audit); err != nil {
			return errMediaBaiduConsentAuditUnavailable
		}
		return nil
	})
	if errors.Is(err, errMediaBaiduConsentAuditUnavailable) {
		fail(c, http.StatusInternalServerError, "photo consent audit unavailable; no change made")
		return
	}
	if err != nil {
		fail(c, http.StatusConflict, "photo consent changed or unavailable")
		return
	}
	c.JSON(http.StatusOK, mediaBaiduConsentDTO{Status: "revoked", Revision: revision + 1})
}
