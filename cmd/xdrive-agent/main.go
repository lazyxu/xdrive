package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/lazyxu/xdrive/internal/version"
)

func main() {
	os.Exit(runAgent())
}

// runAgent returns a status after deferring the instance lock and IPC cleanup.
// In Backup-only mode, DSM must not report a running Agent whose authenticated
// local control interface failed to start.
func runAgent() int {
	if handled, err := runShellAction(os.Args[1:]); handled {
		if err != nil {
			writeEarlyError(err)
			return 1
		}
		return 0
	}

	backupOnly, err := agentBackupOnlyRequested(os.Args[1:])
	if err != nil {
		writeEarlyError(err)
		return 2
	}

	// Install the shutdown handler before potentially slow instance-lock and
	// logging initialization. The parent `xd backup agent` can receive a
	// service-manager stop while the child is still starting; without this,
	// its forwarded interrupt may terminate the Agent by the default signal
	// action instead of completing the normal graceful shutdown path.
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	closeInstance, err := acquireSingleInstance()
	if err != nil {
		if errors.Is(err, errAlreadyRunning) {
			return 0
		}
		writeEarlyError(err)
		// DSM Backup-only must signal failed startup to Package Center and
		// service supervisors instead of reporting a clean exit with no Agent.
		// Preserve the original Desktop Agent behavior outside Backup-only.
		if backupOnly {
			return 1
		}
		return 0
	}
	defer closeInstance()

	logFile, err := configureLogging()
	if err == nil {
		defer logFile.Close()
	}
	log.SetPrefix("xdrive-agent: ")
	log.Printf("starting version %s", version.String())

	ctrl := newAgentController(ctx, cancel)
	ipc, ipcErr := startDesktopIPC(ctx, ctrl, cancel, backupOnly)
	if ipcErr != nil {
		log.Printf("desktop IPC unavailable: %v", ipcErr)
	}
	if !agentIPCStartupPermitsWorker(backupOnly, ipcErr) {
		// Without authenticated IPC, the DSM CGI and xd cannot start, inspect
		// or stop local backups. Do not leave a headless scheduler running
		// while Package Center incorrectly reports a usable Backup-only Agent.
		log.Print("Backup-only requires authenticated local IPC; refusing to start scheduler")
		return 1
	}
	if ipc != nil {
		defer ipc.Close()
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		if backupOnly {
			ctrl.RunBackupOnly()
		} else {
			ctrl.Run()
		}
	}()

	<-ctx.Done()
	cancel()
	<-done
	return 0
}

func agentLogDir() (string, error) {
	base, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "xdrive"), nil
}

func configureLogging() (*os.File, error) {
	dir, err := agentLogDir()
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(filepath.Join(dir, "agent.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	log.SetOutput(f)
	return f, nil
}

func writeEarlyError(err error) {
	_, _ = fmt.Fprintf(os.Stderr, "xdrive-agent: %v\n", err)
}
