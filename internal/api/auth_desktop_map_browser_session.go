package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

// desktopMapBrowserSessionProbe checks a live HttpOnly Cookie and exact Owner.
// It is deliberately read-only: browser refresh would rotate that credential,
// racing the already mounted HTTPS WebView. No Access Token or Cookie is issued.
func (s *Server) desktopMapBrowserSessionProbe(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Referrer-Policy", "no-referrer")
	if !requireBrowserAuthOrigin(c) {
		return
	}
	expected := strings.TrimSpace(c.GetHeader("X-XDrive-Browser-Owner"))
	if c.Request.URL.RawQuery != "" || c.Request.ContentLength != 0 ||
		c.GetHeader("Authorization") != "" ||
		len(c.Request.Header.Values("X-XDrive-Browser-Owner")) != 1 ||
		expected == "" || len(expected) > 128 {
		fail(c, http.StatusForbidden, "desktop map session probe denied")
		return
	}
	secret, ok := browserRefreshCookie(c)
	if !ok {
		fail(c, http.StatusUnauthorized, "missing browser session")
		return
	}
	now := time.Now().UTC()
	var current meta.RefreshToken
	if err := s.DB.WithContext(c.Request.Context()).
		Where("token_hash = ? AND revoked_at IS NULL AND expires_at > ?",
			auth.HashRefreshToken(secret), now).
		Take(&current).Error; err != nil {
		fail(c, http.StatusUnauthorized, "invalid browser session")
		return
	}
	var user meta.User
	if err := s.DB.WithContext(c.Request.Context()).First(&user, current.UserID).Error; err != nil {
		fail(c, http.StatusUnauthorized, "invalid browser session")
		return
	}
	if user.DisabledAt != nil || user.MustChangePassword {
		fail(c, http.StatusForbidden, "browser session requires new login")
		return
	}
	if user.Username != expected {
		fail(c, http.StatusConflict, "browser session owner changed")
		return
	}
	c.JSON(http.StatusOK, gin.H{"username": user.Username, "browser_session": true})
}
