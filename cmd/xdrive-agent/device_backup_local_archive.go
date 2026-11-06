package main

import (
	"context"
	"errors"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// CloudLocalBoundBackupArchiveSettings is an owning-Agent-only projection.
// It verifies the device credential and current native Root grant even for
// archived Sources; it never returns the Root ID, fingerprint or local path.
func (c *agentController) CloudLocalBoundBackupArchiveSettings(
	ctx context.Context,
	sourceID uint64,
) (client.LocalBoundBackupSettings, error) {
	c.localFolderGrantMu.Lock()
	defer c.localFolderGrantMu.Unlock()
	source, _, _, _, err := c.localBoundBackupAuthorization(ctx, sourceID)
	if err != nil {
		return client.LocalBoundBackupSettings{}, err
	}
	return localBoundBackupSettingsDTO(source), nil
}

func (c *agentController) CloudArchiveLocalBoundBackup(
	ctx context.Context,
	sourceID, revision uint64,
) (client.LocalBoundBackupSettings, error) {
	c.localFolderGrantMu.Lock()
	defer c.localFolderGrantMu.Unlock()
	if sourceID == 0 || revision == 0 {
		return client.LocalBoundBackupSettings{}, errors.New("invalid local Source or revision")
	}
	source, proof, cli, cfg, err := c.localBoundBackupAuthorization(ctx, sourceID)
	if err != nil {
		return client.LocalBoundBackupSettings{}, err
	}
	if source.Revision != revision {
		return client.LocalBoundBackupSettings{}, errors.New("local Source revision changed; refresh before archive")
	}
	if source.Status == meta.SourceStatusArchived {
		return localBoundBackupSettingsDTO(source), nil
	}
	if source.Status != meta.SourceStatusActive && source.Status != meta.SourceStatusPaused {
		return client.LocalBoundBackupSettings{}, errors.New("local Source cannot be archived from its current state")
	}
	archived, err := cli.ArchiveLocalBoundSource(ctx, sourceID, revision, proof)
	if err != nil {
		// The Root grant is intentionally retained. A timeout is ambiguous and
		// must never make the local Source unrecoverable.
		return client.LocalBoundBackupSettings{}, err
	}
	if err := verifyLocalBackupAccountScope(cfg); err != nil {
		return client.LocalBoundBackupSettings{}, err
	}
	return localBoundBackupSettingsDTO(archived), nil
}

func (c *agentController) CloudRestoreLocalBoundBackup(
	ctx context.Context,
	sourceID, revision uint64,
) (client.LocalBoundBackupSettings, error) {
	c.localFolderGrantMu.Lock()
	defer c.localFolderGrantMu.Unlock()
	if sourceID == 0 || revision == 0 {
		return client.LocalBoundBackupSettings{}, errors.New("invalid local Source or revision")
	}
	source, proof, cli, cfg, err := c.localBoundBackupAuthorization(ctx, sourceID)
	if err != nil {
		return client.LocalBoundBackupSettings{}, err
	}
	if source.Revision != revision {
		return client.LocalBoundBackupSettings{}, errors.New("local Source revision changed; refresh before restore")
	}
	if source.Status != meta.SourceStatusArchived {
		return client.LocalBoundBackupSettings{}, errors.New("only an archived local Push Source can be restored")
	}
	restored, err := cli.RestoreLocalBoundSource(ctx, sourceID, revision, proof)
	if err != nil {
		return client.LocalBoundBackupSettings{}, err
	}
	if err := verifyLocalBackupAccountScope(cfg); err != nil {
		return client.LocalBoundBackupSettings{}, err
	}
	return localBoundBackupSettingsDTO(restored), nil
}

func verifyLocalBackupAccountScope(expected userconfig.Config) error {
	latest, err := userconfig.Load()
	if err != nil {
		return err
	}
	if latest.SessionID != expected.SessionID || latest.Server != expected.Server ||
		latest.Username != expected.Username {
		return errors.New("account changed during local backup archive operation; refresh before continuing")
	}
	return nil
}
