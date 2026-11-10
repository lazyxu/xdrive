package main

import (
	"context"
	"errors"
	"sync"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localbackupipc"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// Device enrollment requires the current Owner and verified installation.
var clipboardDeviceEnrollmentMu sync.Mutex

func clipboardCurrentAgentSession(cfg userconfig.Config) bool {
	current, err := userconfig.Load()
	return err == nil && !current.SessionInvalid &&
		current.SessionID != "" && current.SessionID == cfg.SessionID &&
		current.Server == cfg.Server && current.Username == cfg.Username
}

func (c *agentController) clipboardOwnerDevice(ctx context.Context) (
	*client.Client, userconfig.Config, string, string, string, error,
) {
	cli, cfg, err := c.cloudClient()
	if err != nil {
		return nil, cfg, "", "", "", err
	}
	if cfg.SessionInvalid || cfg.Server == "" || cfg.Username == "" ||
		cfg.SessionID == "" || !clipboardCurrentAgentSession(cfg) {
		return nil, cfg, "", "", "", errors.New("Clipboard Owner login unavailable")
	}
	configDir, err := userconfig.Dir()
	if err != nil {
		return nil, cfg, "", "", "", err
	}
	// Existing device registration is required. Opening Clipboard must
	// never silently register a new Push, SourceRun or native device.
	deviceID, err := localpush.LoadDeviceRegistration(configDir, cfg.Server, cfg.Username)
	if err != nil {
		return nil, cfg, "", "", "", err
	}
	token, err := localpush.LoadDeviceToken(configDir, cfg.Server, cfg.Username, deviceID)
	if err != nil {
		return nil, cfg, "", "", "", err
	}
	verified, err := cli.VerifyLocalDevice(ctx, deviceID, token)
	if err != nil || verified.DeviceID != deviceID || !clipboardCurrentAgentSession(cfg) {
		return nil, cfg, "", "", "", errors.New("Clipboard Owner/device authorization changed")
	}
	return cli, cfg, configDir, deviceID, token, nil
}

func (c *agentController) CloudClipboardEnableDevice(ctx context.Context) (client.ClipboardDevice, error) {
	clipboardDeviceEnrollmentMu.Lock()
	defer clipboardDeviceEnrollmentMu.Unlock()
	cli, cfg, _, deviceID, token, err := c.clipboardOwnerDevice(ctx)
	if err != nil {
		return client.ClipboardDevice{}, err
	}
	if !clipboardCurrentAgentSession(cfg) {
		return client.ClipboardDevice{}, errors.New("Owner changed before enrollment")
	}
	if err = cli.ClipboardEnrollSelf(ctx, deviceID, token); err != nil {
		return client.ClipboardDevice{}, err
	}
	if !clipboardCurrentAgentSession(cfg) {
		return client.ClipboardDevice{}, errors.New("Owner changed after enrollment")
	}
	return client.ClipboardDevice{DeviceID: deviceID, Name: "This installation", Platform: "desktop"}, nil
}

func clipboardDeviceActive(ctx context.Context, cli *client.Client, deviceID string) (bool, error) {
	dir, err := cli.ClipboardDevices(ctx)
	if err != nil {
		return false, err
	}
	for _, d := range dir.Devices {
		if d.DeviceID == deviceID {
			return true, nil
		}
	}
	return false, nil
}

func (c *agentController) clipboardListWithLocalRecipient(
	ctx context.Context, cli *client.Client, cfg userconfig.Config, before uint64,
) (client.ClipboardPage, error) {
	configDir, err := userconfig.Dir()
	if err != nil {
		return client.ClipboardPage{}, err
	}
	deviceID, err := localpush.LoadDeviceRegistration(configDir, cfg.Server, cfg.Username)
	if errors.Is(err, localpush.ErrDeviceNotRegistered) {
		return cli.ClipboardList(ctx, before)
	}
	if err != nil {
		return client.ClipboardPage{}, err
	}
	active, err := clipboardDeviceActive(ctx, cli, deviceID)
	if err != nil {
		return client.ClipboardPage{}, err
	}
	if !active {
		return cli.ClipboardList(ctx, before)
	}
	_, _, _, verifiedID, token, err := c.clipboardOwnerDevice(ctx)
	if err != nil || verifiedID != deviceID {
		return client.ClipboardPage{}, errors.New("Clipboard installation proof unavailable")
	}
	page, err := cli.ClipboardListForDevice(ctx, before, deviceID, token)
	if err != nil || !clipboardCurrentAgentSession(cfg) {
		return client.ClipboardPage{}, errors.New("Clipboard Owner/device changed")
	}
	return page, nil
}

// CloudClipboardFileReference is a strictly bounded bridge to the CURRENT
// Owner's ordinary Files read APIs. The Clipboard Node ID is only a locator;
// Files ACL, live revision and location are independently rechecked by Server.
func (c *agentController) CloudClipboardFileReference(
	ctx context.Context, nodeID uint64,
) (localbackupipc.OwnerClipboardFileReference, error) {
	empty := localbackupipc.OwnerClipboardFileReference{}
	if !localbackupipc.ValidOwnerFileID(nodeID) {
		return empty, errors.New("invalid Clipboard reference Node")
	}
	cli, cfg, err := c.cloudClient()
	if err != nil || !clipboardCurrentAgentSession(cfg) {
		return empty, errors.New("Clipboard Files Owner session unavailable")
	}
	node, err := cli.Node(ctx, nodeID)
	if err != nil || node.ID != nodeID || node.Type != "file" ||
		node.DeletedAt != nil || node.ParentID == nil {
		return empty, errors.New("current Owner file not readable")
	}
	loc, err := cli.NodeLocation(ctx, nodeID)
	if err != nil || loc.NodeID != nodeID || loc.NodeType != "file" ||
		loc.ParentID == nil || *loc.ParentID != *node.ParentID ||
		loc.Revision != node.Revision {
		return empty, errors.New("current Owner file location changed")
	}
	crumbs := make([]localbackupipc.OwnerSearchCrumb, 0, len(loc.Breadcrumbs))
	for _, part := range loc.Breadcrumbs {
		crumbs = append(crumbs, localbackupipc.OwnerSearchCrumb{ID: part.ID, Name: part.Name})
	}
	ref := localbackupipc.OwnerClipboardFileReference{
		Node: localbackupipc.OwnerFileNode{
			ID: node.ID, ParentID: node.ParentID, Name: node.Name, Type: node.Type,
			Size: node.Size, Revision: node.Revision, CreatedAt: node.CreatedAt,
			UpdatedAt: node.UpdatedAt,
		},
		Crumbs: crumbs,
	}
	if !localbackupipc.ValidateOwnerClipboardFileReference(ref, nodeID) ||
		!clipboardCurrentAgentSession(cfg) {
		return empty, errors.New("current Owner file reference no longer valid")
	}
	return ref, nil
}
