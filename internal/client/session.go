package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type SessionTokens struct {
	AccessToken      string
	RefreshToken     string
	AccessExpiresAt  time.Time
	RefreshExpiresAt time.Time
}

func (a AuthResponse) Session(now time.Time) SessionTokens {
	access := strings.TrimSpace(a.AccessToken)
	if access == "" {
		access = strings.TrimSpace(a.Token)
	}
	s := SessionTokens{AccessToken: access, RefreshToken: strings.TrimSpace(a.RefreshToken)}
	if a.ExpiresIn > 0 {
		s.AccessExpiresAt = now.Add(time.Duration(a.ExpiresIn) * time.Second)
	}
	if a.RefreshExpiresIn > 0 {
		s.RefreshExpiresAt = now.Add(time.Duration(a.RefreshExpiresIn) * time.Second)
	}
	return s
}

func NewSession(baseURL string, tokens SessionTokens, onTokens func(SessionTokens) error) *Client {
	return &Client{
		BaseURL:          strings.TrimRight(baseURL, "/"),
		Token:            tokens.AccessToken,
		HTTP:             &http.Client{Timeout: 0},
		refreshToken:     tokens.RefreshToken,
		accessExpiresAt:  tokens.AccessExpiresAt,
		refreshExpiresAt: tokens.RefreshExpiresAt,
		onTokens:         onTokens,
	}
}

func (c *Client) accessToken() string {
	c.sessionMu.RLock()
	defer c.sessionMu.RUnlock()
	return c.Token
}

func (c *Client) sessionTokens() SessionTokens {
	c.sessionMu.RLock()
	defer c.sessionMu.RUnlock()
	return SessionTokens{
		AccessToken:      c.Token,
		RefreshToken:     c.refreshToken,
		AccessExpiresAt:  c.accessExpiresAt,
		RefreshExpiresAt: c.refreshExpiresAt,
	}
}

func (c *Client) setSessionTokens(tokens SessionTokens) error {
	c.sessionMu.Lock()
	c.Token = tokens.AccessToken
	c.refreshToken = tokens.RefreshToken
	c.accessExpiresAt = tokens.AccessExpiresAt
	c.refreshExpiresAt = tokens.RefreshExpiresAt
	c.sessionMu.Unlock()
	if c.onTokens != nil {
		return c.onTokens(tokens)
	}
	return nil
}

func (c *Client) ensureFresh(ctx context.Context) error {
	tokens := c.sessionTokens()
	if strings.TrimSpace(tokens.RefreshToken) == "" {
		return nil
	}
	if !tokens.RefreshExpiresAt.IsZero() && !time.Now().Before(tokens.RefreshExpiresAt) {
		return &APIError{Status: http.StatusUnauthorized, Msg: "refresh token expired"}
	}
	if tokens.AccessExpiresAt.IsZero() || time.Until(tokens.AccessExpiresAt) > 2*time.Minute {
		return nil
	}
	_, err := c.RefreshSession(ctx)
	return err
}

func (c *Client) RefreshSession(ctx context.Context) (SessionTokens, error) {
	c.refreshMu.Lock()
	defer c.refreshMu.Unlock()

	current := c.sessionTokens()
	if strings.TrimSpace(current.RefreshToken) == "" {
		return SessionTokens{}, &APIError{Status: http.StatusUnauthorized, Msg: "refresh token is missing"}
	}
	if !current.AccessExpiresAt.IsZero() && time.Until(current.AccessExpiresAt) > 2*time.Minute {
		return current, nil
	}

	body, _ := json.Marshal(map[string]string{"refresh_token": current.RefreshToken})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/api/v1/auth/refresh", bytes.NewReader(body))
	if err != nil {
		return SessionTokens{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "xdrive-xd/0.1")
	resp, err := c.do(req)
	if err != nil {
		return SessionTokens{}, err
	}
	defer resp.Body.Close()
	var out AuthResponse
	if err := decodeResponse(resp, &out); err != nil {
		return SessionTokens{}, err
	}
	next := out.Session(time.Now())
	if next.AccessToken == "" || next.RefreshToken == "" {
		return SessionTokens{}, fmt.Errorf("refresh response did not contain both tokens")
	}
	if err := c.setSessionTokens(next); err != nil {
		return SessionTokens{}, err
	}
	return next, nil
}

func (c *Client) LogoutSession(ctx context.Context) error {
	tokens := c.sessionTokens()
	if strings.TrimSpace(tokens.RefreshToken) == "" {
		return nil
	}
	body, _ := json.Marshal(map[string]string{"refresh_token": tokens.RefreshToken})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/api/v1/auth/logout", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "xdrive-xd/0.1")
	resp, err := c.do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent && resp.StatusCode/100 != 2 {
		return responseError(resp)
	}
	return nil
}
