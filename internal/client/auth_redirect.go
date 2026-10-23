package client

import (
	"errors"
	"net/http"
)

// ErrAuthRedirect is returned instead of forwarding a password or refresh
// token to any HTTP redirect target. It contains no destination URL.
var ErrAuthRedirect = errors.New("authentication redirect refused")

// doAuth preserves the existing trust store, proxy and transport, but stops
// redirects for credential-bearing login and refresh requests. HTTP 307/308
// redirects can otherwise replay POST bodies to another Origin.
func (c *Client) doAuth(req *http.Request) (*http.Response, error) {
	h := c.HTTP
	if h == nil {
		h = http.DefaultClient
	}
	restricted := *h
	restricted.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return ErrAuthRedirect
	}
	resp, err := restricted.Do(req)
	if errors.Is(err, ErrAuthRedirect) {
		// Go's url.Error may include the Location URL. Never propagate it.
		return nil, ErrAuthRedirect
	}
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= http.StatusMultipleChoices && resp.StatusCode < http.StatusBadRequest {
		// A 3xx lacking Location won't run CheckRedirect. It is still
		// not an authentication response and must fail closed.
		_ = resp.Body.Close()
		return nil, ErrAuthRedirect
	}
	return resp, nil
}
