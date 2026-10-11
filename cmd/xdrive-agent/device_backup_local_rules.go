package main

import (
	"context"
	"errors"

	"github.com/lazyxu/xdrive/internal/client"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

func localBackupRuleSessionUnchanged(before userconfig.Config) error {
	latest, err := userconfig.Load()
	if err != nil {
		return err
	}
	if before.SessionID != latest.SessionID || before.Server != latest.Server || before.Username != latest.Username {
		return errors.New("account changed during local backup rule operation; reload settings")
	}
	return nil
}

// The Agent keeps enrollment and native Root proof private. This sensitive
// rule read may not use ordinary Source or remote-device overview endpoints.
func (c *agentController) CloudLocalBoundBackupRules(ctx context.Context, sourceID uint64) (client.LocalBoundIgnoreRules, error) {
	c.localFolderGrantMu.Lock()
	defer c.localFolderGrantMu.Unlock()
	cfg, err := userconfig.Load()
	if err != nil {
		return client.LocalBoundIgnoreRules{}, err
	}
	source, proof, cli, err := c.localBoundBackupConfig(ctx, sourceID)
	if err != nil {
		return client.LocalBoundIgnoreRules{}, err
	}
	result, err := cli.LocalBoundRules(ctx, sourceID, proof)
	if err != nil {
		return client.LocalBoundIgnoreRules{}, err
	}
	if result.SourceID != sourceID || result.Revision != source.Revision {
		return client.LocalBoundIgnoreRules{}, errors.New("local Source changed during rule read; reload")
	}
	if err := localBackupRuleSessionUnchanged(cfg); err != nil {
		return client.LocalBoundIgnoreRules{}, err
	}
	return result, nil
}

// Changing ignore rules only edits an already-bound and paused Source. No
// task, scan, scheduler, file read or Mirror deletion may be started here.
func (c *agentController) CloudSetLocalBoundBackupRules(ctx context.Context, sourceID, revision uint64, rules string) (client.LocalBoundIgnoreRules, error) {
	c.localFolderGrantMu.Lock()
	defer c.localFolderGrantMu.Unlock()
	if sourceID == 0 || revision == 0 {
		return client.LocalBoundIgnoreRules{}, errors.New("positive Source ID and revision required")
	}
	if _, err := sourcepkg.CompileIgnoreRules(rules); err != nil {
		return client.LocalBoundIgnoreRules{}, errors.New("invalid ignore rule syntax or size")
	}
	cfg, err := userconfig.Load()
	if err != nil {
		return client.LocalBoundIgnoreRules{}, err
	}
	source, proof, cli, err := c.localBoundBackupConfig(ctx, sourceID)
	if err != nil {
		return client.LocalBoundIgnoreRules{}, err
	}
	if source.Revision != revision {
		return client.LocalBoundIgnoreRules{}, errors.New("Source revision changed; reload rules")
	}
	previous, err := cli.LocalBoundRules(ctx, sourceID, proof)
	if err != nil {
		return client.LocalBoundIgnoreRules{}, err
	}
	if previous.Revision != revision || previous.SourceID != sourceID {
		return client.LocalBoundIgnoreRules{}, errors.New("Source revision changed during rule edit")
	}
	if previous.IgnoreRules == rules {
		return client.LocalBoundIgnoreRules{}, errors.New("ignore rules are unchanged")
	}
	if err := localBackupRuleSessionUnchanged(cfg); err != nil {
		return client.LocalBoundIgnoreRules{}, err
	}
	result, err := cli.SetLocalBoundRules(ctx, sourceID, revision, rules, proof)
	if err != nil {
		return client.LocalBoundIgnoreRules{}, err
	}
	if err := localBackupRuleSessionUnchanged(cfg); err != nil {
		return client.LocalBoundIgnoreRules{}, err
	}
	return result, nil
}
