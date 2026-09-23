package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/mount"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

type desiredMount struct {
	key  string
	root string
	cfg  userconfig.Config
}

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
	log.Printf("starting")

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	var (
		running       bool
		currentKey    string
		mountCancel   context.CancelFunc
		mountDone     chan error
		lastLoadError string
	)

	start := func(d desiredMount) {
		mctx, mcancel := context.WithCancel(ctx)
		done := make(chan error, 1)
		running = true
		currentKey = d.key
		mountCancel = mcancel
		mountDone = done
		log.Printf("mounting %s for %s", d.root, d.cfg.Username)
		go func() {
			done <- mount.Run(mctx, client.New(d.cfg.Server, d.cfg.Token), d.root)
		}()
	}

	stop := func() {
		if mountCancel != nil {
			mountCancel()
		}
	}

	reconcile := func() {
		d, loadErr := loadDesired()
		if loadErr != nil {
			msg := loadErr.Error()
			if msg != lastLoadError {
				log.Printf("waiting for login/config: %v", loadErr)
				lastLoadError = msg
			}
			if running {
				stop()
			}
			return
		}
		lastLoadError = ""
		if running {
			if d.key != currentKey {
				log.Printf("configuration changed; restarting mount")
				stop()
			}
			return
		}
		start(d)
	}

	reconcile()
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			stop()
			if running {
				select {
				case <-mountDone:
				case <-time.After(5 * time.Second):
				}
			}
			return
		case err := <-mountDone:
			if err != nil && !errors.Is(err, context.Canceled) {
				log.Printf("mount stopped: %v", err)
			} else {
				log.Printf("mount stopped")
			}
			running = false
			currentKey = ""
			mountCancel = nil
			mountDone = nil
		case <-ticker.C:
			reconcile()
		}
	}
}

func loadDesired() (desiredMount, error) {
	cfg, err := userconfig.Load()
	if err != nil {
		return desiredMount{}, err
	}
	root, err := userconfig.EffectiveMountPath(cfg)
	if err != nil {
		return desiredMount{}, err
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return desiredMount{}, err
	}
	key := cfg.Server + "\x00" + cfg.Token + "\x00" + root
	return desiredMount{key: key, root: root, cfg: cfg}, nil
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
