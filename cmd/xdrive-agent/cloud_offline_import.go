package main

import (
	"context"

	"github.com/lazyxu/xdrive/internal/client"
)

// The Agent never runs a Host updater. It forwards exact admin transport
// envelopes using the currently authenticated Server session, whose
// requireAdmin middleware remains authoritative.
func (c *agentController) CloudOfflineImports(ctx context.Context) (client.OfflineImportList, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.OfflineImportList{}, err
	}
	return cli.AdminOfflineImports(ctx)
}
func (c *agentController) CloudOfflineImportCreate(ctx context.Context) (client.OfflineImportCreated, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.OfflineImportCreated{}, err
	}
	return cli.AdminOfflineImportCreate(ctx)
}
func (c *agentController) CloudOfflineImportGet(ctx context.Context, id string) (client.OfflineImportStatus, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.OfflineImportStatus{}, err
	}
	return cli.AdminOfflineImportGet(ctx, id)
}
func (c *agentController) CloudOfflineImportRegister(ctx context.Context, id, name string, size int64, sha string) error {
	cli, _, err := c.cloudClient()
	if err != nil {
		return err
	}
	return cli.AdminOfflineImportRegister(ctx, id, name, size, sha)
}
func (c *agentController) CloudOfflineImportChunk(ctx context.Context, id, name string, index int, chunk []byte, sha string) error {
	cli, _, err := c.cloudClient()
	if err != nil {
		return err
	}
	return cli.AdminOfflineImportChunk(ctx, id, name, index, chunk, sha)
}
func (c *agentController) CloudOfflineImportFinalize(ctx context.Context, id, name string) (client.OfflineImportFinalizeReceipt, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.OfflineImportFinalizeReceipt{}, err
	}
	return cli.AdminOfflineImportFinalize(ctx, id, name)
}
func (c *agentController) CloudOfflineImportDelete(ctx context.Context, id string) error {
	cli, _, err := c.cloudClient()
	if err != nil {
		return err
	}
	return cli.AdminOfflineImportDelete(ctx, id)
}
func (c *agentController) CloudOfflineImportStart(ctx context.Context, id, manifestSHA, goSHA string, backup bool, trustMode string) (client.ServerUpdateState, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.ServerUpdateState{}, err
	}
	return cli.AdminOfflineImportStart(ctx, id, manifestSHA, goSHA, backup, trustMode)
}
