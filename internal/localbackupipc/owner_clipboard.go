package localbackupipc

import (
	"context"
	"errors"
	"net/http"
	"strconv"

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
	if out.ID == 0 || out.ClientEventID != in.ClientEventID || out.Content != in.Content ||
		out.Kind != in.Kind || out.TargetDeviceID != in.TargetDeviceID || out.NodeID != in.NodeID {
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
	if out.DeviceID == "" || out.Name == "" {
		return client.ClipboardDevice{}, errors.New("unconfirmed Clipboard device enrollment")
	}
	return out, nil
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

// OwnerClipboardWaitForChange waits for the existing Server-side SSE event
// through the authenticated owning Agent, returning only cursor metadata.
func (c *Client) OwnerClipboardWaitForChange(ctx context.Context, after uint64) (client.ClipboardChangeEvent, error) {
	if err := c.requireClipboard(); err != nil {
		return client.ClipboardChangeEvent{}, err
	}
	if after > 1<<53-1 {
		return client.ClipboardChangeEvent{}, errors.New("invalid Clipboard event cursor")
	}
	path := "/v1/cloud/clipboard/next-event?after=" + strconv.FormatUint(after, 10)
	var event client.ClipboardChangeEvent
	if err := c.request(ctx, http.MethodGet, path, nil, &event); err != nil {
		return client.ClipboardChangeEvent{}, err
	}
	if event.Cursor < after || event.Cursor > 1<<53-1 ||
		(event.Changed && event.Cursor <= after) ||
		(!event.Changed && event.Cursor != after) {
		return client.ClipboardChangeEvent{}, errors.New("invalid Owner Clipboard event reply")
	}
	return event, nil
}
