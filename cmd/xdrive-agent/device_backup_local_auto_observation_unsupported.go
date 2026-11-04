//go:build !linux && !windows

package main

import (
	"context"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// Platforms without the local Push auto-scheduler must never claim a
// verified due rule or automatically armed checkpoint.
func localBoundAgentAutoReadiness(
	_ context.Context, _ userconfig.Config, _ client.Source,
	_ client.LocalBoundSourceProof, saved client.LocalBoundBackupSchedule,
) client.LocalBoundBackupSchedule {
	saved.AutoReadiness = "unavailable"
	saved.NextScheduledAt = nil
	return saved
}
