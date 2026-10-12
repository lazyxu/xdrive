package main

import (
	"context"

	"github.com/lazyxu/xdrive/internal/client"
)

// Every call uses the authenticated Agent's current Server client.
// Server /admin/* remains the authority for role, self-mutation, and last-admin checks.
func (c *agentController) CloudAdminUsers(ctx context.Context) ([]client.AdminUser, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return nil, err
	}
	return cli.AdminUsers(ctx)
}

func (c *agentController) CloudAdminCreateUser(ctx context.Context, input client.AdminCreateUserInput) (client.AdminUser, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.AdminUser{}, err
	}
	return cli.AdminCreateUser(ctx, input)
}

func (c *agentController) CloudAdminUpdateUser(ctx context.Context, id uint64, input client.AdminUpdateUserInput) (client.AdminUser, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.AdminUser{}, err
	}
	return cli.AdminUpdateUser(ctx, id, input)
}

func (c *agentController) CloudAdminResetUserPassword(ctx context.Context, id uint64, password string, mustChange bool) error {
	cli, _, err := c.cloudClient()
	if err != nil {
		return err
	}
	return cli.AdminResetUserPassword(ctx, id, password, mustChange)
}

func (c *agentController) CloudAdminRevokeUserSessions(ctx context.Context, id uint64) error {
	cli, _, err := c.cloudClient()
	if err != nil {
		return err
	}
	return cli.AdminRevokeUserSessions(ctx, id)
}

func (c *agentController) CloudAdminDeleteUser(ctx context.Context, id uint64) error {
	cli, _, err := c.cloudClient()
	if err != nil {
		return err
	}
	return cli.AdminDeleteUser(ctx, id)
}
