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
	return NewManagedSession(baseURL, tokens, onTokens, nil)
}

func NewManagedSession(
	baseURL string,
	tokens SessionTokens,
	onTokens func(SessionTokens) error,
	loadTokens func() (SessionTokens, error),
) *Client {
	return &Client{
		BaseURL:          strings.TrimRight(baseURL, "/"),
		Token:            tokens.AccessToken,
		HTTP:             &http.Client{Timeout: 0},
		refreshToken:     tokens.RefreshToken,
		accessExpiresAt:  tokens.AccessExpiresAt,
		refreshExpiresAt: tokens.RefreshExpiresAt,
		onTokens:         onTokens,
		loadTokens:       loadTokens,
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

func (c *Client) setSessionTokensMemory(tokens SessionTokens) {
	c.sessionMu.Lock()
	c.Token = tokens.AccessToken
	c.refreshToken = tokens.RefreshToken
	c.accessExpiresAt = tokens.AccessExpiresAt
	c.refreshExpiresAt = tokens.RefreshExpiresAt
	c.sessionMu.Unlock()
}

func (c *Client) setSessionTokens(tokens SessionTokens) error {
	c.setSessionTokensMemory(tokens)
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
	if strings.TrimSpace(tokens.AccessToken) == "" {
		_, err := c.RefreshSession(ctx)
		return err
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
	if c.loadTokens != nil {
		if latest, err := c.loadTokens(); err == nil && strings.TrimSpace(latest.RefreshToken) != "" &&
			latest.RefreshToken != current.RefreshToken {
			c.setSessionTokensMemory(latest)
			current = latest
		}
	}

	for attempt := 0; attempt < 2; attempt++ {
		if strings.TrimSpace(current.RefreshToken) == "" {
			return SessionTokens{}, &APIError{Status: http.StatusUnauthorized, Msg: "refresh token is missing"}
		}
		if !current.RefreshExpiresAt.IsZero() && !time.Now().Before(current.RefreshExpiresAt) {
			return SessionTokens{}, &APIError{Status: http.StatusUnauthorized, Msg: "refresh token expired"}
		}
		if strings.TrimSpace(current.AccessToken) != "" && !current.AccessExpiresAt.IsZero() &&
			time.Until(current.AccessExpiresAt) > 2*time.Minute {
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
		var out AuthResponse
		decodeErr := decodeResponse(resp, &out)
		_ = resp.Body.Close()
		if decodeErr == nil {
			next := out.Session(time.Now())
			if next.AccessToken == "" || next.RefreshToken == "" {
				return SessionTokens{}, fmt.Errorf("refresh response did not contain both tokens")
			}
			if err := c.setSessionTokens(next); err != nil {
				return SessionTokens{}, err
			}
			return next, nil
		}

		// Another local process may have won refresh-token rotation after this
		// process loaded the credential but before its refresh request arrived.
		if attempt == 0 && c.loadTokens != nil {
			latest, loadErr := c.loadTokens()
			if loadErr == nil && strings.TrimSpace(latest.RefreshToken) != "" &&
				latest.RefreshToken != current.RefreshToken {
				c.setSessionTokensMemory(latest)
				current = latest
				continue
			}
		}
		return SessionTokens{}, decodeErr
	}
	return SessionTokens{}, &APIError{Status: http.StatusUnauthorized, Msg: "refresh token rotation failed"}
}

func (c *Client) ChangePassword(ctx context.Context, currentPassword, newPassword string) (AuthResponse, error) {
	var out AuthResponse
	body, _ := json.Marshal(map[string]string{
		"current_password": currentPassword,
		"new_password":     newPassword,
	})
	req, err := c.request(ctx, http.MethodPost, "/api/v1/me/change-password", bytes.NewReader(body))
	if err != nil {
		return out, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if err := decodeResponse(resp, &out); err != nil {
		return out, err
	}
	next := out.Session(time.Now())
	if next.AccessToken == "" || next.RefreshToken == "" {
		return out, fmt.Errorf("password change response did not contain both tokens")
	}
	if err := c.setSessionTokens(next); err != nil {
		return out, err
	}
	return out, nil
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
