package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// Mount is a request to the one owning Agent, NOT another FUSE/CfAPI runner.
// The existing full-mode Agent owns reconciliation, cache, transfers, and the
// mount lifecycle independently from the xd command's lifetime.
func mountCmd(args []string) error {
	fs := flag.NewFlagSet("mount", flag.ContinueOnError)
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() > 1 {
		return errors.New("mount accepts zero or one PATH")
	}
	cfg, err := userconfig.Load()
	if err != nil {
		return err
	}
	if cfg.MustChangePassword {
		return errors.New("password change required; run xd password first")
	}
	var requested string
	if fs.NArg() == 1 {
		requested, err = filepath.Abs(fs.Arg(0))
		if err != nil {
			return err
		}
		requested = filepath.Clean(requested)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	agent, err := connectFullAgent(ctx)
	if err != nil {
		return err
	}
	settings, err := requestAgentMount(ctx, agent, requested)
	if err != nil {
		return err
	}
	fmt.Printf("Agent-managed xDrive mount requested: %s\n", settings.MountPath)
	fmt.Fprintln(os.Stdout, "The Agent owns FUSE/CfAPI reconciliation. This is a settings acknowledgement, not confirmation the mount is ready.")
	fmt.Fprintln(os.Stdout, "Exiting xd does not stop the Agent or its existing backup tasks.")
	return nil
}

type owningMountAgent interface {
	RequireFullMode() error
	MountSettings(context.Context) (localbackupipc.MountSettings, error)
	UpdateMountPath(context.Context, string) (localbackupipc.MountSettings, error)
}

func requestAgentMount(ctx context.Context, agent owningMountAgent, requested string) (localbackupipc.MountSettings, error) {
	if agent == nil {
		return localbackupipc.MountSettings{}, errors.New("owning xdrive-agent is unavailable")
	}
	if err := agent.RequireFullMode(); err != nil {
		return localbackupipc.MountSettings{}, err
	}
	var result localbackupipc.MountSettings
	var err error
	if requested == "" {
		result, err = agent.MountSettings(ctx)
	} else {
		if !filepath.IsAbs(requested) || filepath.Clean(requested) != requested {
			return localbackupipc.MountSettings{}, errors.New("mount requires an absolute normalized path")
		}
		result, err = agent.UpdateMountPath(ctx, requested)
	}
	if err != nil {
		return localbackupipc.MountSettings{}, err
	}
	if result.MountPath == "" || !filepath.IsAbs(result.MountPath) {
		return localbackupipc.MountSettings{}, errors.New("Agent did not return a valid mount directory")
	}
	if requested != "" && result.MountPath != requested &&
		!(runtime.GOOS == "windows" && strings.EqualFold(result.MountPath, requested)) {
		return localbackupipc.MountSettings{}, errors.New("Agent did not confirm the requested mount directory")
	}
	return result, nil
}

func refuseMountCleanupWhenAgentActive() error {
	dir, err := userconfig.Dir()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	_, err = localbackupipc.Connect(ctx, dir)
	if err == nil {
		return errors.New("refusing to unregister the mount while the owning xdrive-agent is running")
	}
	if !errors.Is(err, localbackupipc.ErrAgentUnavailable) {
		return fmt.Errorf("cannot prove owning Agent stopped; refusing mount cleanup: %w", err)
	}
	// An unreachable IPC endpoint does NOT prove that a hung Agent released
	// the live sync root. Clean up only after normal Agent shutdown removed
	// the protected discovery file. A stale file needs explicit diagnosis.
	if _, statErr := os.Lstat(filepath.Join(dir, "desktop-ipc.json")); statErr == nil {
		return errors.New("Agent discovery still exists; refusing potentially destructive cleanup; inspect the Agent and stop it safely")
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return fmt.Errorf("cannot verify Agent shutdown before cleanup: %w", statErr)
	}
	return nil
}
