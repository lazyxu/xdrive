package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/lazyxu/xdrive/internal/config"
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/pullworker"
	"github.com/lazyxu/xdrive/internal/sourcewake"
	"github.com/lazyxu/xdrive/internal/synologysync"
	"github.com/lazyxu/xdrive/internal/synologyworker"
	"github.com/lazyxu/xdrive/internal/yikesync"
	"github.com/lazyxu/xdrive/internal/yikeworker"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

const (
	defaultSourcePullInterval      = 6 * time.Hour
	defaultWorkerPollInterval      = time.Minute
	defaultSourceWorkerConcurrency = 2
	maxSourceWorkerConcurrency     = 8
	defaultInternalServerURL       = "http://server:8080"
	sourceWakeReconnectDelay       = 5 * time.Second
)

func runWorker(args []string) error {
	fs := flag.NewFlagSet("worker", flag.ContinueOnError)
	once := fs.Bool("once", false, "scan eligible pull sources once and exit")
	intervalRaw := fs.String("interval", "", "per-source scan interval (default XD_SOURCE_PULL_INTERVAL or 6h)")
	pollRaw := fs.String("poll-interval", "", "scheduler poll interval (default XD_SOURCE_WORKER_POLL_INTERVAL or 1m)")
	concurrencyRaw := fs.String("concurrency", "", "maximum concurrent pull sources (default XD_SOURCE_WORKER_CONCURRENCY or 2)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return fmt.Errorf("usage: xdrive-server worker [--once] [--interval DURATION] [--poll-interval DURATION] [--concurrency N]")
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
	concurrency, err := sourceWorkerConcurrency(*concurrencyRaw)
	if err != nil {
		return err
	}

	yikeRunner := &yikeworker.Runner{
		DB:        db,
		Keyring:   keyring,
		ServerURL: serverURL,
		JWTSecret: cfg.JWTSecret,
		Logger:    slog.Default(),
	}
	synologyRunner := &synologyworker.Runner{
		DB:        db,
		Keyring:   keyring,
		ServerURL: serverURL,
		JWTSecret: cfg.JWTSecret,
		Logger:    slog.Default(),
	}
	runner := &pullworker.Runner{
		DB: db,
		Handlers: map[string]pullworker.SourceHandler{
			yikesync.SourceKind:     yikeRunner,
			synologysync.SourceKind: synologyRunner,
		},
		Logger:         slog.Default(),
		MaxConcurrency: concurrency,
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
	wakeups := sourceRunWakeups(ctx, cfg.DatabaseURL)

	slog.Info("source_pull_worker_started",
		"server_url", serverURL,
		"scan_interval", interval.String(),
		"poll_interval", pollInterval.String(),
		"max_source_concurrency", concurrency,
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
		case <-wakeups:
			if err := runDue(ctx); err != nil && !errors.Is(err, context.Canceled) {
				slog.Error("source_pull_wakeup_cycle_failed", "error", err)
			}
		}
	}
}

func sourceRunWakeups(ctx context.Context, databaseURL string) <-chan struct{} {
	wakeups := make(chan struct{}, 1)
	go func() {
		for ctx.Err() == nil {
			conn, err := pgx.Connect(ctx, databaseURL)
			if err != nil {
				slog.Warn("source_pull_wakeup_listener_connect_failed", "error", err)
				if !sleepWithContext(ctx, sourceWakeReconnectDelay) {
					return
				}
				continue
			}
			if _, err := conn.Exec(ctx, "LISTEN "+sourcewake.PostgreSQLChannel); err != nil {
				slog.Warn("source_pull_wakeup_listener_listen_failed", "error", err)
				_ = conn.Close(context.Background())
				if !sleepWithContext(ctx, sourceWakeReconnectDelay) {
					return
				}
				continue
			}
			slog.Info("source_pull_wakeup_listener_ready", "channel", sourcewake.PostgreSQLChannel)
			for ctx.Err() == nil {
				if _, err := conn.WaitForNotification(ctx); err != nil {
					if ctx.Err() == nil {
						slog.Warn("source_pull_wakeup_listener_disconnected", "error", err)
					}
					break
				}
				select {
				case wakeups <- struct{}{}:
				default:
				}
			}
			_ = conn.Close(context.Background())
			if ctx.Err() == nil && !sleepWithContext(ctx, sourceWakeReconnectDelay) {
				return
			}
		}
	}()
	return wakeups
}

func sleepWithContext(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
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

func sourceWorkerConcurrency(flagValue string) (int, error) {
	value := strings.TrimSpace(flagValue)
	if value == "" {
		value = strings.TrimSpace(os.Getenv("XD_SOURCE_WORKER_CONCURRENCY"))
	}
	if value == "" {
		return defaultSourceWorkerConcurrency, nil
	}
	concurrency, err := strconv.Atoi(value)
	if err != nil || concurrency < 1 || concurrency > maxSourceWorkerConcurrency {
		return 0, fmt.Errorf("invalid source worker concurrency %q; expected 1..%d", value, maxSourceWorkerConcurrency)
	}
	return concurrency, nil
}
