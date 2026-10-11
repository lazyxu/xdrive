package main

import (
	"context"
	"errors"
	"runtime"
	"time"

	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

const agentDeviceBackupHeartbeatInterval = 60 * time.Second

// Agent presence is independent of any Desktop window and never invokes a
// local Source runner. A missing/revoked registration is not enrolled or
// repaired by an observer heartbeat.
func (c *agentController) runDeviceBackupHeartbeat() {
	if runtime.GOOS != "windows" && runtime.GOOS != "linux" {
		return
	}
	ticker := time.NewTicker(agentDeviceBackupHeartbeatInterval)
	defer ticker.Stop()
	for {
		ctx, cancel := context.WithTimeout(c.ctx, 12*time.Second)
		_ = c.sendDeviceBackupHeartbeat(ctx) // Failure only affects observed presence.
		cancel()
		select {
		case <-c.ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (c *agentController) sendDeviceBackupHeartbeat(ctx context.Context) error {
	cli, cfg, err := c.cloudClient()
	if err != nil {
		return err
	}
	if cfg.SessionInvalid || cfg.Server == "" || cfg.Username == "" || cfg.SessionID == "" {
		return nil
	}
	configDir, err := userconfig.Dir()
	if err != nil {
		return err
	}
	deviceID, err := localpush.LoadDeviceRegistration(configDir, cfg.Server, cfg.Username)
	if errors.Is(err, localpush.ErrDeviceNotRegistered) {
		return nil
	}
	if err != nil {
		return err
	}
	token, err := localpush.LoadDeviceToken(configDir, cfg.Server, cfg.Username, deviceID)
	if err != nil {
		return err
	}
	latest, err := userconfig.Load()
	if err != nil {
		return err
	}
	if latest.SessionInvalid || latest.SessionID != cfg.SessionID ||
		latest.Server != cfg.Server || latest.Username != cfg.Username {
		return errors.New("account changed before heartbeat")
	}
	return cli.SendDeviceHeartbeat(ctx, deviceID, token)
}
