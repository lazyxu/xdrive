package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

type ClientDevice struct {
	ID            string     `json:"id"`
	Name          string     `json:"name"`
	Platform      string     `json:"platform"`
	ClientVersion string     `json:"client_version,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	LastSeenAt    *time.Time `json:"last_seen_at,omitempty"`
	RevokedAt     *time.Time `json:"revoked_at,omitempty"`
}

type RegisteredClientDevice struct {
	Device      ClientDevice `json:"device"`
	DeviceToken string       `json:"device_token"`
}

type ClientDevicePage struct {
	Items   []ClientDevice `json:"items"`
	HasMore bool           `json:"has_more"`
}

type LocalSourceBinding struct {
	SourceID uint64 `json:"source_id"`
	DeviceID string `json:"device_id"`
	RootID   string `json:"root_id"`
	Status   string `json:"status"`
}

type BindLocalSourceInput struct {
	DeviceID        string `json:"device_id"`
	RootID          string `json:"root_id"`
	RootFingerprint string `json:"root_fingerprint"`
}

func (c *Client) RegisterClientDevice(ctx context.Context, name, platform, version string) (RegisteredClientDevice, error) {
	var out RegisteredClientDevice
	err := c.json(ctx, http.MethodPost, "/api/v1/devices", map[string]string{
		"name": name, "platform": platform, "client_version": version,
	}, &out)
	return out, err
}

func (c *Client) ClientDevices(ctx context.Context) (ClientDevicePage, error) {
	var out ClientDevicePage
	err := c.json(ctx, http.MethodGet, "/api/v1/devices", nil, &out)
	return out, err
}

func (c *Client) RevokeClientDevice(ctx context.Context, id string) error {
	return c.json(ctx, http.MethodPost, "/api/v1/devices/"+url.PathEscape(id)+"/revoke", nil, nil)
}

func (c *Client) LocalSourceBinding(ctx context.Context, sourceID uint64) (LocalSourceBinding, error) {
	var out LocalSourceBinding
	err := c.json(ctx, http.MethodGet, fmt.Sprintf("/api/v1/sources/%d/local-binding", sourceID), nil, &out)
	return out, err
}

// LocalSourceBindingWithToken is restricted to the Agent's OS-stored device
// secret. It is used to confirm the exact Root after a possibly committed
// binding request whose HTTP response was lost.
func (c *Client) LocalSourceBindingWithToken(ctx context.Context, sourceID uint64, token string) (LocalSourceBinding, error) {
	var out LocalSourceBinding
	req, err := c.request(ctx, http.MethodGet, fmt.Sprintf("/api/v1/sources/%d/local-binding", sourceID), nil)
	if err != nil {
		return out, err
	}
	req.Header.Set("X-XDrive-Device-Token", token)
	response, err := c.do(req)
	if err != nil {
		return out, err
	}
	defer response.Body.Close()
	if err := decodeResponse(response, &out); err != nil {
		return LocalSourceBinding{}, err
	}
	return out, nil
}

func (c *Client) UnbindLocalSource(ctx context.Context, sourceID, revision uint64) error {
	return c.jsonRevision(ctx, http.MethodDelete,
		fmt.Sprintf("/api/v1/sources/%d/local-binding", sourceID), revision, nil, nil)
}

func (c *Client) BindLocalSource(ctx context.Context, sourceID, revision uint64, token string, input BindLocalSourceInput) (LocalSourceBinding, error) {
	var out LocalSourceBinding
	payload, err := json.Marshal(input)
	if err != nil {
		return out, err
	}
	req, err := c.request(ctx, http.MethodPost,
		fmt.Sprintf("/api/v1/sources/%d/local-binding", sourceID), bytes.NewReader(payload))
	if err != nil {
		return out, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("If-Match", strconv.Quote(strconv.FormatUint(revision, 10)))
	req.Header.Set("X-XDrive-Device-Token", token)
	response, err := c.do(req)
	if err != nil {
		return out, err
	}
	defer response.Body.Close()
	if err := decodeResponse(response, &out); err != nil {
		return LocalSourceBinding{}, err
	}
	return out, nil
}

// LocalSourceDraft contains only fields necessary to resume an Agent-owned
// never-bound Source. It is not a generic Source or mutation contract.
type LocalSourceDraft struct {
	SourceID  uint64    `json:"source_id"`
	Name      string    `json:"name"`
	Revision  uint64    `json:"revision"`
	CreatedAt time.Time `json:"created_at"`
}

type LocalSourceDraftPage struct {
	Items       []LocalSourceDraft `json:"items"`
	HasMore     bool               `json:"has_more"`
	NextAfterID uint64             `json:"next_after_id"`
}

// LocalSourceDrafts only runs inside the owning Agent. Both the current
// account session and device's OS-protected enrollment secret are necessary.
func (c *Client) LocalSourceDrafts(ctx context.Context, deviceID, deviceToken string, limit int, afterID uint64) (LocalSourceDraftPage, error) {
	var out LocalSourceDraftPage
	query := url.Values{}
	query.Set("limit", strconv.Itoa(limit))
	query.Set("after_id", strconv.FormatUint(afterID, 10))
	req, err := c.request(ctx, http.MethodGet, "/api/v1/device-backups/local-drafts?"+query.Encode(), nil)
	if err != nil {
		return out, err
	}
	req.Header.Set("X-XDrive-Device-ID", deviceID)
	req.Header.Set("X-XDrive-Device-Token", deviceToken)
	resp, err := c.do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if err := decodeResponse(resp, &out); err != nil {
		return LocalSourceDraftPage{}, err
	}
	return out, nil
}

type VerifiedLocalDevice struct {
	DeviceID string `json:"device_id"`
}

// VerifyLocalDevice proves possession of this installation's registered device
// credential to the current user's Server. This is display identity only;
// it never authorizes a local Root or any Source mutation.
func (c *Client) VerifyLocalDevice(ctx context.Context, deviceID, deviceToken string) (VerifiedLocalDevice, error) {
	var out VerifiedLocalDevice
	req, err := c.request(ctx, http.MethodGet, "/api/v1/devices/self", nil)
	if err != nil {
		return out, err
	}
	req.Header.Set("X-XDrive-Device-ID", deviceID)
	req.Header.Set("X-XDrive-Device-Token", deviceToken)
	response, err := c.do(req)
	if err != nil {
		return out, err
	}
	defer response.Body.Close()
	if err := decodeResponse(response, &out); err != nil {
		return VerifiedLocalDevice{}, err
	}
	return out, nil
}
