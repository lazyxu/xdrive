package client

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"

	"github.com/google/uuid"
)

// These DTOs only contain ciphertext and immutable Owner vault metadata.
// Clipboard is never authorized by a Device, SourceRun or share bearer.
type ClipboardVault struct {
	OwnerID         uint64 `json:"owner_id"`
	Salt            string `json:"salt"`
	KDF             string `json:"kdf"`
	Iterations      int    `json:"iterations"`
	CheckNonce      string `json:"check_nonce"`
	CheckCiphertext string `json:"check_ciphertext"`
	AADScope        string `json:"aad_scope"`
}

type ClipboardCheck struct {
	Nonce      string `json:"nonce"`
	Ciphertext string `json:"ciphertext"`
	Scope      string `json:"scope"`
}

type ClipboardWrite struct {
	ClientEventID  string `json:"client_event_id"`
	Kind           string `json:"kind"`
	Nonce          string `json:"nonce"`
	Ciphertext     string `json:"ciphertext"`
	TargetDeviceID string `json:"target_device_id,omitempty"`
	EphemeralKey   string `json:"ephemeral_key,omitempty"`
	WrappedKey     string `json:"wrapped_key,omitempty"`
	NodeID         uint64 `json:"node_id,omitempty"`
}

type ClipboardItem struct {
	ID             uint64 `json:"id"`
	ClientEventID  string `json:"client_event_id"`
	Kind           string `json:"kind"`
	Nonce          string `json:"nonce"`
	Ciphertext     string `json:"ciphertext"`
	TargetDeviceID string `json:"target_device_id,omitempty"`
	EphemeralKey   string `json:"ephemeral_key,omitempty"`
	WrappedKey     string `json:"wrapped_key,omitempty"`
	NodeID         uint64 `json:"node_id,omitempty"`
	CreatedAt      string `json:"created_at"`
	ExpiresAt      string `json:"expires_at"`
}

// Public recipient keys only. No installation credential or private key
// is transported through this Owner-controlled sender capability.
type ClipboardDevice struct {
	DeviceID  string `json:"device_id"`
	Name      string `json:"name"`
	Platform  string `json:"platform"`
	PublicKey string `json:"public_key"`
}

type ClipboardDevices struct {
	Devices []ClipboardDevice `json:"devices"`
}

type ClipboardPage struct {
	Items      []ClipboardItem `json:"items"`
	NextBefore *uint64         `json:"next_before"`
}

func clipboardDecodeExact(raw string, expected int) bool {
	data, err := base64.StdEncoding.Strict().DecodeString(raw)
	return err == nil && len(data) == expected &&
		base64.StdEncoding.EncodeToString(data) == raw
}

func validClipboardWrite(value ClipboardWrite) bool {
	if uuid.Validate(value.ClientEventID) != nil ||
		!clipboardDecodeExact(value.Nonce, 12) ||
		len(value.Ciphertext) > base64.StdEncoding.EncodedLen(65536+16) {
		return false
	}
	cipher, err := base64.StdEncoding.Strict().DecodeString(value.Ciphertext)
	if err != nil || len(cipher) < 17 || len(cipher) > 65536+16 ||
		base64.StdEncoding.EncodeToString(cipher) != value.Ciphertext {
		return false
	}
	switch value.Kind {
	case "text/plain", "text/uri-list":
		if value.NodeID != 0 {
			return false
		}
	case "image/x-xdrive-node-ref", "application/x-xdrive-node-ref":
		if value.NodeID == 0 || value.TargetDeviceID == "" {
			return false
		}
	default:
		return false
	}
	if value.TargetDeviceID == "" {
		return value.EphemeralKey == "" && value.WrappedKey == ""
	}
	target, err := uuid.Parse(value.TargetDeviceID)
	return err == nil && target.String() == value.TargetDeviceID &&
		clipboardDecodeExact(value.EphemeralKey, 32) &&
		clipboardDecodeExact(value.WrappedKey, 60)
}
func validClipboardVault(v ClipboardVault) bool {
	return v.OwnerID > 0 && v.KDF == "PBKDF2-SHA256" && v.Iterations == 310000 &&
		len(v.Salt) == 24 && (v.CheckCiphertext == "" || v.CheckNonce != "")
}
func validClipboardItem(v ClipboardItem) bool {
	return v.ID > 0 && validClipboardWrite(ClipboardWrite{
		ClientEventID: v.ClientEventID, Kind: v.Kind, Nonce: v.Nonce, Ciphertext: v.Ciphertext,
		TargetDeviceID: v.TargetDeviceID, EphemeralKey: v.EphemeralKey,
		WrappedKey: v.WrappedKey, NodeID: v.NodeID,
	}) && v.CreatedAt != "" && v.ExpiresAt != ""
}

// ClipboardDevices returns a bounded public-key directory to the verified
// Owner sender. This is NOT an API for device enrollment or receiving.
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
			!clipboardDecodeExact(device.PublicKey, 32) {
			return ClipboardDevices{}, errors.New("invalid Owner Clipboard recipient keys")
		}
		seen[device.DeviceID] = true
	}
	return out, nil
}

func (c *Client) ClipboardVault(ctx context.Context) (ClipboardVault, error) {
	var out ClipboardVault
	if err := c.json(ctx, http.MethodGet, "/api/v1/clipboard/vault", nil, &out); err != nil {
		return out, err
	}
	if !validClipboardVault(out) {
		return ClipboardVault{}, errors.New("invalid Owner clipboard vault")
	}
	return out, nil
}
func (c *Client) ClipboardCheck(ctx context.Context, check ClipboardCheck) (ClipboardVault, error) {
	if check.Scope == "" || len(check.Scope) > 512 || len(check.Nonce) != 16 || len(check.Ciphertext) > 256 {
		return ClipboardVault{}, errors.New("invalid Owner clipboard check")
	}
	var out ClipboardVault
	if err := c.json(ctx, http.MethodPut, "/api/v1/clipboard/vault/check", check, &out); err != nil {
		return out, err
	}
	if !validClipboardVault(out) {
		return ClipboardVault{}, errors.New("invalid Owner clipboard check response")
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
		return ClipboardItem{}, errors.New("invalid encrypted clipboard item")
	}
	var out ClipboardItem
	if err := c.json(ctx, http.MethodPost, "/api/v1/clipboard/items", write, &out); err != nil {
		return out, err
	}
	if !validClipboardItem(out) || out.ClientEventID != write.ClientEventID ||
		out.Kind != write.Kind || out.Nonce != write.Nonce || out.Ciphertext != write.Ciphertext ||
		out.TargetDeviceID != write.TargetDeviceID || out.EphemeralKey != write.EphemeralKey ||
		out.WrappedKey != write.WrappedKey || out.NodeID != write.NodeID {
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
func (c *Client) ClipboardEnrollSelf(ctx context.Context, deviceID, token, publicKey string) error {
	id, err := uuid.Parse(deviceID)
	if err != nil || id.String() != deviceID || token == "" ||
		!clipboardDecodeExact(publicKey, 32) {
		return errors.New("invalid Clipboard enrollment identity")
	}
	payload, err := json.Marshal(map[string]string{"public_key": publicKey})
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
		PublicKey string `json:"public_key"`
	}
	if err := decodeResponse(resp, &reply); err != nil {
		return err
	}
	if reply.DeviceID != deviceID || reply.PublicKey != publicKey {
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
