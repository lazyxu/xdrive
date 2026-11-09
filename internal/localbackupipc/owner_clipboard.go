package localbackupipc

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/lazyxu/xdrive/internal/client"
)

// DSM's six fixed Owner-only Clipboard calls are available only on an
// authenticated, matching loopback Agent. No general-purpose proxy.
func (c *Client) OwnerClipboardAvailable() bool {
	return c != nil && hasCapability(c.capabilities, "cloud-clipboard")
}
func (c *Client) requireClipboard() error {
	if !c.OwnerClipboardAvailable() {
		return errors.New("Owner Clipboard capability unavailable")
	}
	return nil
}
func (c *Client) OwnerClipboardVault(ctx context.Context) (client.ClipboardVault, error) {
	if err := c.requireClipboard(); err != nil {
		return client.ClipboardVault{}, err
	}
	var out client.ClipboardVault
	err := c.request(ctx, http.MethodGet, "/v1/cloud/clipboard/vault", nil, &out)
	if err != nil || out.OwnerID == 0 || out.KDF != "PBKDF2-SHA256" || out.Iterations != 310000 {
		return client.ClipboardVault{}, fmt.Errorf("unverified Owner Clipboard vault: %w", errOrInvalid(err))
	}
	return out, nil
}
func errOrInvalid(err error) error {
	if err != nil {
		return err
	}
	return errors.New("invalid Owner Clipboard response")
}
func (c *Client) OwnerClipboardCheck(ctx context.Context, in client.ClipboardCheck) (client.ClipboardVault, error) {
	if err := c.requireClipboard(); err != nil {
		return client.ClipboardVault{}, err
	}
	if in.Scope == "" || len(in.Scope) > 512 || len(in.Nonce) != 16 || len(in.Ciphertext) > 256 {
		return client.ClipboardVault{}, errors.New("invalid Clipboard check")
	}
	var out client.ClipboardVault
	err := c.request(ctx, http.MethodPut, "/v1/cloud/clipboard/check", in, &out)
	if err != nil {
		return out, err
	}
	if out.OwnerID == 0 || out.AADScope == "" {
		return client.ClipboardVault{}, errors.New("invalid Clipboard check receipt")
	}
	return out, nil
}
func (c *Client) OwnerClipboardDevices(ctx context.Context) (client.ClipboardDevices, error) {
	if err := c.requireClipboard(); err != nil {
		return client.ClipboardDevices{}, err
	}
	var out client.ClipboardDevices
	if err := c.request(ctx, http.MethodGet, "/v1/cloud/clipboard/devices", nil, &out); err != nil {
		return out, err
	}
	if len(out.Devices) > 100 {
		return client.ClipboardDevices{}, errors.New("unbounded Clipboard recipients")
	}
	return out, nil
}

func (c *Client) OwnerClipboardList(ctx context.Context, before uint64) (client.ClipboardPage, error) {
	if err := c.requireClipboard(); err != nil {
		return client.ClipboardPage{}, err
	}
	path := "/v1/cloud/clipboard/items"
	if before > 0 {
		path += "?before=" + strconv.FormatUint(before, 10)
	}
	var out client.ClipboardPage
	if err := c.request(ctx, http.MethodGet, path, nil, &out); err != nil {
		return out, err
	}
	if len(out.Items) > 50 {
		return client.ClipboardPage{}, errors.New("unbounded Owner Clipboard reply")
	}
	return out, nil
}
func (c *Client) OwnerClipboardCreate(ctx context.Context, in client.ClipboardWrite) (client.ClipboardItem, error) {
	if err := c.requireClipboard(); err != nil {
		return client.ClipboardItem{}, err
	}
	var out client.ClipboardItem
	err := c.request(ctx, http.MethodPost, "/v1/cloud/clipboard/items", in, &out)
	if err != nil {
		return out, err
	}
	if out.ID == 0 || out.ClientEventID != in.ClientEventID || out.Ciphertext != in.Ciphertext ||
		out.Kind != in.Kind || out.Nonce != in.Nonce || out.TargetDeviceID != in.TargetDeviceID ||
		out.EphemeralKey != in.EphemeralKey || out.WrappedKey != in.WrappedKey ||
		out.NodeID != in.NodeID {
		return client.ClipboardItem{}, errors.New("Clipboard write receipt mismatch")
	}
	return out, nil
}
func (c *Client) OwnerClipboardDelete(ctx context.Context, id uint64) error {
	if err := c.requireClipboard(); err != nil {
		return err
	}
	if id == 0 {
		return errors.New("invalid Clipboard ID")
	}
	return c.request(ctx, http.MethodDelete, "/v1/cloud/clipboard/items/"+strconv.FormatUint(id, 10), nil, nil)
}
func (c *Client) OwnerClipboardClear(ctx context.Context) error {
	if err := c.requireClipboard(); err != nil {
		return err
	}
	return c.request(ctx, http.MethodDelete, "/v1/cloud/clipboard/items", nil, nil)
}

// These are narrow, separate Owner+installation capabilities. The DSM
// browser never receives an Agent device credential or a private key.
func (c *Client) OwnerClipboardEnableDevice(ctx context.Context) (client.ClipboardDevice, error) {
	if err := c.requireClipboard(); err != nil {
		return client.ClipboardDevice{}, err
	}
	var out client.ClipboardDevice
	if err := c.request(ctx, http.MethodPost, "/v1/cloud/clipboard/enable-device",
		map[string]any{}, &out); err != nil {
		return client.ClipboardDevice{}, err
	}
	if out.DeviceID == "" || out.PublicKey == "" || out.Name == "" {
		return client.ClipboardDevice{}, errors.New("unconfirmed Clipboard device enrollment")
	}
	return out, nil
}

func (c *Client) OwnerClipboardDecrypt(ctx context.Context, itemID uint64) (string, error) {
	if err := c.requireClipboard(); err != nil {
		return "", err
	}
	if itemID == 0 {
		return "", errors.New("invalid Clipboard item")
	}
	var out struct {
		Text string `json:"text"`
	}
	if err := c.request(ctx, http.MethodPost, "/v1/cloud/clipboard/decrypt",
		map[string]uint64{"id": itemID}, &out); err != nil {
		return "", err
	}
	if len(out.Text) == 0 || len(out.Text) > 65536 || !utf8.ValidString(out.Text) {
		return "", errors.New("invalid Clipboard decryption receipt")
	}
	return out.Text, nil
}

func (c *Client) OwnerClipboardRevokeDevice(ctx context.Context, deviceID string) error {
	if err := c.requireClipboard(); err != nil {
		return err
	}
	id, err := uuid.Parse(deviceID)
	if err != nil || id.String() != deviceID {
		return errors.New("invalid Owner Clipboard recipient")
	}
	return c.request(ctx, http.MethodPost, "/v1/cloud/clipboard/revoke-device",
		map[string]string{"device_id": deviceID}, nil)
}
