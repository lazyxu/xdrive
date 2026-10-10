package main

import (
	"context"
	"errors"
	"strings"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// The Agent alone resolves the OS secret and locally verified Root grant.
func (c *agentController) localBoundBackupConfig(ctx context.Context, sourceID uint64) (client.Source, client.LocalBoundSourceProof, *client.Client, error) {
	var empty client.Source
	var noProof client.LocalBoundSourceProof
	if sourceID == 0 {
		return empty, noProof, nil, errors.New("invalid local backup Source")
	}
	cli, cfg, err := c.cloudClient()
	if err != nil {
		return empty, noProof, nil, err
	}
	if cfg.SessionInvalid || cfg.Server == "" || cfg.Username == "" || cfg.SessionID == "" {
		return empty, noProof, nil, errors.New("login required for local backup settings")
	}
	configDir, err := userconfig.Dir()
	if err != nil {
		return empty, noProof, nil, err
	}
	deviceID, err := localpush.LoadDeviceRegistration(configDir, cfg.Server, cfg.Username)
	if err != nil {
		return empty, noProof, nil, err
	}
	token, err := localpush.LoadDeviceToken(configDir, cfg.Server, cfg.Username, deviceID)
	if err != nil {
		return empty, noProof, nil, err
	}
	bound, err := cli.LocalSourceBindingWithToken(ctx, sourceID, token)
	if err != nil {
		return empty, noProof, nil, err
	}
	if bound.SourceID != sourceID || bound.DeviceID != deviceID || bound.RootID == "" ||
		bound.Status != "awaiting_executor" {
		return empty, noProof, nil, errors.New("Source is not bound to this authorized device")
	}
	// This call revalidates the Root against the current native filesystem.
	grant, err := localpush.LoadRootGrant(configDir, cfg.Server, cfg.Username, bound.RootID)
	if err != nil {
		return empty, noProof, nil, err
	}
	if grant.SourceID != sourceID || grant.DeviceID != deviceID || grant.RootID != bound.RootID {
		return empty, noProof, nil, errors.New("local Root identity does not match binding")
	}
	source, err := cli.Source(ctx, sourceID)
	if err != nil {
		return empty, noProof, nil, err
	}
	if source.Kind != meta.SourceKindLocalFolder || source.Direction != meta.SourceDirectionPush ||
		source.Status != meta.SourceStatusPaused || source.Revision == 0 {
		return empty, noProof, nil, errors.New("only paused local Push Source can be edited")
	}
	latest, err := userconfig.Load()
	if err != nil {
		return empty, noProof, nil, err
	}
	if latest.SessionID != cfg.SessionID || latest.Server != cfg.Server || latest.Username != cfg.Username {
		return empty, noProof, nil, errors.New("account changed during local Root verification")
	}
	return source, client.LocalBoundSourceProof{
		DeviceID: deviceID, DeviceToken: token,
		RootID: grant.RootID, RootFingerprint: grant.Fingerprint,
	}, cli, nil
}

func localBoundBackupSettingsDTO(source client.Source) client.LocalBoundBackupSettings {
	return client.LocalBoundBackupSettings{
		SourceID: source.ID, Name: source.Name, Revision: source.Revision,
		TargetNodeID: source.TargetNodeID, TargetPath: source.TargetPath,
	}
}

func (c *agentController) CloudLocalBoundBackupSettings(ctx context.Context, sourceID uint64) (client.LocalBoundBackupSettings, error) {
	c.localFolderGrantMu.Lock()
	defer c.localFolderGrantMu.Unlock()
	source, _, _, err := c.localBoundBackupConfig(ctx, sourceID)
	if err != nil {
		return client.LocalBoundBackupSettings{}, err
	}
	return localBoundBackupSettingsDTO(source), nil
}

func (c *agentController) CloudRenameLocalBoundBackup(ctx context.Context, sourceID, revision uint64, name string) (client.LocalBoundBackupSettings, error) {
	c.localFolderGrantMu.Lock()
	defer c.localFolderGrantMu.Unlock()
	name = strings.TrimSpace(name)
	if sourceID == 0 || revision == 0 || name == "" || len([]byte(name)) > 128 {
		return client.LocalBoundBackupSettings{}, errors.New("invalid Source, revision or name")
	}
	source, proof, cli, err := c.localBoundBackupConfig(ctx, sourceID)
	if err != nil {
		return client.LocalBoundBackupSettings{}, err
	}
	if source.Revision != revision {
		return client.LocalBoundBackupSettings{}, errors.New("local Source revision changed; reload settings")
	}
	cfg, err := userconfig.Load()
	if err != nil {
		return client.LocalBoundBackupSettings{}, err
	}
	updated, err := cli.RenameLocalBoundSource(ctx, sourceID, revision, name, proof)
	if err != nil {
		return client.LocalBoundBackupSettings{}, err
	}
	latest, err := userconfig.Load()
	if err != nil {
		return client.LocalBoundBackupSettings{}, err
	}
	if latest.SessionID != cfg.SessionID || latest.Server != cfg.Server || latest.Username != cfg.Username {
		return client.LocalBoundBackupSettings{}, errors.New("account changed during rename; refresh before editing")
	}
	return localBoundBackupSettingsDTO(updated), nil
}

// CloudRetargetLocalBoundBackup is called only through private Desktop Agent IPC.
// It cannot create/activate a Source and does not modify the Root or cloud data.
func (c *agentController) CloudRetargetLocalBoundBackup(ctx context.Context, sourceID, revision, targetNodeID uint64) (client.LocalBoundBackupSettings, error) {
	c.localFolderGrantMu.Lock()
	defer c.localFolderGrantMu.Unlock()
	if sourceID == 0 || revision == 0 || targetNodeID == 0 {
		return client.LocalBoundBackupSettings{}, errors.New("invalid Source, revision or cloud target")
	}
	source, proof, cli, err := c.localBoundBackupConfig(ctx, sourceID)
	if err != nil {
		return client.LocalBoundBackupSettings{}, err
	}
	if source.Revision != revision {
		return client.LocalBoundBackupSettings{}, errors.New("Source revision changed; reload before changing target")
	}
	if source.TargetNodeID != nil && *source.TargetNodeID == targetNodeID {
		return client.LocalBoundBackupSettings{}, errors.New("the cloud target is already selected")
	}
	cfg, err := userconfig.Load()
	if err != nil {
		return client.LocalBoundBackupSettings{}, err
	}
	updated, err := cli.RetargetLocalBoundSource(ctx, sourceID, revision, targetNodeID, proof)
	if err != nil {
		return client.LocalBoundBackupSettings{}, err
	}
	latest, err := userconfig.Load()
	if err != nil {
		return client.LocalBoundBackupSettings{}, err
	}
	if latest.SessionID != cfg.SessionID || latest.Server != cfg.Server || latest.Username != cfg.Username {
		return client.LocalBoundBackupSettings{}, errors.New("account changed during local target update; refresh before continuing")
	}
	return localBoundBackupSettingsDTO(updated), nil
}
