package main

import (
	"context"
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
func (c *agentController) CloudClipboardList(ctx context.Context, before uint64) (client.ClipboardPage, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.ClipboardPage{}, err
	}
	return cli.ClipboardList(ctx, before)
}
func (c *agentController) CloudClipboardCreate(ctx context.Context, value client.ClipboardWrite) (client.ClipboardItem, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.ClipboardItem{}, err
	}
	return cli.ClipboardCreate(ctx, value)
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
