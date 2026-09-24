package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"

	"github.com/lazyxu/xdrive/internal/version"
)

func main() {
	closeInstance, err := acquireSingleInstance()
	if err != nil {
		if errors.Is(err, errAlreadyRunning) {
			return
		}
		writeEarlyError(err)
		return
	}
	defer closeInstance()

	logFile, err := configureLogging()
	if err == nil {
		defer logFile.Close()
	}
	log.SetPrefix("xdrive-agent: ")
	log.Printf("starting version %s", version.String())

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	ctrl := newAgentController(ctx, cancel)
	ipc, ipcErr := startDesktopIPC(ctx, ctrl)
	if ipcErr != nil {
		log.Printf("desktop IPC unavailable: %v", ipcErr)
	} else {
		defer ipc.Close()
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		ctrl.Run()
	}()

	if err := startAgentUI(ctx, cancel, ctrl); err != nil && ctx.Err() == nil {
		log.Printf("desktop UI stopped: %v", err)
	}
	cancel()
	<-done
}

func configureLogging() (*os.File, error) {
	base, err := os.UserCacheDir()
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(base, "xdrive")
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
