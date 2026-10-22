package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
	"github.com/lazyxu/xdrive/internal/meta"
	"golang.org/x/net/publicsuffix"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const baiduChildTicketTTL = 25 * time.Second

// Different DNS hosts or ports on the same registrable Cookie site are NOT
// isolation. Both origins must be absolute, canonical HTTPS with no port,
// local address or path. Use the real Public Suffix List, not last-two-labels.
func xdriveBaiduIndependentChildOrigins(parent, child string) bool {
	site := func(value string) (string, bool) {
		if len(value) == 0 || len(value) > 253 {
			return "", false
		}
		u, err := url.Parse(value)
		if err != nil || u == nil || u.String() != value ||
			u.Scheme != "https" || u.Host == "" || u.Port() != "" ||
			u.User != nil || u.RawPath != "" || u.Path != "" ||
			u.RawQuery != "" || u.Fragment != "" {
			return "", false
		}
		host := u.Hostname()
		if net.ParseIP(host) != nil || strings.EqualFold(host, "localhost") ||
			strings.HasSuffix(strings.ToLower(host), ".localhost") ||
			strings.HasSuffix(strings.ToLower(host), ".local") ||
			strings.HasSuffix(strings.ToLower(host), ".test") ||
			strings.HasSuffix(strings.ToLower(host), ".invalid") {
			return "", false
		}
		if host != strings.ToLower(host) || strings.HasSuffix(host, ".") ||
			strings.Contains(host, "..") || strings.Contains(host, "_") {
			return "", false
		}
		effective, err := publicsuffix.EffectiveTLDPlusOne(host)
		return effective, err == nil && effective != "" && strings.Contains(effective, ".")
	}
	p, okP := site(parent)
	c, okC := site(child)
	return okP && okC && p != c
}

func (s *Server) approvedBaiduIsolatedChildOrigin() string {
	if s == nil || !xdriveBaiduIndependentChildOrigins(s.AllowedOrigin, s.BaiduJSAPIChildOrigin) {
		return ""
	}
	return s.BaiduJSAPIChildOrigin
}

func isolatedBaiduChildTransport(req *http.Request, trustedOrigin, method, route string) bool {
	if req == nil || req.URL == nil || req.Method != method ||
		req.URL.Path != route || req.URL.RawPath != "" ||
		req.URL.RawQuery != "" || req.URL.ForceQuery || req.URL.Fragment != "" ||
		req.ContentLength > 256 || len(req.TransferEncoding) != 0 {
		return false
	}
	origin := req.Header.Values("Origin")
	site := req.Header.Values("Sec-Fetch-Site")
	if len(origin) != 1 || origin[0] != trustedOrigin ||
		len(site) > 1 || len(site) == 1 && site[0] != "same-origin" {
		return false
	}
	for _, name := range []string{"Proxy-Authorization", "X-Forwarded-User"} {
		if len(req.Header.Values(name)) != 0 {
			return false
		}
	}
	return true
}

// The authenticated Gallery creates a one-use, short-lived MAP-ONLY ticket.
// It is never a Bearer replacement; its only permitted action is to mint
// one Partitioned HttpOnly child-origin Cookie for /_BMapService/.
// The Parent never receives that Cookie or the Browser AK.
func (s *Server) baiduJSAPI4ChildTicketHTTP(c *gin.Context) {
	baiduJSAPI4NoStore(c)
	child := s.approvedBaiduIsolatedChildOrigin()
	if child == "" || !isolatedBaiduChildTransport(c.Request, s.AllowedOrigin,
		http.MethodPost, "/api/v1/media/places/baidu-jsapi/child-ticket") ||
		c.Request.ContentLength != 0 || len(c.Request.Header.Values("Authorization")) != 1 {
		c.JSON(http.StatusForbidden, gin.H{"error": "isolated_map_unavailable"})
		return
	}
	authority, err := s.currentBaiduJSAPI4OperatorRelease(c.Request.Context())
	if err != nil || authority == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "isolated_map_unavailable"})
		return
	}
	auth := c.Request.Header.Values("Authorization")[0]
	if !strings.HasPrefix(auth, "Bearer ") || len(auth) <= 7 {
		c.JSON(http.StatusForbidden, gin.H{"error": "isolated_map_denied"})
		return
	}
	now := time.Now().UTC()
	prior, epoch, err := s.verifiedMapBootstrapIdentity(c.Request.Context(), strings.TrimPrefix(auth, "Bearer "), now)
	if err != nil || prior.UserID == 0 || prior.UserID != userID(c) || prior.SessionVersion == 0 ||
		epoch.OwnerID != prior.UserID || epoch.Epoch == 0 || authority.scope.BrowserAKRevision == 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "isolated_map_denied"})
		return
	}
	var random [32]byte
	if _, err = rand.Read(random[:]); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "isolated_map_unavailable"})
		return
	}
	ticket := hex.EncodeToString(random[:])
	hash := sha256.Sum256(random[:])
	clear(random[:])
	row := meta.BaiduJSAPIChildTicket{Hash: hex.EncodeToString(hash[:]),
		OwnerID: prior.UserID, SessionVersion: prior.SessionVersion,
		ConfigurationRevision: authority.scope.BrowserAKRevision,
		RevocationEpoch:       epoch.Epoch, ExpiresAt: now.Add(baiduChildTicketTTL)}
	ctx, stop := context.WithTimeout(c.Request.Context(), 3*time.Second)
	defer stop()
	if s.DB.WithContext(ctx).Create(&row).Error != nil ||
		s.approvedBaiduIsolatedChildOrigin() != child {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "isolated_map_unavailable"})
		return
	}
	live, err := s.currentBaiduJSAPI4OperatorRelease(ctx)
	if err != nil || live != authority {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "isolated_map_unavailable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"provider": "baidu-jsapi-4.0", "child_origin": child,
		"ticket": ticket})
}

func (s *Server) baiduJSAPI4ChildRedeemHTTP(c *gin.Context) {
	baiduJSAPI4NoStore(c)
	child := s.approvedBaiduIsolatedChildOrigin()
	if child == "" || c.Request.Host != strings.TrimPrefix(child, "https://") ||
		!isolatedBaiduChildTransport(c.Request, child, http.MethodPost,
			"/_xdrive_baidu_isolated/session") ||
		len(c.Request.Header.Values("Authorization")) != 0 ||
		len(c.Request.Header.Values("Cookie")) != 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "isolated_map_denied"})
		return
	}
	authority, err := s.currentBaiduJSAPI4OperatorRelease(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "isolated_map_unavailable"})
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 128)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var input struct {
		Ticket string `json:"ticket"`
	}
	if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF ||
		len(input.Ticket) != 64 || strings.Trim(input.Ticket, "0123456789abcdef") != "" {
		c.JSON(http.StatusForbidden, gin.H{"error": "isolated_map_denied"})
		return
	}
	raw, err := hex.DecodeString(input.Ticket)
	if err != nil || len(raw) != 32 {
		c.JSON(http.StatusForbidden, gin.H{"error": "isolated_map_denied"})
		return
	}
	hash := sha256.Sum256(raw)
	clear(raw)
	ctx, stop := context.WithTimeout(c.Request.Context(), 4*time.Second)
	defer stop()
	now := time.Now().UTC()
	state := baidumapjsapi.MapSessionState{}
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row meta.BaiduJSAPIChildTicket
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("hash = ? AND redeemed_at IS NULL AND expires_at > ?", hex.EncodeToString(hash[:]), now).
			Take(&row).Error; err != nil {
			return err
		}
		if row.OwnerID == 0 || row.SessionVersion == 0 ||
			row.ConfigurationRevision != authority.scope.BrowserAKRevision ||
			row.RevocationEpoch == 0 {
			return errors.New("denied")
		}
		var account meta.User
		if err := tx.Select("id", "session_version", "disabled_at", "must_change_password").
			Where("id = ?", row.OwnerID).Take(&account).Error; err != nil {
			return err
		}
		var epoch meta.BaiduJSAPIMapEpoch
		if err := tx.Where("owner_id = ?", row.OwnerID).Take(&epoch).Error; err != nil {
			return err
		}
		if account.ID != row.OwnerID || account.SessionVersion != row.SessionVersion ||
			account.DisabledAt != nil || account.MustChangePassword ||
			epoch.OwnerID != row.OwnerID || epoch.Epoch != row.RevocationEpoch {
			return errors.New("denied")
		}
		changed := tx.Model(&meta.BaiduJSAPIChildTicket{}).
			Where("hash = ? AND redeemed_at IS NULL", row.Hash).Update("redeemed_at", now)
		if changed.Error != nil || changed.RowsAffected != 1 {
			return errors.New("denied")
		}
		state = baidumapjsapi.MapSessionState{OwnerID: row.OwnerID,
			SessionVersion: row.SessionVersion, ConfigurationRevision: row.ConfigurationRevision,
			RevocationEpoch: row.RevocationEpoch, AccountActive: true, RuntimeAuthorized: true}
		return nil
	})
	if err != nil || ctx.Err() != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "isolated_map_denied"})
		return
	}
	cookie, err := baidumapjsapi.IssueMapSession(authority.cookieKey[:], state, time.Now().UTC())
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "isolated_map_denied"})
		return
	}
	// The child is intentionally third-party relative to the top-level Gallery.
	// Strict cookies would never accompany its tile requests. CHIPS partitions
	// this Cookie by the top-level site, excluding other top-level applications.
	cookie.Partitioned = true
	cookie.SameSite = http.SameSiteNoneMode
	live, err := s.currentBaiduJSAPI4OperatorRelease(c.Request.Context())
	if err != nil || live != authority || s.approvedBaiduIsolatedChildOrigin() != child {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "isolated_map_unavailable"})
		return
	}
	http.SetCookie(c.Writer, cookie)
	c.JSON(http.StatusOK, gin.H{"provider": "baidu-jsapi-4.0", "runtime_enabled": true})
}
