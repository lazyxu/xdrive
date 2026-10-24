package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Separate from the Baidu Child's Map-only ticket; this single-use nonce
// transports only a strictly validated Gallery PhotoScope to the SAME Owner.
const baiduMapScopeHandoffTTL = 90 * time.Second
const baiduMapScopeHandoffMaxPending = 4
const baiduMapScopeHandoffPath = "/api/v1/media/places/baidu-jsapi/scope-handoff"
const baiduMapScopeConsumePath = "/api/v1/media/places/baidu-jsapi/scope-handoff/consume"

type baiduMapHandoffFilters struct {
	SortBy       string `json:"sort_by"`
	SortDir      string `json:"sort_dir"`
	Favorite     *bool  `json:"favorite,omitempty"`
	AssetKind    string `json:"asset_kind,omitempty"`
	CapturedFrom string `json:"captured_from,omitempty"`
	CapturedTo   string `json:"captured_to,omitempty"`
	TimeZone     string `json:"time_zone,omitempty"`
}
type baiduMapHandoffScope struct {
	AlbumKey string                 `json:"albumKey"`
	Filters  baiduMapHandoffFilters `json:"filters"`
}
type baiduMapHandoffCamera struct {
	CoordinateSpace string  `json:"coordinate_space"`
	Latitude        float64 `json:"latitude"`
	Longitude       float64 `json:"longitude"`
	Zoom            int     `json:"zoom"`
}
type baiduMapHandoffIssue struct {
	TargetMode string
	Scope      baiduMapHandoffScope
	Camera     *baiduMapHandoffCamera
}
type baiduMapHandoffResult struct {
	Scope  baiduMapHandoffScope
	Camera *baiduMapHandoffCamera
}
type baiduMapHandoffConsume struct {
	TargetMode string
	Token      string
}

var errBaiduMapScopeDenied = errors.New("map scope handoff denied")

// Duplicate, null or unknown JSON keys cannot become an implicit unfiltered
// PhotoScope. encoding/json struct decoding alone would silently accept them.
func baiduHandoffJSONObject(data []byte, keys ...string) (map[string]json.RawMessage, error) {
	allowed := make(map[string]bool, len(keys))
	for _, key := range keys {
		allowed[key] = true
	}
	d := json.NewDecoder(bytes.NewReader(data))
	first, err := d.Token()
	if err != nil || first != json.Delim('{') {
		return nil, errBaiduMapScopeDenied
	}
	out := make(map[string]json.RawMessage, len(keys))
	for d.More() {
		token, err := d.Token()
		name, ok := token.(string)
		if err != nil || !ok || !allowed[name] {
			return nil, errBaiduMapScopeDenied
		}
		if _, seen := out[name]; seen {
			return nil, errBaiduMapScopeDenied
		}
		var raw json.RawMessage
		if d.Decode(&raw) != nil || len(raw) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			return nil, errBaiduMapScopeDenied
		}
		out[name] = raw
	}
	last, err := d.Token()
	if err != nil || last != json.Delim('}') {
		return nil, errBaiduMapScopeDenied
	}
	if _, err := d.Token(); err != io.EOF {
		return nil, errBaiduMapScopeDenied
	}
	return out, nil
}

func baiduHandoffJSONString(raw json.RawMessage) (string, error) {
	var text string
	if len(raw) == 0 || raw[0] != '"' || json.Unmarshal(raw, &text) != nil {
		return "", errBaiduMapScopeDenied
	}
	if !utf8.ValidString(text) || strings.TrimSpace(text) != text {
		return "", errBaiduMapScopeDenied
	}
	return text, nil
}

func baiduHandoffTarget(raw json.RawMessage) (string, error) {
	mode, err := baiduHandoffJSONString(raw)
	if err != nil || mode != "prototype" && mode != "isolated" {
		return "", errBaiduMapScopeDenied
	}
	return mode, nil
}

func baiduHandoffScope(raw json.RawMessage) (baiduMapHandoffScope, error) {
	deny := func() (baiduMapHandoffScope, error) { return baiduMapHandoffScope{}, errBaiduMapScopeDenied }
	fields, err := baiduHandoffJSONObject(raw, "albumKey", "filters")
	if err != nil || len(fields) != 2 {
		return deny()
	}
	albumKey, err := baiduHandoffJSONString(fields["albumKey"])
	if err != nil || len(albumKey) > 512 || utf8.RuneCountInString(albumKey) > 512 ||
		albumKey != "" && !validMediaAlbumKey(albumKey) {
		return deny()
	}
	values, err := baiduHandoffJSONObject(fields["filters"], "sort_by", "sort_dir",
		"favorite", "asset_kind", "captured_from", "captured_to", "time_zone")
	if err != nil || len(values) < 2 {
		return deny()
	}
	by, err := baiduHandoffJSONString(values["sort_by"])
	if err != nil || by != "captured" && by != "added" {
		return deny()
	}
	direction, err := baiduHandoffJSONString(values["sort_dir"])
	if err != nil || direction != "asc" && direction != "desc" {
		return deny()
	}
	accepted := baiduMapHandoffScope{AlbumKey: albumKey,
		Filters: baiduMapHandoffFilters{SortBy: by, SortDir: direction}}
	if fav, ok := values["favorite"]; ok {
		if string(fav) != "true" && string(fav) != "false" {
			return deny()
		}
		value := string(fav) == "true"
		accepted.Filters.Favorite = &value
	}
	if kind, ok := values["asset_kind"]; ok {
		value, err := baiduHandoffJSONString(kind)
		if err != nil || value != "image" && value != "video" {
			return deny()
		}
		accepted.Filters.AssetKind = value
	}
	for _, entry := range []struct {
		key  string
		dest *string
	}{
		{"captured_from", &accepted.Filters.CapturedFrom},
		{"captured_to", &accepted.Filters.CapturedTo},
		{"time_zone", &accepted.Filters.TimeZone},
	} {
		if raw, ok := values[entry.key]; ok {
			value, err := baiduHandoffJSONString(raw)
			if err != nil || value == "" || len(value) > 128 {
				return deny()
			}
			*entry.dest = value
		}
	}
	f := accepted.Filters
	var start, end time.Time
	if f.CapturedFrom != "" {
		start, err = mediaCapturedBoundary(f.CapturedFrom, f.TimeZone)
		if err != nil {
			return deny()
		}
	}
	if f.CapturedTo != "" {
		end, err = mediaCapturedBoundary(f.CapturedTo, f.TimeZone)
		if err != nil {
			return deny()
		}
	}
	if !start.IsZero() && !end.IsZero() && !start.Before(end) {
		return deny()
	}
	if f.TimeZone != "" {
		if _, _, err = mediaIANAZone(f.TimeZone); err != nil {
			return deny()
		}
	}
	canonical, err := json.Marshal(accepted)
	if err != nil || len(canonical) > 1024 {
		return deny()
	}
	return accepted, nil
}

func baiduHandoffCamera(raw json.RawMessage) (*baiduMapHandoffCamera, error) {
	obj, err := baiduHandoffJSONObject(raw, "coordinate_space", "latitude", "longitude", "zoom")
	if err != nil || len(obj) != 4 {
		return nil, errBaiduMapScopeDenied
	}
	space, err := baiduHandoffJSONString(obj["coordinate_space"])
	if err != nil || space != "bd09ll" {
		return nil, errBaiduMapScopeDenied
	}
	camera := &baiduMapHandoffCamera{CoordinateSpace: space}
	if json.Unmarshal(obj["latitude"], &camera.Latitude) != nil ||
		json.Unmarshal(obj["longitude"], &camera.Longitude) != nil ||
		json.Unmarshal(obj["zoom"], &camera.Zoom) != nil ||
		math.IsNaN(camera.Latitude) || math.IsNaN(camera.Longitude) ||
		math.IsInf(camera.Latitude, 0) || math.IsInf(camera.Longitude, 0) ||
		math.Abs(camera.Latitude) > 85 || math.Abs(camera.Longitude) > 180 ||
		camera.Zoom < 3 || camera.Zoom > 18 {
		return nil, errBaiduMapScopeDenied
	}
	return camera, nil
}
func baiduHandoffParseIssue(body []byte) (baiduMapHandoffIssue, error) {
	fields, err := baiduHandoffJSONObject(body, "target_mode", "scope", "camera")
	if err != nil || len(fields) < 2 || len(fields) > 3 {
		return baiduMapHandoffIssue{}, errBaiduMapScopeDenied
	}
	target, err := baiduHandoffTarget(fields["target_mode"])
	if err != nil {
		return baiduMapHandoffIssue{}, errBaiduMapScopeDenied
	}
	scope, err := baiduHandoffScope(fields["scope"])
	if err != nil {
		return baiduMapHandoffIssue{}, errBaiduMapScopeDenied
	}
	var camera *baiduMapHandoffCamera
	if raw, ok := fields["camera"]; ok {
		camera, err = baiduHandoffCamera(raw)
		if err != nil {
			return baiduMapHandoffIssue{}, errBaiduMapScopeDenied
		}
	}
	return baiduMapHandoffIssue{TargetMode: target, Scope: scope, Camera: camera}, nil
}
func baiduHandoffParseConsume(body []byte) (baiduMapHandoffConsume, error) {
	fields, err := baiduHandoffJSONObject(body, "target_mode", "ticket")
	if err != nil || len(fields) != 2 {
		return baiduMapHandoffConsume{}, errBaiduMapScopeDenied
	}
	target, err := baiduHandoffTarget(fields["target_mode"])
	if err != nil {
		return baiduMapHandoffConsume{}, errBaiduMapScopeDenied
	}
	token, err := baiduHandoffJSONString(fields["ticket"])
	if err != nil || len(token) != 64 || strings.Trim(token, "0123456789abcdef") != "" {
		return baiduMapHandoffConsume{}, errBaiduMapScopeDenied
	}
	return baiduMapHandoffConsume{TargetMode: target, Token: token}, nil
}

func baiduHandoffTransport(req *http.Request, origin, route string) bool {
	if req == nil || req.URL == nil || !strings.HasPrefix(origin, "https://") ||
		req.Method != http.MethodPost || req.URL.Path != route ||
		req.URL.RawPath != "" || req.URL.RawQuery != "" || req.URL.ForceQuery ||
		req.URL.Fragment != "" || req.ContentLength < 1 || req.ContentLength > 2048 ||
		len(req.TransferEncoding) != 0 || len(req.Header.Values("Authorization")) != 1 ||
		len(req.Header.Values("Origin")) != 1 || req.Header.Get("Origin") != origin ||
		req.Header.Get("Content-Type") != "application/json" {
		return false
	}
	site := req.Header.Values("Sec-Fetch-Site")
	if len(site) > 1 || len(site) == 1 && site[0] != "same-origin" {
		return false
	}
	for _, key := range []string{"Proxy-Authorization", "X-Forwarded-User"} {
		if len(req.Header.Values(key)) != 0 {
			return false
		}
	}
	return true
}

// Existing signed map Owner identity, session version and map epoch are
// verified again AFTER the DB transaction, preventing logout/revoke races.
func (s *Server) baiduHandoffAuth(c *gin.Context) (string, error) {
	values := c.Request.Header.Values("Authorization")
	if len(values) != 1 || !strings.HasPrefix(values[0], "Bearer ") ||
		len(values[0]) <= 7 {
		return "", errBaiduMapScopeDenied
	}
	return strings.TrimPrefix(values[0], "Bearer "), nil
}

func (s *Server) baiduHandoffAlbumRevision(ctx context.Context, tx *gorm.DB, uid uint64, album string) (uint64, error) {
	if album == "" {
		return 0, nil
	}
	var entry meta.PhotoCollection
	if err := tx.WithContext(ctx).Select("revision").Where(
		"owner_id = ? AND external_key = ? AND state = ?", uid, album, meta.PhotoCollectionStateActive).
		Take(&entry).Error; err != nil || entry.Revision == 0 {
		return 0, errBaiduMapScopeDenied
	}
	return entry.Revision, nil
}

// Issue does not authorize any media read: it stores a bounded private
// canonical PhotoScope and a target mode in PostgreSQL, not in browser storage.
func (s *Server) baiduMapScopeHandoffIssueHTTP(c *gin.Context) {
	baiduJSAPI4NoStore(c)
	deny := func() { c.JSON(http.StatusForbidden, gin.H{"error": "map_scope_handoff_denied"}) }
	if !baiduHandoffTransport(c.Request, s.AllowedOrigin, baiduMapScopeHandoffPath) {
		deny()
		return
	}
	authority, err := s.currentBaiduJSAPI4OperatorRelease(c.Request.Context())
	if err != nil || authority == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "map_runtime_unavailable"})
		return
	}
	bearer, err := s.baiduHandoffAuth(c)
	if err != nil {
		deny()
		return
	}
	now := time.Now().UTC()
	access, epoch, err := s.verifiedMapBootstrapIdentity(c.Request.Context(), bearer, now)
	if err != nil || access.UserID == 0 || access.UserID != userID(c) ||
		access.SessionVersion == 0 || epoch.OwnerID != access.UserID || epoch.Epoch == 0 ||
		authority.scope.BrowserAKRevision == 0 {
		deny()
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2048)
	payload, err := io.ReadAll(c.Request.Body)
	if err != nil || len(payload) == 0 {
		deny()
		return
	}
	input, err := baiduHandoffParseIssue(payload)
	if err != nil {
		deny()
		return
	}
	var nonce [32]byte
	if _, err = rand.Read(nonce[:]); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "map_scope_unavailable"})
		return
	}
	token := hex.EncodeToString(nonce[:])
	hash := sha256.Sum256(nonce[:])
	clear(nonce[:])
	canonical, err := json.Marshal(input.Scope)
	if err != nil {
		deny()
		return
	}
	cameraJSON := ""
	if input.Camera != nil {
		raw, err := json.Marshal(input.Camera)
		if err != nil {
			deny()
			return
		}
		cameraJSON = string(raw)
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 4*time.Second)
	defer cancel()
	row := meta.BaiduMapScopeHandoff{Hash: hex.EncodeToString(hash[:]),
		OwnerID: access.UserID, SessionVersion: access.SessionVersion,
		ConfigurationRevision: authority.scope.BrowserAKRevision,
		RevocationEpoch:       epoch.Epoch, TargetMode: input.TargetMode,
		ScopeJSON: string(canonical), CameraJSON: cameraJSON,
		ExpiresAt: now.Add(baiduMapScopeHandoffTTL)}
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var account meta.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Select("id", "session_version", "disabled_at", "must_change_password").
			Where("id = ?", access.UserID).Take(&account).Error; err != nil {
			return err
		}
		if account.ID != access.UserID || account.DisabledAt != nil ||
			account.MustChangePassword || account.SessionVersion != access.SessionVersion {
			return errBaiduMapScopeDenied
		}
		revision, err := s.baiduHandoffAlbumRevision(ctx, tx, access.UserID, input.Scope.AlbumKey)
		if err != nil {
			return err
		}
		row.AlbumRevision = revision
		// Prevent arbitrary growth even with an authenticated malicious tab.
		if err := tx.Where("owner_id = ? AND (expires_at <= ? OR consumed_at IS NOT NULL)",
			access.UserID, now).Delete(&meta.BaiduMapScopeHandoff{}).Error; err != nil {
			return err
		}
		var pending int64
		if err := tx.Model(&meta.BaiduMapScopeHandoff{}).Where(
			"owner_id = ? AND consumed_at IS NULL AND expires_at > ?", access.UserID, now).
			Count(&pending).Error; err != nil {
			return err
		}
		if pending >= baiduMapScopeHandoffMaxPending {
			return errBaiduMapScopeDenied
		}
		return tx.Create(&row).Error
	})
	if err != nil || ctx.Err() != nil {
		deny()
		return
	}
	current, latestEpoch, err := s.verifiedMapBootstrapIdentity(ctx, bearer, time.Now().UTC())
	live, releaseErr := s.currentBaiduJSAPI4OperatorRelease(ctx)
	if err != nil || releaseErr != nil || live != authority ||
		!baiduNativeViewportOwnerStillCurrent(access, epoch, current, latestEpoch) {
		deny()
		return
	}
	c.JSON(http.StatusOK, gin.H{"ticket": token, "target_mode": input.TargetMode,
		"expires_at": row.ExpiresAt.UTC()})
}

// A pure database transaction for cross-replica competing consumers. Tests
// exercise this EXACT function with two concurrent PostgreSQL clients.
func (s *Server) consumeBaiduMapScopeHandoffTx(
	ctx context.Context, hash string, now time.Time,
	ownerID, sessionVersion, revocationEpoch, configurationRevision uint64,
	targetMode string,
) (baiduMapHandoffResult, error) {
	var accepted baiduMapHandoffResult
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row meta.BaiduMapScopeHandoff
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("hash = ? AND consumed_at IS NULL AND expires_at > ?",
				hash, now).
			Take(&row).Error; err != nil {
			return err
		}
		if row.OwnerID != ownerID || row.SessionVersion != sessionVersion ||
			row.RevocationEpoch != revocationEpoch || row.RevocationEpoch == 0 ||
			row.ConfigurationRevision != configurationRevision ||
			row.TargetMode != targetMode {
			return errBaiduMapScopeDenied
		}
		var account meta.User
		if err := tx.Select("id", "session_version", "disabled_at", "must_change_password").
			Where("id = ?", ownerID).Take(&account).Error; err != nil {
			return err
		}
		if account.ID != ownerID || account.SessionVersion != sessionVersion ||
			account.DisabledAt != nil || account.MustChangePassword {
			return errBaiduMapScopeDenied
		}
		var latest meta.BaiduJSAPIMapEpoch
		if err := tx.Where("owner_id = ?", ownerID).Take(&latest).Error; err != nil {
			return err
		}
		if latest.Epoch != revocationEpoch {
			return errBaiduMapScopeDenied
		}
		scope, err := baiduHandoffScope(json.RawMessage(row.ScopeJSON))
		if err != nil {
			return err
		}
		revision, err := s.baiduHandoffAlbumRevision(ctx, tx, ownerID, scope.AlbumKey)
		if err != nil || revision != row.AlbumRevision {
			return errBaiduMapScopeDenied
		}
		updated := tx.Model(&meta.BaiduMapScopeHandoff{}).
			Where("hash = ? AND consumed_at IS NULL", row.Hash).
			Update("consumed_at", now)
		if updated.Error != nil || updated.RowsAffected != 1 {
			return errBaiduMapScopeDenied
		}
		accepted.Scope = scope
		if row.CameraJSON != "" {
			camera, err := baiduHandoffCamera(json.RawMessage(row.CameraJSON))
			if err != nil {
				return err
			}
			accepted.Camera = camera
		}
		return nil
	})
	if err != nil {
		return baiduMapHandoffResult{}, err
	}
	return accepted, nil
}

// The nonce has no authority on its own. A fresh authenticated SAME Owner,
// SessionVersion, map epoch, signed release and album revision must all match.
// Only one transaction can consume each row across Go replicas.
func (s *Server) baiduMapScopeHandoffConsumeHTTP(c *gin.Context) {
	baiduJSAPI4NoStore(c)
	deny := func() { c.JSON(http.StatusForbidden, gin.H{"error": "map_scope_handoff_denied"}) }
	if !baiduHandoffTransport(c.Request, s.AllowedOrigin, baiduMapScopeConsumePath) {
		deny()
		return
	}
	authority, err := s.currentBaiduJSAPI4OperatorRelease(c.Request.Context())
	if err != nil || authority == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "map_runtime_unavailable"})
		return
	}
	bearer, err := s.baiduHandoffAuth(c)
	if err != nil {
		deny()
		return
	}
	now := time.Now().UTC()
	access, epoch, err := s.verifiedMapBootstrapIdentity(c.Request.Context(), bearer, now)
	if err != nil || access.UserID == 0 || access.UserID != userID(c) ||
		access.SessionVersion == 0 || epoch.OwnerID != access.UserID || epoch.Epoch == 0 {
		deny()
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2048)
	payload, err := io.ReadAll(c.Request.Body)
	if err != nil {
		deny()
		return
	}
	input, err := baiduHandoffParseConsume(payload)
	if err != nil {
		deny()
		return
	}
	decoded, err := hex.DecodeString(input.Token)
	if err != nil || len(decoded) != 32 {
		deny()
		return
	}
	digest := sha256.Sum256(decoded)
	clear(decoded)
	ctx, cancel := context.WithTimeout(c.Request.Context(), 4*time.Second)
	defer cancel()
	accepted, err := s.consumeBaiduMapScopeHandoffTx(
		ctx, hex.EncodeToString(digest[:]), now,
		access.UserID, access.SessionVersion, epoch.Epoch,
		authority.scope.BrowserAKRevision, input.TargetMode,
	)
	if err != nil || ctx.Err() != nil {
		deny()
		return
	}
	current, currentEpoch, err := s.verifiedMapBootstrapIdentity(ctx, bearer, time.Now().UTC())
	live, releaseErr := s.currentBaiduJSAPI4OperatorRelease(ctx)
	if err != nil || releaseErr != nil || live != authority ||
		!baiduNativeViewportOwnerStillCurrent(access, epoch, current, currentEpoch) {
		deny()
		return
	}
	c.JSON(http.StatusOK, gin.H{"target_mode": input.TargetMode,
		"scope": accepted.Scope, "camera": accepted.Camera})
}
