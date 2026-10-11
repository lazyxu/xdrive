package main

import (
	"context"
	"errors"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// CloudRemoveLocalBoundBackup only removes a pristine, paused local Source.
// The Agent owns both credential verification and native Root verification.
func (c *agentController) CloudRemoveLocalBoundBackup(ctx context.Context, sourceID, revision uint64) (client.LocalBoundBackupRemoval, error) {
	c.localFolderGrantMu.Lock()
	defer c.localFolderGrantMu.Unlock()
	if sourceID == 0 || revision == 0 {
		return client.LocalBoundBackupRemoval{}, errors.New("invalid local Source or revision")
	}
	source, proof, cli, err := c.localBoundBackupConfig(ctx, sourceID)
	if err != nil {
		return client.LocalBoundBackupRemoval{}, err
	}
	if source.Revision != revision {
		return client.LocalBoundBackupRemoval{}, errors.New("local Source revision changed; refresh before removal")
	}
	cfg, err := userconfig.Load()
	if err != nil {
		return client.LocalBoundBackupRemoval{}, err
	}
	if err := cli.RemoveLocalBoundSource(ctx, sourceID, revision, proof); err != nil {
		// A network timeout is ambiguous; never delete the Root grant.
		return client.LocalBoundBackupRemoval{}, err
	}
	// Local grant cleanup is attempted only after confirmed Server deletion.
	// RemoveRootGrant removes only a private JSON record, not the directory.
	result := client.LocalBoundBackupRemoval{SourceID: sourceID}
	configDir, err := userconfig.Dir()
	if err == nil {
		result.LocalGrantRemoved = localpush.RemoveRootGrant(
			configDir, cfg.Server, cfg.Username, proof.RootID,
		) == nil
	}
	return result, nil
}
