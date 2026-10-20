package main

import (
	"context"

	"github.com/lazyxu/xdrive/internal/userconfig"
)

// The Agent owns the already-authorized physical first-file operation.
// Closing its Desktop/IPC request detaches the observer rather than
// asserting physical cancellation or creating a second Stage.
type localPushFirstFileJobKey struct {
	server, account, sessionID string
	sourceID                   uint64
}
type localPushFirstFileJob struct {
	done   chan struct{}
	result localBackupFirstFileSummary
	err    error
}

const maxLocalPushFirstFileJobs = 128

func (key localPushFirstFileJobKey) valid() bool {
	return key.server != "" && key.account != "" && key.sessionID != "" && key.sourceID != 0
}

func (c *agentController) runDetachedLocalPushFirstFile(
	ctx context.Context, key localPushFirstFileJobKey,
	execute func(context.Context, uint64) (localBackupFirstFileSummary, error),
) (localBackupFirstFileSummary, error) {
	var empty localBackupFirstFileSummary
	if c == nil || ctx == nil || ctx.Err() != nil || c.ctx == nil ||
		c.ctx.Err() != nil || !key.valid() || execute == nil {
		return empty, errLocalBackupFirstFileUnavailable
	}
	c.localFirstFileJobMu.Lock()
	if c.localFirstFileJobs == nil {
		c.localFirstFileJobs = make(map[localPushFirstFileJobKey]*localPushFirstFileJob)
	}
	job := c.localFirstFileJobs[key]
	if job == nil {
		if len(c.localFirstFileJobs) >= maxLocalPushFirstFileJobs {
			c.localFirstFileJobMu.Unlock()
			return empty, errLocalBackupFirstFileUnavailable
		}
		for previous, running := range c.localFirstFileJobs {
			// Other accounts must not inspect or retrigger the original
			// Source. Only one physical writer is active per Agent.
			if previous.sourceID == key.sourceID {
				c.localFirstFileJobMu.Unlock()
				return empty, errLocalBackupFirstFileUnavailable
			}
			select {
			case <-running.done:
			default:
				c.localFirstFileJobMu.Unlock()
				return empty, errLocalBackupFirstFileUnavailable
			}
		}
		job = &localPushFirstFileJob{done: make(chan struct{})}
		c.localFirstFileJobs[key] = job
		go func() {
			// The original Agent code retains its 8-minute deadline,
			// Owner/Root/Source native checks and historical CAS/SQL
			// reconciliation. Cache failures, never automatically retry.
			job.result, job.err = execute(c.ctx, key.sourceID)
			close(job.done)
		}()
	}
	c.localFirstFileJobMu.Unlock()
	select {
	case <-ctx.Done():
		return empty, ctx.Err()
	case <-job.done:
		if err := ctx.Err(); err != nil {
			return empty, err
		}
		return job.result, job.err
	}
}

// Identical owning-Desktop IPC calls join the first Agent process job.
// No new browser / foreign Desktop / public Server API is created.
func (c *agentController) CloudStartLocalBoundBackupFirstFile(
	ctx context.Context, sourceID uint64,
) (localBackupFirstFileSummary, error) {
	var empty localBackupFirstFileSummary
	if c == nil || ctx == nil || ctx.Err() != nil || sourceID == 0 ||
		c.ctx == nil || c.ctx.Err() != nil {
		return empty, errLocalBackupFirstFileUnavailable
	}
	account, err := userconfig.Load()
	if err != nil || account.SessionInvalid || account.Server == "" ||
		account.Username == "" || account.SessionID == "" {
		return empty, errLocalBackupFirstFileUnavailable
	}
	return c.runDetachedLocalPushFirstFile(ctx, localPushFirstFileJobKey{
		server: account.Server, account: account.Username,
		sessionID: account.SessionID, sourceID: sourceID,
	}, c.cloudStartLocalBoundBackupFirstFileOnce)
}
