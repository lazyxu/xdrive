package api

import (
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const browserRefreshCookieName = "__Host-xdrive_refresh"

// Browser endpoints are opt-in and separate from the existing JSON Token API
// used by Desktop, Android and xd. An ambient Cookie is NEVER an API Bearer.
func browserAuthRoute(c *gin.Context) bool {
	switch c.FullPath() {
	case "/api/v1/auth/browser/login", "/api/v1/auth/browser/refresh", "/api/v1/auth/browser/logout", "/api/v1/me/change-password/browser":
		return true
	default:
		return false
	}
}

// Explicit same-origin POST protection: no wildcard CORS, no inferred proxy
// forwarding headers, no cross-site credential rotation, no HTTP deployment.
// Gin sees the original Host forwarded by the trusted HTTP frontend.
func browserAuthSameOrigin(c *gin.Context) bool {
	if c.Request == nil || c.Request.Host == "" {
		return false
	}
	origin := strings.TrimSpace(c.GetHeader("Origin"))
	u, err := url.Parse(origin)
	if err != nil || u == nil || u.Scheme != "https" || u.Host == "" ||
		u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" ||
		origin != "https://"+u.Host ||
		!strings.EqualFold(u.Host, c.Request.Host) {
		return false
	}
	site := strings.ToLower(strings.TrimSpace(c.GetHeader("Sec-Fetch-Site")))
	return site == "" || site == "same-origin"
}

func requireBrowserAuthOrigin(c *gin.Context) bool {
	if browserAuthSameOrigin(c) {
		return true
	}
	c.Header("Cache-Control", "no-store")
	fail(c, http.StatusForbidden, "same-origin HTTPS browser authentication required")
	return false
}

func browserRefreshCookie(c *gin.Context) (string, bool) {
	cookie, err := c.Request.Cookie(browserRefreshCookieName)
	if err != nil || cookie == nil || strings.TrimSpace(cookie.Value) == "" {
		return "", false
	}
	return cookie.Value, true
}

func writeBrowserRefreshCookie(c *gin.Context, refreshToken string, ttl time.Duration) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	http.SetCookie(c.Writer, &http.Cookie{
		Name: browserRefreshCookieName, Value: refreshToken,
		Path: "/", Secure: true, HttpOnly: true, SameSite: http.SameSiteStrictMode,
		MaxAge: int(ttl.Seconds()), Expires: time.Now().Add(ttl),
	})
}

func clearBrowserRefreshCookie(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	http.SetCookie(c.Writer, &http.Cookie{
		Name: browserRefreshCookieName, Value: "", Path: "/",
		Secure: true, HttpOnly: true, SameSite: http.SameSiteStrictMode,
		MaxAge: -1, Expires: time.Unix(0, 0),
	})
}

func (s *Server) replyBrowserAuthSession(c *gin.Context, issued authResponse) {
	writeBrowserRefreshCookie(c, issued.RefreshToken, s.RefreshTTL)
	// Never expose a durable Refresh Token to browser JavaScript. The access
	// JWT is still short-lived and travels as a Bearer to existing Owner APIs.
	issued.RefreshToken = ""
	issued.BrowserSession = true
	c.JSON(http.StatusOK, issued)
}
