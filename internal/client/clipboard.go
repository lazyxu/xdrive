package client

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"unicode/utf8"
	"fmt"

	"github.com/google/uuid"
)

// Clipboard is a plaintext, Owner-scoped short-lived mailbox.
type ClipboardWrite struct {
	ClientEventID string `json:"client_event_id"`
	Kind string `json:"kind"`
	Content string `json:"content"`
	TargetDeviceID string `json:"target_device_id,omitempty"`
	NodeID uint64 `json:"node_id,omitempty"`
}
type ClipboardItem struct {
	ID uint64 `json:"id"`
	ClientEventID string `json:"client_event_id"`
	Kind string `json:"kind"`
	Content string `json:"content"`
	TargetDeviceID string `json:"target_device_id,omitempty"`
	NodeID uint64 `json:"node_id,omitempty"`
	CreatedAt string `json:"created_at"`
	ExpiresAt string `json:"expires_at"`
}
type ClipboardDevice struct {
	DeviceID string `json:"device_id"`
	Name string `json:"name"`
	Platform string `json:"platform"`
}
type ClipboardDevices struct { Devices []ClipboardDevice `json:"devices"` }
type ClipboardPage struct {
	Items []ClipboardItem `json:"items"`
	NextBefore *uint64 `json:"next_before"`
}
func validClipboardWrite(v ClipboardWrite) bool {
	if uuid.Validate(v.ClientEventID) != nil || len(v.Content) < 1 ||
		len(v.Content) > 65536 || !utf8.ValidString(v.Content) { return false }
	switch v.Kind {
	case "text/plain", "text/uri-list":
		if v.NodeID != 0 { return false }
	case "image/x-xdrive-node-ref", "application/x-xdrive-node-ref":
		if v.NodeID == 0 || v.TargetDeviceID == "" ||
			v.Content != fmt.Sprintf("asset:%d", v.NodeID) { return false }
	default: return false
	}
	if v.TargetDeviceID != "" {
		id, err := uuid.Parse(v.TargetDeviceID)
		if err != nil || id.String() != v.TargetDeviceID { return false }
	}
	return true
}
func validClipboardItem(v ClipboardItem) bool {
	return v.ID > 0 && validClipboardWrite(ClipboardWrite{
		ClientEventID:v.ClientEventID, Kind:v.Kind, Content:v.Content,
		TargetDeviceID:v.TargetDeviceID, NodeID:v.NodeID,
	}) && v.CreatedAt != "" && v.ExpiresAt != ""
}

// ClipboardDevices returns active, enrolled recipient identities.
func (c *Client) ClipboardDevices(ctx context.Context) (ClipboardDevices, error) {
	var out ClipboardDevices
	if err := c.json(ctx, http.MethodGet, "/api/v1/clipboard/devices", nil, &out); err != nil {
		return out, err
	}
	if len(out.Devices) > 100 {
		return ClipboardDevices{}, errors.New("Clipboard device list exceeds limit")
	}
	seen := make(map[string]bool, len(out.Devices))
	for _, device := range out.Devices {
		id, err := uuid.Parse(device.DeviceID)
		if err != nil || id.String() != device.DeviceID || seen[device.DeviceID] ||
			len(device.Name) == 0 || len(device.Name) > 128 ||
			len(device.Platform) == 0 || len(device.Platform) > 32 ||
			device.DeviceID == "" {
			return ClipboardDevices{}, errors.New("invalid Owner Clipboard recipient keys")
		}
		seen[device.DeviceID] = true
	}
	return out, nil
}

func (c *Client) ClipboardList(ctx context.Context, before uint64) (ClipboardPage, error) {
	path := "/api/v1/clipboard/items"
	if before > 0 {
		path += "?before=" + strconv.FormatUint(before, 10)
	}
	var out ClipboardPage
	if err := c.json(ctx, http.MethodGet, path, nil, &out); err != nil {
		return out, err
	}
	if len(out.Items) > 50 {
		return ClipboardPage{}, errors.New("clipboard Owner page exceeds limit")
	}
	seen := make(map[uint64]bool, len(out.Items))
	for _, item := range out.Items {
		if !validClipboardItem(item) || seen[item.ID] {
			return ClipboardPage{}, errors.New("invalid Owner clipboard page")
		}
		seen[item.ID] = true
	}
	return out, nil
}
func (c *Client) ClipboardCreate(ctx context.Context, write ClipboardWrite) (ClipboardItem, error) {
	if !validClipboardWrite(write) {
		return ClipboardItem{}, errors.New("invalid clipboard item")
	}
	var out ClipboardItem
	if err := c.json(ctx, http.MethodPost, "/api/v1/clipboard/items", write, &out); err != nil {
		return out, err
	}
	if !validClipboardItem(out) || out.ClientEventID != write.ClientEventID ||
		out.Kind != write.Kind || out.Content != write.Content ||
		out.TargetDeviceID != write.TargetDeviceID || out.NodeID != write.NodeID {
		return ClipboardItem{}, errors.New("Owner clipboard receipt mismatch")
	}
	return out, nil
}
func (c *Client) ClipboardDelete(ctx context.Context, id uint64) error {
	if id == 0 {
		return errors.New("invalid clipboard item ID")
	}
	return c.json(ctx, http.MethodDelete, "/api/v1/clipboard/items/"+url.PathEscape(strconv.FormatUint(id, 10)), nil, nil)
}
func (c *Client) ClipboardClear(ctx context.Context) error {
	return c.json(ctx, http.MethodDelete, "/api/v1/clipboard/items", nil, nil)
}

// ClipboardEnrollSelf requires the CURRENT interactive Owner bearer plus
// this installation's independently verified device token. A generic Agent
// device identity never grants Clipboard rights without explicit enrollment.
func (c *Client) ClipboardEnrollSelf(ctx context.Context, deviceID, token string) error {
	id, err := uuid.Parse(deviceID)
	if err != nil || id.String() != deviceID || token == "" {
		return errors.New("invalid Clipboard enrollment identity")
	}
	payload, err := json.Marshal(map[string]string{})
	if err != nil {
		return err
	}
	req, err := c.request(ctx, http.MethodPut, "/api/v1/clipboard/devices/self", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-XDrive-Device-ID", deviceID)
	req.Header.Set("X-XDrive-Device-Token", token)
	resp, err := c.do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var reply struct {
		DeviceID  string `json:"device_id"`
	}
	if err := decodeResponse(resp, &reply); err != nil {
		return err
	}
	if reply.DeviceID != deviceID {
		return errors.New("Clipboard enrollment receipt mismatched")
	}
	return nil
}

// ClipboardListForDevice is NOT the ordinary Owner mailbox and may never
// fall back to broadcast if a registered installation token was revoked.
func (c *Client) ClipboardListForDevice(
	ctx context.Context, before uint64, deviceID, token string,
) (ClipboardPage, error) {
	id, err := uuid.Parse(deviceID)
	if err != nil || id.String() != deviceID || token == "" {
		return ClipboardPage{}, errors.New("invalid Clipboard installation proof")
	}
	path := "/api/v1/clipboard/items"
	if before > 0 {
		path += "?before=" + strconv.FormatUint(before, 10)
	}
	req, err := c.request(ctx, http.MethodGet, path, nil)
	if err != nil {
		return ClipboardPage{}, err
	}
	req.Header.Set("X-XDrive-Device-ID", deviceID)
	req.Header.Set("X-XDrive-Device-Token", token)
	resp, err := c.do(req)
	if err != nil {
		return ClipboardPage{}, err
	}
	defer resp.Body.Close()
	var page ClipboardPage
	if err := decodeResponse(resp, &page); err != nil {
		return ClipboardPage{}, err
	}
	if len(page.Items) > 50 {
		return ClipboardPage{}, errors.New("unbounded Clipboard device mailbox")
	}
	seen := make(map[uint64]bool, len(page.Items))
	for _, item := range page.Items {
		if !validClipboardItem(item) || seen[item.ID] ||
			(item.TargetDeviceID != "" && item.TargetDeviceID != deviceID) {
			return ClipboardPage{}, errors.New("invalid Clipboard device item/target")
		}
		seen[item.ID] = true
	}
	return page, nil
}

func (c *Client) ClipboardRevokeDevice(ctx context.Context, id string) error {
	parsed, err := uuid.Parse(id)
	if err != nil || parsed.String() != id {
		return errors.New("invalid Clipboard recipient")
	}
	return c.json(ctx, http.MethodPost, "/api/v1/clipboard/devices/"+url.PathEscape(id)+"/revoke", nil, nil)
}
