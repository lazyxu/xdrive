package client

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
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
	return NewManagedSessionWithRefreshLock(baseURL, tokens, onTokens, loadTokens, nil)
}

func NewManagedSessionWithRefreshLock(
	baseURL string,
	tokens SessionTokens,
	onTokens func(SessionTokens) error,
	loadTokens func() (SessionTokens, error),
	refreshLock *sync.Mutex,
) *Client {
	return &Client{
		BaseURL:          strings.TrimRight(baseURL, "/"),
		Token:            tokens.AccessToken,
		HTTP:             &http.Client{Timeout: 0},
		sharedRefreshMu:  refreshLock,
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
		// The in-memory refresh token may be stale because another xDrive
		// process already rotated it and persisted a replacement. Route
		// through RefreshSession so it can reload shared credentials before
		// declaring the session expired.
		_, err := c.RefreshSession(ctx)
		return err
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
	refreshMu := &c.refreshMu
	if c.sharedRefreshMu != nil {
		refreshMu = c.sharedRefreshMu
	}
	refreshMu.Lock()
	defer refreshMu.Unlock()

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
		// First re-read immediately (the common case). If the server rejected a
		// now-revoked refresh token, briefly wait for the winning process to
		// persist its replacement before surfacing a false login-expired error.
		if attempt == 0 && c.loadTokens != nil {
			latest, loadErr := c.loadTokens()
			if loadErr == nil && rotatedRefreshToken(current.RefreshToken, latest.RefreshToken) {
				c.setSessionTokensMemory(latest)
				current = latest
				continue
			}
			if isUnauthorizedRefreshError(decodeErr) {
				if latest, ok := c.waitForRotatedSession(ctx, current.RefreshToken); ok {
					c.setSessionTokensMemory(latest)
					current = latest
					continue
				}
			}
		}
		return SessionTokens{}, decodeErr
	}
	return SessionTokens{}, &APIError{Status: http.StatusUnauthorized, Msg: "refresh token rotation failed"}
}

func rotatedRefreshToken(stale, latest string) bool {
	latest = strings.TrimSpace(latest)
	return latest != "" && latest != strings.TrimSpace(stale)
}

func isUnauthorizedRefreshError(err error) bool {
	var apiErr *APIError
	return errors.As(err, &apiErr) && apiErr.Status == http.StatusUnauthorized
}

func (c *Client) waitForRotatedSession(ctx context.Context, staleRefresh string) (SessionTokens, bool) {
	if c.loadTokens == nil {
		return SessionTokens{}, false
	}

	const attempts = 5
	delay := 50 * time.Millisecond
	for attempt := 0; attempt < attempts; attempt++ {
		latest, err := c.loadTokens()
		if err == nil && rotatedRefreshToken(staleRefresh, latest.RefreshToken) {
			return latest, true
		}
		if attempt == attempts-1 {
			break
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return SessionTokens{}, false
		case <-timer.C:
		}
		delay *= 2
	}
	return SessionTokens{}, false
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
