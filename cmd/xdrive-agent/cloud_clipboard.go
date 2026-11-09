package main

import (
	"context"
	"errors"

	"github.com/lazyxu/xdrive/internal/client"
)

// Only the existing, currently Owner-authenticated cloudClient may access
// clipboard endpoints. Never substitute a background Device/SourceRun token.
func (c *agentController) CloudClipboardVault(ctx context.Context) (client.ClipboardVault, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.ClipboardVault{}, err
	}
	return cli.ClipboardVault(ctx)
}
func (c *agentController) CloudClipboardCheck(ctx context.Context, value client.ClipboardCheck) (client.ClipboardVault, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.ClipboardVault{}, err
	}
	return cli.ClipboardCheck(ctx, value)
}
// Public Owner recipient keys only; no installation token or private key.
func (c *agentController) CloudClipboardDevices(ctx context.Context) (client.ClipboardDevices, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.ClipboardDevices{}, err
	}
	return cli.ClipboardDevices(ctx)
}

func (c *agentController) CloudClipboardList(ctx context.Context, before uint64) (client.ClipboardPage, error) {
	cli, cfg, err := c.cloudClient()
	if err != nil {
		return client.ClipboardPage{}, err
	}
	// Only installations with an explicitly enrolled, still active Clipboard
	// key read v2 targeted rows. Revocation never silently downgrades to v1.
	return c.clipboardListWithLocalRecipient(ctx, cli, cfg, before)
}
func (c *agentController) CloudClipboardCreate(ctx context.Context, value client.ClipboardWrite) (client.ClipboardItem, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.ClipboardItem{}, err
	}
	return cli.ClipboardCreate(ctx, value)
}
// Revoke remains an explicit interactive Owner mutation; a device token
// alone never carries authority to revoke another recipient.
func (c *agentController) CloudClipboardRevokeDevice(ctx context.Context, id string) error {
	cli, cfg, err := c.cloudClient()
	if err != nil {
		return err
	}
	if !clipboardCurrentAgentSession(cfg) {
		return errors.New("Clipboard Owner changed before revocation")
	}
	if err := cli.ClipboardRevokeDevice(ctx, id); err != nil {
		return err
	}
	if !clipboardCurrentAgentSession(cfg) {
		return errors.New("Clipboard Owner changed after a potentially committed revocation")
	}
	if err := clipboardRetireLocalRecipient(cfg, id); err != nil {
		return errors.New("Clipboard device revoked on Server, but local key cleanup is incomplete")
	}
	return nil
}
func (c *agentController) CloudClipboardDelete(ctx context.Context, id uint64) error {
	cli, _, err := c.cloudClient()
	if err != nil {
		return err
	}
	return cli.ClipboardDelete(ctx, id)
}
func (c *agentController) CloudClipboardClear(ctx context.Context) error {
	cli, _, err := c.cloudClient()
	if err != nil {
		return err
	}
	return cli.ClipboardClear(ctx)
}
