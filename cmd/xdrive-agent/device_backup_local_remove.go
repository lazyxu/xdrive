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
	removed, err := cli.RemoveLocalBoundSource(ctx, sourceID, revision, proof)
	if err != nil {
		// A network timeout is ambiguous; never delete the Root grant.
		return client.LocalBoundBackupRemoval{}, err
	}
	// A Server that archives configured Sources returns the retained Source
	// DTO (200). Keep the Root grant so the owner can later restore this exact
	// Source from the owning-device archive UI.
	if removed.ID != 0 {
		if removed.ID != sourceID || removed.Status != "archived" {
			return client.LocalBoundBackupRemoval{}, errors.New("unexpected Source lifecycle response; local Root grant retained")
		}
		return client.LocalBoundBackupRemoval{
			SourceID: sourceID, Status: "archived", LocalGrantRemoved: false,
		}, nil
	}
	// Only a confirmed 204 hard-delete of a pristine local draft permits
	// removing the OS-private Root grant. The local directory is never deleted.
	result := client.LocalBoundBackupRemoval{SourceID: sourceID, Status: "removed"}
	configDir, err := userconfig.Dir()
	if err == nil {
		result.LocalGrantRemoved = localpush.RemoveRootGrant(
			configDir, cfg.Server, cfg.Username, proof.RootID,
		) == nil
	}
	return result, nil
}
