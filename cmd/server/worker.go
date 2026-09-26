package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/lazyxu/xdrive/internal/config"
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/yikeworker"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

const (
	defaultSourcePullInterval = 6 * time.Hour
	defaultWorkerPollInterval = time.Minute
	defaultInternalServerURL  = "http://server:8080"
)

func runWorker(args []string) error {
	fs := flag.NewFlagSet("worker", flag.ContinueOnError)
	once := fs.Bool("once", false, "scan eligible pull sources once and exit")
	intervalRaw := fs.String("interval", "", "per-source scan interval (default XD_SOURCE_PULL_INTERVAL or 6h)")
	pollRaw := fs.String("poll-interval", "", "scheduler poll interval (default XD_SOURCE_WORKER_POLL_INTERVAL or 1m)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return fmt.Errorf("usage: xdrive-server worker [--once] [--interval DURATION] [--poll-interval DURATION]")
	}

	cfg, err := config.Load()
	if err != nil {
		return err
	}
	keyring, err := connectorsecret.ParseKeyring(
		cfg.ConnectorSecretActiveVersion,
		cfg.ConnectorSecretKeys,
		cfg.ConnectorSecretLegacyKey,
	)
	if err != nil {
		return err
	}
	if keyring == nil {
		return fmt.Errorf("connector secret keyring is required for pull worker")
	}

	db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	serverURL := strings.TrimRight(strings.TrimSpace(os.Getenv("XD_INTERNAL_SERVER_URL")), "/")
	if serverURL == "" {
		serverURL = defaultInternalServerURL
	}
	interval, err := sourcePullInterval(*intervalRaw)
	if err != nil {
		return err
	}
	pollInterval, err := sourceWorkerPollInterval(*pollRaw)
	if err != nil {
		return err
	}

	runner := &yikeworker.Runner{
		DB:        db,
		Keyring:   keyring,
		ServerURL: serverURL,
		JWTSecret: cfg.JWTSecret,
		Logger:    slog.Default(),
	}

	runImmediate := func(ctx context.Context) error {
		report, err := runner.RunAll(ctx)
		slog.Info("source_pull_cycle_finished",
			"mode", "immediate",
			"eligible", report.Eligible,
			"completed", report.Completed,
			"skipped", report.Skipped,
			"failed", report.Failed,
		)
		return err
	}
	runDue := func(ctx context.Context) error {
		report, err := runner.RunDue(ctx, time.Now().UTC(), interval)
		slog.Info("source_pull_cycle_finished",
			"mode", "scheduled",
			"eligible", report.Eligible,
			"completed", report.Completed,
			"skipped", report.Skipped,
			"failed", report.Failed,
		)
		return err
	}

	if *once {
		return runImmediate(context.Background())
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	slog.Info("source_pull_worker_started",
		"server_url", serverURL,
		"scan_interval", interval.String(),
		"poll_interval", pollInterval.String(),
	)
	if err := runDue(ctx); err != nil && !errors.Is(err, context.Canceled) {
		slog.Error("source_pull_cycle_failed", "error", err)
	}

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			slog.Info("source_pull_worker_stopping")
			return nil
		case <-ticker.C:
			if err := runDue(ctx); err != nil && !errors.Is(err, context.Canceled) {
				slog.Error("source_pull_cycle_failed", "error", err)
			}
		}
	}
}

func sourceWorkerPollInterval(flagValue string) (time.Duration, error) {
	value := strings.TrimSpace(flagValue)
	if value == "" {
		value = strings.TrimSpace(os.Getenv("XD_SOURCE_WORKER_POLL_INTERVAL"))
	}
	if value == "" {
		return defaultWorkerPollInterval, nil
	}
	duration, err := time.ParseDuration(value)
	if err != nil || duration < 10*time.Second {
		return 0, fmt.Errorf("invalid source worker poll interval %q; minimum is 10s", value)
	}
	return duration, nil
}

func sourcePullInterval(flagValue string) (time.Duration, error) {
	value := strings.TrimSpace(flagValue)
	if value == "" {
		value = strings.TrimSpace(os.Getenv("XD_SOURCE_PULL_INTERVAL"))
	}
	if value == "" {
		return defaultSourcePullInterval, nil
	}
	duration, err := time.ParseDuration(value)
	if err != nil || duration < time.Minute {
		return 0, fmt.Errorf("invalid source pull interval %q; minimum is 1m", value)
	}
	return duration, nil
}
