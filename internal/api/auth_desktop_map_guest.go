package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const desktopMapGuestGrantTTL = 30 * time.Second
const desktopMapGuestMaxPending = 4

var (
	errDesktopMapGrantDenied  = errors.New("desktop map grant denied")
	errDesktopMapGrantLimited = errors.New("desktop map grant limit")
)

// Parse an exact, single-key JSON object. Reuse the existing strict decoder
// that rejects duplicate/unknown/null keys rather than accepting a last-win
// credential. No credentials or tickets are ever added to an HTTP URL.
func desktopMapGuestField(body []byte, key string) (string, bool) {
	if len(body) == 0 || len(body) > 1024 {
		return "", false
	}
	fields, err := baiduHandoffJSONObject(body, key)
	if err != nil || len(fields) != 1 {
		return "", false
	}
	value, err := baiduHandoffJSONString(fields[key])
	return value, err == nil && value != ""
}

func desktopMapGuestTicketHash(ticket string) (string, bool) {
	if len(ticket) != 64 || strings.Trim(ticket, "0123456789abcdef") != "" {
		return "", false
	}
	digest := sha256.Sum256([]byte(ticket))
	return hex.EncodeToString(digest[:]), true
}

// Only an authenticated native Agent may issue a one-use browser grant.
// A short-lived Access JWT by itself is deliberately insufficient: the caller
// must additionally prove the current native RefreshToken, unavailable to
// third-party JS running in the non-isolated browser map.
func (s *Server) issueDesktopMapGuestGrant(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Referrer-Policy", "no-referrer")
	user, ok := currentUser(c)
	if !ok || user.ID == 0 || user.MustChangePassword ||
		c.Request.URL.RawQuery != "" || c.ContentType() != "application/json" ||
		c.GetHeader("Origin") != "" || c.GetHeader("Sec-Fetch-Site") != "" ||
		len(c.Request.Header.Values("Authorization")) != 1 ||
		len(c.Request.Header.Values("Cookie")) != 0 ||
		!validDesktopMapGuestHost(c.Request.Host) {
		fail(c, http.StatusForbidden, "native desktop map grant denied")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 1024))
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid desktop map grant request")
		return
	}
	secret, valid := desktopMapGuestField(body, "native_refresh_token")
	if !valid || len(secret) < 32 || len(secret) > 256 {
		fail(c, http.StatusBadRequest, "invalid desktop map grant request")
		return
	}
	now := time.Now().UTC()
	var nonce [32]byte
	if _, err = rand.Read(nonce[:]); err != nil {
		fail(c, http.StatusServiceUnavailable, "desktop map grant unavailable")
		return
	}
	ticket := hex.EncodeToString(nonce[:])
	hash, _ := desktopMapGuestTicketHash(ticket)
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var native meta.RefreshToken
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("token_hash = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?",
				auth.HashRefreshToken(secret), user.ID, now).Take(&native).Error; err != nil {
			return errDesktopMapGrantDenied
		}
		var owner meta.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&owner, user.ID).Error; err != nil {
			return errDesktopMapGrantDenied
		}
		if owner.DisabledAt != nil || owner.MustChangePassword || owner.SessionVersion != user.SessionVersion ||
			owner.ID != native.UserID {
			return errDesktopMapGrantDenied
		}
		// Reclaim stale tickets for this Owner and keep active grants bounded.
		if err := tx.Where("owner_id = ? AND (expires_at <= ? OR redeemed_at IS NOT NULL)",
			user.ID, now).Delete(&meta.DesktopMapGuestGrant{}).Error; err != nil {
			return err
		}
		var outstanding int64
		if err := tx.Model(&meta.DesktopMapGuestGrant{}).
			Where("owner_id = ? AND expires_at > ? AND redeemed_at IS NULL", user.ID, now).
			Count(&outstanding).Error; err != nil {
			return err
		}
		if outstanding >= desktopMapGuestMaxPending {
			return errDesktopMapGrantLimited
		}
		return tx.Create(&meta.DesktopMapGuestGrant{
			Hash: hash, OwnerID: user.ID, SessionVersion: user.SessionVersion,
			NativeRefreshID: native.ID, Host: c.Request.Host,
			ExpiresAt: now.Add(desktopMapGuestGrantTTL),
		}).Error
	})
	if err != nil {
		switch {
		case errors.Is(err, errDesktopMapGrantDenied):
			fail(c, http.StatusUnauthorized, "native session invalid")
		case errors.Is(err, errDesktopMapGrantLimited):
			fail(c, http.StatusTooManyRequests, "desktop map grant limit")
		default:
			fail(c, http.StatusServiceUnavailable, "desktop map grant unavailable")
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"ticket": ticket, "username": user.Username,
		"expires_in": int64(desktopMapGuestGrantTTL.Seconds()),
	})
}

// The redemption endpoint is called ONLY by Desktop Main using its isolated
// Electron session.fetch. It is a same-Origin HTTPS Cookie exchange, not a
// bearer-authenticated Web API. The ticket never enters a navigation URL,
// WebView JS, provider SDK, app storage, or a third-party redirect.
func (s *Server) redeemDesktopMapGuestGrant(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Referrer-Policy", "no-referrer")
	if !requireBrowserAuthOrigin(c) {
		return
	}
	if c.Request.URL.RawQuery != "" || c.ContentType() != "application/json" ||
		c.GetHeader("Authorization") != "" || !validDesktopMapGuestHost(c.Request.Host) {
		fail(c, http.StatusForbidden, "desktop map redemption denied")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 1024))
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid desktop map ticket")
		return
	}
	ticket, valid := desktopMapGuestField(body, "ticket")
	hash, validTicket := desktopMapGuestTicketHash(ticket)
	if !valid || !validTicket {
		fail(c, http.StatusBadRequest, "invalid desktop map ticket")
		return
	}
	now := time.Now().UTC()
	var issued authResponse
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var grant meta.DesktopMapGuestGrant
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("hash = ? AND redeemed_at IS NULL AND expires_at > ?", hash, now).
			Take(&grant).Error; err != nil {
			return errDesktopMapGrantDenied
		}
		if !strings.EqualFold(grant.Host, c.Request.Host) {
			return errDesktopMapGrantDenied
		}
		var native meta.RefreshToken
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?",
				grant.NativeRefreshID, grant.OwnerID, now).Take(&native).Error; err != nil {
			return errDesktopMapGrantDenied
		}
		var user meta.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, grant.OwnerID).Error; err != nil {
			return errDesktopMapGrantDenied
		}
		if user.DisabledAt != nil || user.MustChangePassword || user.SessionVersion != grant.SessionVersion {
			return errDesktopMapGrantDenied
		}
		result := tx.Model(&grant).Where("redeemed_at IS NULL").
			Update("redeemed_at", now)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errDesktopMapGrantDenied
		}
		session, err := s.issueSession(tx, user)
		if err != nil {
			return err
		}
		// The Browser RefreshToken is not a general independent Owner session.
		// Link its renewal and its short-lived Access JWT to the original native
		// Agent authority so native logout revokes already-redeemed sessions too.
		link := tx.Model(&meta.RefreshToken{}).
			Where("token_hash = ? AND user_id = ?",
				auth.HashRefreshToken(session.RefreshToken), user.ID).
			Updates(map[string]any{
				"desktop_map_native_refresh_id": grant.NativeRefreshID,
				"desktop_map_session_version":   grant.SessionVersion,
			})
		if link.Error != nil {
			return link.Error
		}
		if link.RowsAffected != 1 {
			return errDesktopMapGrantDenied
		}
		mapAccess, err := s.Auth.IssueDesktopMapAccess(
			user.ID, grant.SessionVersion, grant.NativeRefreshID)
		if err != nil {
			return err
		}
		session.Token, session.AccessToken = mapAccess, mapAccess
		issued = session
		return nil
	})
	if err != nil {
		if errors.Is(err, errDesktopMapGrantDenied) {
			fail(c, http.StatusUnauthorized, "desktop map ticket expired or revoked")
		} else {
			fail(c, http.StatusServiceUnavailable, "desktop map redemption unavailable")
		}
		return
	}
	s.replyBrowserAuthSession(c, issued)
}

// Exact Host rules also prohibit userinfo, path and URL query confusion.
func validDesktopMapGuestHost(host string) bool {
	if host == "" || len(host) > 253 || strings.ContainsAny(host, "/@?#\\ ") {
		return false
	}
	return host != "." && !strings.HasPrefix(host, ".") && !strings.HasSuffix(host, ".")
}
