package main

import (
	"context"
	"errors"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// CloudVerifiedLocalDevice is only a display-identity proof. It neither
// enrolls a new device nor authorizes a Root or modifies a Push Source.
// The one-time device credential stays in the Agent OS credential store.
func (c *agentController) CloudVerifiedLocalDevice(ctx context.Context) (client.VerifiedLocalDevice, error) {
	cli, cfg, err := c.cloudClient()
	if err != nil {
		return client.VerifiedLocalDevice{}, err
	}
	if cfg.SessionInvalid || cfg.Server == "" || cfg.Username == "" || cfg.SessionID == "" {
		return client.VerifiedLocalDevice{}, errors.New("login required for local device verification")
	}
	configDir, err := userconfig.Dir()
	if err != nil {
		return client.VerifiedLocalDevice{}, err
	}
	deviceID, err := localpush.LoadDeviceRegistration(configDir, cfg.Server, cfg.Username)
	if errors.Is(err, localpush.ErrDeviceNotRegistered) {
		// A newly installed Desktop has no locally enrolled Push device yet.
		// Do not enroll one merely because a read-only page was opened.
		return client.VerifiedLocalDevice{}, nil
	}
	if err != nil {
		return client.VerifiedLocalDevice{}, err
	}
	secret, err := localpush.LoadDeviceToken(configDir, cfg.Server, cfg.Username, deviceID)
	if err != nil {
		return client.VerifiedLocalDevice{}, err
	}
	verified, err := cli.VerifyLocalDevice(ctx, deviceID, secret)
	if err != nil {
		return client.VerifiedLocalDevice{}, err
	}
	if verified.DeviceID != deviceID {
		return client.VerifiedLocalDevice{}, errors.New("verified device identity does not match local registration")
	}
	latest, err := userconfig.Load()
	if err != nil {
		return client.VerifiedLocalDevice{}, err
	}
	if latest.SessionID != cfg.SessionID || latest.Server != cfg.Server || latest.Username != cfg.Username {
		return client.VerifiedLocalDevice{}, errors.New("account changed during local device verification")
	}
	return verified, nil
}

// CloudLocalSourceDrafts exposes only this installation's unbound, first-time
// local Push drafts. Opening this view must never enroll a new device.
func (c *agentController) CloudLocalSourceDrafts(ctx context.Context, limit int, afterID uint64) (client.LocalSourceDraftPage, error) {
	if limit < 1 || limit > 100 {
		return client.LocalSourceDraftPage{}, errors.New("invalid local draft page size")
	}
	cli, cfg, err := c.cloudClient()
	if err != nil {
		return client.LocalSourceDraftPage{}, err
	}
	if cfg.SessionInvalid || cfg.Server == "" || cfg.Username == "" || cfg.SessionID == "" {
		return client.LocalSourceDraftPage{}, errors.New("login required for local draft recovery")
	}
	configDir, err := userconfig.Dir()
	if err != nil {
		return client.LocalSourceDraftPage{}, err
	}
	deviceID, err := localpush.LoadDeviceRegistration(configDir, cfg.Server, cfg.Username)
	if errors.Is(err, localpush.ErrDeviceNotRegistered) {
		return client.LocalSourceDraftPage{Items: make([]client.LocalSourceDraft, 0)}, nil
	}
	if err != nil {
		return client.LocalSourceDraftPage{}, err
	}
	secret, err := localpush.LoadDeviceToken(configDir, cfg.Server, cfg.Username, deviceID)
	if err != nil {
		return client.LocalSourceDraftPage{}, err
	}
	page, err := cli.LocalSourceDrafts(ctx, deviceID, secret, limit, afterID)
	if err != nil {
		return client.LocalSourceDraftPage{}, err
	}
	latest, err := userconfig.Load()
	if err != nil {
		return client.LocalSourceDraftPage{}, err
	}
	if latest.SessionID != cfg.SessionID || latest.Server != cfg.Server || latest.Username != cfg.Username {
		return client.LocalSourceDraftPage{}, errors.New("account changed during local draft listing")
	}
	return page, nil
}
