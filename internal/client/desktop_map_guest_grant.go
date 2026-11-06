package client

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
)

// DesktopMapGuestGrant is a transient native-only receipt. Its ticket is a
// capability usable exactly once by the trusted Electron Main process, never
// by a renderer, browser WebView, or the third-party SDK.
type DesktopMapGuestGrant struct {
	Ticket    string `json:"ticket"`
	Username  string `json:"username"`
	ExpiresIn int64  `json:"expires_in"`
}

// IssueDesktopMapGuestGrant requires BOTH the existing Owner Access JWT and
// the Agent's current native refresh secret. An arbitrary Web JavaScript page
// holding only an Owner Access JWT cannot upgrade itself to a durable Cookie.
func (c *Client) IssueDesktopMapGuestGrant(ctx context.Context) (DesktopMapGuestGrant, error) {
	u, err := url.Parse(c.BaseURL)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil ||
		(u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" {
		return DesktopMapGuestGrant{}, errors.New("Desktop map grant requires a trusted HTTPS Server")
	}
	if err := c.ensureFresh(ctx); err != nil {
		return DesktopMapGuestGrant{}, err
	}
	tokens := c.sessionTokens()
	if c.loadTokens != nil {
		// Another native process may have rotated the shared RefreshToken.
		// Always take the persisted current value, without exporting it to JS.
		if latest, loadErr := c.loadTokens(); loadErr == nil &&
			strings.TrimSpace(latest.RefreshToken) != "" &&
			latest.RefreshToken != tokens.RefreshToken {
			c.setSessionTokensMemory(latest)
			tokens = latest
		}
	}
	if tokens.AccessToken == "" || strings.TrimSpace(tokens.RefreshToken) == "" {
		return DesktopMapGuestGrant{}, errors.New("native Desktop session is unavailable")
	}
	var grant DesktopMapGuestGrant
	if err := c.json(ctx, http.MethodPost, "/api/v1/auth/desktop-map/issue",
		struct {
			NativeRefreshToken string `json:"native_refresh_token"`
		}{NativeRefreshToken: tokens.RefreshToken}, &grant); err != nil {
		return DesktopMapGuestGrant{}, err
	}
	if len(grant.Ticket) != 64 ||
		strings.Trim(grant.Ticket, "0123456789abcdef") != "" ||
		grant.Username == "" || len(grant.Username) > 128 ||
		grant.ExpiresIn <= 0 || grant.ExpiresIn > 30 {
		return DesktopMapGuestGrant{}, errors.New("untrusted Desktop map grant receipt")
	}
	return grant, nil
}
