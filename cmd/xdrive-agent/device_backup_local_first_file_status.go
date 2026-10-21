package main

import (
	"context"

	"github.com/lazyxu/xdrive/internal/localpushrunner"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// The Agent's bounded, process-local observation is strictly read-only.
// "not-recorded" does NOT mean the original server writer was cancelled,
// or that a durable Stage/OS claim does not exist after an Agent restart.
type localBackupFirstFileJobStatus struct {
	SourceID         uint64 `json:"source_id"`
	Phase            string `json:"phase"`
	Revision         uint64 `json:"revision,omitempty"`
	ObservedBytes    int64  `json:"observed_bytes,omitempty"`
	PhysicalObserved bool   `json:"physical_observed"`
	BackupComplete   bool   `json:"backup_complete"`
	RetirementSafe   bool   `json:"retirement_safe"`
}

func (c *agentController) inspectLocalFirstFileJobForKey(
	ctx context.Context, key localPushFirstFileJobKey,
) (localBackupFirstFileJobStatus, error) {
	var empty localBackupFirstFileJobStatus
	if c == nil || ctx == nil || ctx.Err() != nil || c.ctx == nil ||
		c.ctx.Err() != nil || !key.valid() {
		return empty, errLocalBackupFirstFileUnavailable
	}
	view := localBackupFirstFileJobStatus{SourceID: key.sourceID, Phase: "not-recorded"}
	c.localFirstFileJobMu.Lock()
	job := c.localFirstFileJobs[key]
	c.localFirstFileJobMu.Unlock()
	if job == nil {
		return view, nil
	}
	// Closing done synchronizes the writer's result and error. Never read
	// either field while its owning worker is still active.
	select {
	case <-job.done:
		out := job.result
		if job.err != nil || out.SourceID != key.sourceID ||
			out.Revision == 0 || out.ObservedFiles != 1 ||
			out.ObservedBytes < 0 || out.ObservedBytes > localpushrunner.MaxFirstLeafBytes ||
			!out.PhysicalObserved || out.BackupComplete || out.RetirementSafe {
			view.Phase = "uncertain"
		} else {
			view.Phase = "observed"
			view.Revision = out.Revision
			view.ObservedBytes = out.ObservedBytes
			view.PhysicalObserved = true
		}
	default:
		view.Phase = "running"
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	return view, nil
}

// CloudReadLocalBoundBackupFirstFileStatus is a narrow owning-Agent-only
// observer. The current OS-stored Server/account/session AND registered local
// device identity must match before and after reading the in-memory job. Never expose a former account's job, an OS
// path, Stage, operation token, original error or any additional write right.
func (c *agentController) CloudReadLocalBoundBackupFirstFileStatus(
	ctx context.Context, sourceID uint64,
) (localBackupFirstFileJobStatus, error) {
	var empty localBackupFirstFileJobStatus
	if c == nil || ctx == nil || ctx.Err() != nil || sourceID == 0 {
		return empty, errLocalBackupFirstFileUnavailable
	}
	account, err := userconfig.Load()
	if err != nil || account.SessionInvalid || account.Server == "" ||
		account.Username == "" || account.SessionID == "" {
		return empty, errLocalBackupFirstFileUnavailable
	}
	key, err := currentLocalFirstFileDeviceKey(account, sourceID)
	if err != nil {
		return empty, errLocalBackupFirstFileUnavailable
	}
	view, err := c.inspectLocalFirstFileJobForKey(ctx, key)
	if err != nil {
		return empty, errLocalBackupFirstFileUnavailable
	}
	current, err := userconfig.Load()
	if err != nil || current.SessionInvalid || current.Server != account.Server ||
		current.Username != account.Username || current.SessionID != account.SessionID ||
		ctx.Err() != nil {
		return empty, errLocalBackupFirstFileUnavailable
	}
	currentKey, err := currentLocalFirstFileDeviceKey(current, sourceID)
	if err != nil || currentKey != key || ctx.Err() != nil {
		return empty, errLocalBackupFirstFileUnavailable
	}
	return view, nil
}
