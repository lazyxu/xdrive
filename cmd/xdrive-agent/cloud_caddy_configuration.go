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

func (c *agentController) CloudStartAdminCaddyDeploy(ctx context.Context) (client.AdminCaddyDeployState, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.AdminCaddyDeployState{}, err
	}
	return cli.StartAdminCaddyDeploy(ctx)
}
func (c *agentController) CloudAdminCaddyDeployStatus(ctx context.Context, id string) (client.AdminCaddyDeployState, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.AdminCaddyDeployState{}, err
	}
	return cli.AdminCaddyDeployStatus(ctx, id)
}
