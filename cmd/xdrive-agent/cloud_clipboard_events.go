package main

import (
	"context"
	"errors"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// CloudClipboardWaitForChange relays only Server-originated change cursors.
// The live Owner session and any separately enrolled device proof are checked
// on both sides; an old/revoked installation cannot receive directed events.
func (c *agentController) CloudClipboardWaitForChange(
	ctx context.Context, after uint64,
) (client.ClipboardChangeEvent, error) {
	if after > 1<<53-1 {
		return client.ClipboardChangeEvent{}, errors.New("invalid event cursor")
	}
	cli, cfg, err := c.cloudClient()
	if err != nil {
		return client.ClipboardChangeEvent{}, err
	}
	if !clipboardCurrentAgentSession(cfg) {
		return client.ClipboardChangeEvent{}, errors.New("Clipboard Owner session changed")
	}
	dir, err := userconfig.Dir()
	if err != nil {
		return client.ClipboardChangeEvent{}, err
	}
	registered, err := localpush.LoadDeviceRegistration(dir, cfg.Server, cfg.Username)
	var deviceID, token string
	if err == nil {
		active, lookupErr := clipboardDeviceActive(ctx, cli, registered)
		if lookupErr != nil {
			return client.ClipboardChangeEvent{}, lookupErr
		}
		if active {
			_, _, _, verifiedID, verifiedToken, proofErr := c.clipboardOwnerDevice(ctx)
			if proofErr != nil || verifiedID != registered {
				return client.ClipboardChangeEvent{}, errors.New("Clipboard recipient proof unavailable")
			}
			deviceID, token = verifiedID, verifiedToken
		}
	} else if !errors.Is(err, localpush.ErrDeviceNotRegistered) {
		return client.ClipboardChangeEvent{}, err
	}
	event, err := cli.ClipboardWaitForChange(ctx, after, deviceID, token)
	if err != nil || !clipboardCurrentAgentSession(cfg) {
		return client.ClipboardChangeEvent{}, errors.New("Clipboard Owner/event authorization changed")
	}
	return event, nil
}
