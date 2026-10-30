package localbackupipc

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"
)

// ServerConnection is a non-secret projection of the owning Agent's current
// login. It does not grant an xDrive Server role to the DSM browser.
type ServerConnection struct {
	Configured         bool   `json:"configured"`
	Server             string `json:"server,omitempty"`
	Username           string `json:"username,omitempty"`
	MustChangePassword bool   `json:"must_change_password"`
}

func validDSMLoginServer(raw string) bool {
	if len(raw) < len("https://x") || len(raw) > 512 || raw != strings.TrimSpace(raw) ||
		strings.ContainsAny(raw, "\r\n\x00") {
		return false
	}
	u, err := url.Parse(raw)
	return err == nil && u.Scheme == "https" && u.Hostname() != "" &&
		u.User == nil && u.Opaque == "" && !u.ForceQuery && u.RawQuery == "" &&
		u.Fragment == "" && (u.Path == "" || u.Path == "/") && u.RawPath == ""
}

func sameDSMLoginServer(a, b string) bool {
	first, e1 := url.Parse(a)
	second, e2 := url.Parse(b)
	if e1 != nil || e2 != nil || !validDSMLoginServer(a) || !validDSMLoginServer(b) {
		return false
	}
	port := func(u *url.URL) string {
		if u.Port() == "" {
			return "443"
		}
		return u.Port()
	}
	return strings.EqualFold(first.Hostname(), second.Hostname()) && port(first) == port(second)
}

// ServerConnection reads the existing protected loopback Agent status. Browser
// callers never receive the discovery bearer, saved session or Root grants.
func (c *Client) ServerConnection(ctx context.Context) (ServerConnection, error) {
	var out ServerConnection
	if c == nil || !hasCapability(c.capabilities, "auth") {
		return out, errors.New("owning Agent does not support login")
	}
	if err := c.request(ctx, http.MethodGet, "/v1/status", nil, &out); err != nil {
		return ServerConnection{}, err
	}
	if out.Configured && (!validDSMLoginServer(out.Server) ||
		len(out.Username) == 0 || len(out.Username) > 128) {
		return ServerConnection{}, errors.New("invalid owning Agent Server identity")
	}
	if !out.Configured && (out.Server != "" || out.Username != "") {
		return ServerConnection{}, errors.New("inconsistent owning Agent login status")
	}
	return out, nil
}

// LoginServer is deliberately limited to initial login or RE-login to the
// same xDrive Server and account. Switching Owners while a native Runner may
// hold durable work needs a separate coordinated authorization protocol.
// Agent /v1/auth/login already exists in backup-only mode; no second login
// engine, credentials file, password log, browser token or IPC proxy is added.
func (c *Client) LoginServer(ctx context.Context, server, username, password string) error {
	if !validDSMLoginServer(server) || len(username) == 0 || len(username) > 128 ||
		username != strings.TrimSpace(username) ||
		strings.ContainsAny(username, "\r\n\x00") ||
		len(password) == 0 || len(password) > 4096 ||
		!utf8.ValidString(password) || strings.ContainsAny(password, "\r\n\x00") {
		return errors.New("invalid DSM Server login fields")
	}
	current, err := c.ServerConnection(ctx)
	if err != nil {
		return err
	}
	if current.Configured &&
		(!sameDSMLoginServer(current.Server, server) || current.Username != username) {
		return errors.New("DSM Server or Owner switch requires native Source migration")
	}
	var acknowledged struct {
		Configured         bool   `json:"configured"`
		Server             string `json:"server"`
		Username           string `json:"username"`
		MustChangePassword bool   `json:"must_change_password"`
	}
	// Existing loopback Agent performs real Server TLS authentication and
	// persists credentials only through the original restricted userconfig.
	if err := c.request(ctx, http.MethodPost, "/v1/auth/login", map[string]string{
		"server": server, "username": username, "password": password, "mount_path": "",
	}, &acknowledged); err != nil {
		return err
	}
	if !acknowledged.Configured || !sameDSMLoginServer(acknowledged.Server, server) ||
		acknowledged.Username != username || acknowledged.MustChangePassword {
		return errors.New("owning Agent did not confirm the requested Server login")
	}
	return nil
}
