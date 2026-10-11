package main

import (
	"context"
	"errors"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/sourceschedule"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// Only the owning native Agent may inspect or change a paused local Source's
// saved schedule. Its token and validated Root grant never enter the Renderer.
func (c *agentController) CloudLocalBoundBackupSchedule(ctx context.Context, sourceID uint64) (client.LocalBoundBackupSchedule, error) {
	c.localFolderGrantMu.Lock()
	defer c.localFolderGrantMu.Unlock()
	cfg, err := userconfig.Load()
	if err != nil {
		return client.LocalBoundBackupSchedule{}, err
	}
	source, proof, cli, err := c.localBoundBackupConfig(ctx, sourceID)
	if err != nil {
		return client.LocalBoundBackupSchedule{}, err
	}
	result, err := cli.LocalBoundSchedule(ctx, sourceID, proof)
	if err != nil {
		return client.LocalBoundBackupSchedule{}, err
	}
	if result.SourceID != sourceID || result.Revision != source.Revision {
		return client.LocalBoundBackupSchedule{}, errors.New("local Source changed during schedule read; reload")
	}
	if err := localBackupRuleSessionUnchanged(cfg); err != nil {
		return client.LocalBoundBackupSchedule{}, err
	}
	return result, nil
}

// This is a saved-only configuration. It cannot start a task, configure a
// remote runner, or bypass the Server's local_folder activation hard-denial.
func (c *agentController) CloudSetLocalBoundBackupSchedule(ctx context.Context, sourceID, revision uint64, spec sourceschedule.Spec) (client.LocalBoundBackupSchedule, error) {
	c.localFolderGrantMu.Lock()
	defer c.localFolderGrantMu.Unlock()
	if sourceID == 0 || revision == 0 {
		return client.LocalBoundBackupSchedule{}, errors.New("positive Source and revision required")
	}
	normalized, err := sourceschedule.Normalize(spec.Type, spec.Expression, spec.Timezone)
	if err != nil || normalized.Type == "" {
		return client.LocalBoundBackupSchedule{}, errors.New("invalid local backup schedule")
	}
	cfg, err := userconfig.Load()
	if err != nil {
		return client.LocalBoundBackupSchedule{}, err
	}
	source, proof, cli, err := c.localBoundBackupConfig(ctx, sourceID)
	if err != nil {
		return client.LocalBoundBackupSchedule{}, err
	}
	if source.Revision != revision {
		return client.LocalBoundBackupSchedule{}, errors.New("local Source revision changed; reload schedule")
	}
	previous, err := cli.LocalBoundSchedule(ctx, sourceID, proof)
	if err != nil {
		return client.LocalBoundBackupSchedule{}, err
	}
	if previous.SourceID != sourceID || previous.Revision != revision {
		return client.LocalBoundBackupSchedule{}, errors.New("local schedule changed during edit; reload")
	}
	if previous.ScheduleType == normalized.Type && previous.ScheduleExpression == normalized.Expression &&
		previous.ScheduleTimezone == normalized.Timezone {
		return client.LocalBoundBackupSchedule{}, errors.New("saved schedule has not changed")
	}
	if err := localBackupRuleSessionUnchanged(cfg); err != nil {
		return client.LocalBoundBackupSchedule{}, err
	}
	result, err := cli.SetLocalBoundSchedule(ctx, sourceID, revision, normalized, proof)
	if err != nil {
		return client.LocalBoundBackupSchedule{}, err
	}
	if err := localBackupRuleSessionUnchanged(cfg); err != nil {
		return client.LocalBoundBackupSchedule{}, err
	}
	return result, nil
}
