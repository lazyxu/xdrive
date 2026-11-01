package main

import (
	"errors"
)

// The full Desktop Agent may continue without optional local IPC, as before.
// Backup-only on DSM cannot be used without it: a still-running scheduler
// would be invisible to the authenticated CGI and Package Center users.
func agentIPCStartupPermitsWorker(backupOnly bool, ipcErr error) bool {
	return ipcErr == nil || !backupOnly
}

// agentBackupOnlyRequested selects an Agent-only runtime: keep the original
// Desktop invocation unchanged and reject malformed headless invocations.
func agentBackupOnlyRequested(args []string) (bool, error) {
	if len(args) == 0 || args[0] != "--backup-only" {
		return false, nil
	}
	if len(args) != 1 {
		return false, errors.New("--backup-only does not accept additional arguments")
	}
	return true, nil
}

// RunBackupOnly is the same owning Agent and same Push Runner, but without the
// ordinary FUSE/CfAPI mount reconciliation, Explorer hooks or update service.
// The manual worker runs through authenticated local IPC in its own goroutine;
// scheduled incremental runs continue under this process and its Source lease.
func (c *agentController) RunBackupOnly() {
	if c == nil || c.ctx == nil || c.ctx.Err() != nil {
		return
	}
	go c.runDeviceBackupHeartbeat()
	go c.runLocalPushAutoScheduler()
	<-c.ctx.Done()
}
