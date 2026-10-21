package main

import (
	"context"

	"github.com/lazyxu/xdrive/internal/client"
)

// The Agent forwards this admin-only, desired-only request to the Server.
// The Server owns authentication, dual-revision CAS, encryption and audit.
func (c *agentController) CloudSaveAdminCaddyConfiguration(ctx context.Context, input client.AdminCaddyConfigurationSaveInput) (client.AdminCaddyConfigurationSaveResult, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.AdminCaddyConfigurationSaveResult{}, err
	}
	return cli.SaveAdminCaddyConfiguration(ctx, input)
}
