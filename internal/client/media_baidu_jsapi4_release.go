package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
)

// A trusted Owner GET on the exact Server status endpoint is the only
// authority for a future isolated Electron Child Origin. The Desktop
// Renderer cannot choose a provider host, account, URL or signing key.
type MediaBaiduJSAPI4Release struct {
	Provider            string `json:"provider"`
	Enabled             bool   `json:"enabled"`
	ActivationState     string `json:"activation_state"`
	Attribution         string `json:"attribution"`
	IsolatedChildOrigin string `json:"isolated_child_origin"`
}

func (v MediaBaiduJSAPI4Release) ValidForTransport() bool {
	if v.Provider != "baidu-jsapi-4.0" || !v.Enabled ||
		v.ActivationState != "authorized_signed_release" ||
		v.Attribution != "© 百度地图" ||
		len(v.IsolatedChildOrigin) < len("https://a.b") ||
		len(v.IsolatedChildOrigin) > 253 {
		return false
	}
	u, err := url.Parse(v.IsolatedChildOrigin)
	return err == nil && u.Scheme == "https" && u.Host != "" &&
		u.Hostname() != "" && u.User == nil && u.Path == "" &&
		u.RawPath == "" && u.RawQuery == "" && u.Fragment == "" &&
		u.Opaque == "" && "https://"+u.Host == v.IsolatedChildOrigin
}

// Do not let an old/broken/malicious Server return a success-shaped
// partial response, Owner identity, credentials or unreviewed fields.
func (v *MediaBaiduJSAPI4Release) UnmarshalJSON(data []byte) error {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	fields := map[string]any{
		"provider":              &v.Provider,
		"enabled":               &v.Enabled,
		"activation_state":      &v.ActivationState,
		"attribution":           &v.Attribution,
		"isolated_child_origin": &v.IsolatedChildOrigin,
	}
	if len(raw) != len(fields) {
		return fmt.Errorf("invalid signed map status fields")
	}
	for name, into := range fields {
		value, ok := raw[name]
		if !ok || len(value) == 0 || bytes.Equal(bytes.TrimSpace(value), []byte("null")) ||
			json.Unmarshal(value, into) != nil {
			return fmt.Errorf("invalid signed map status")
		}
	}
	if !v.ValidForTransport() {
		return fmt.Errorf("signed map release unavailable")
	}
	return nil
}

func (c *Client) MediaBaiduJSAPI4Release(ctx context.Context) (MediaBaiduJSAPI4Release, error) {
	var out MediaBaiduJSAPI4Release
	if ctx == nil || ctx.Err() != nil {
		return out, fmt.Errorf("invalid signed map status context")
	}
	if err := c.json(ctx, http.MethodGet,
		"/api/v1/media/places/baidu-jsapi/status", nil, &out); err != nil {
		return MediaBaiduJSAPI4Release{}, err
	}
	if ctx.Err() != nil || !out.ValidForTransport() {
		return MediaBaiduJSAPI4Release{}, fmt.Errorf("signed map release unavailable")
	}
	return out, nil
}
