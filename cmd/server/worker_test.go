package main

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/lazyxu/xdrive/internal/sourcewake"
)

func TestSourcePullInterval(t *testing.T) {
	t.Setenv("XD_SOURCE_PULL_INTERVAL", "")
	got, err := sourcePullInterval("")
	if err != nil {
		t.Fatal(err)
	}
	if got != 6*time.Hour {
		t.Fatalf("default interval=%s want=6h", got)
	}

	t.Setenv("XD_SOURCE_PULL_INTERVAL", "45m")
	got, err = sourcePullInterval("")
	if err != nil {
		t.Fatal(err)
	}
	if got != 45*time.Minute {
		t.Fatalf("env interval=%s want=45m", got)
	}

	got, err = sourcePullInterval("2h")
	if err != nil {
		t.Fatal(err)
	}
	if got != 2*time.Hour {
		t.Fatalf("flag interval=%s want=2h", got)
	}

	for _, value := range []string{"broken", "30s", "0s", "-1h"} {
		if _, err := sourcePullInterval(value); err == nil {
			t.Fatalf("invalid interval %q was accepted", value)
		}
	}
}

func TestSourceWorkerPollInterval(t *testing.T) {
	t.Setenv("XD_SOURCE_WORKER_POLL_INTERVAL", "")
	got, err := sourceWorkerPollInterval("")
	if err != nil {
		t.Fatal(err)
	}
	if got != time.Minute {
		t.Fatalf("default poll interval=%s want=1m", got)
	}

	t.Setenv("XD_SOURCE_WORKER_POLL_INTERVAL", "30s")
	got, err = sourceWorkerPollInterval("")
	if err != nil {
		t.Fatal(err)
	}
	if got != 30*time.Second {
		t.Fatalf("env poll interval=%s want=30s", got)
	}

	got, err = sourceWorkerPollInterval("2m")
	if err != nil {
		t.Fatal(err)
	}
	if got != 2*time.Minute {
		t.Fatalf("flag poll interval=%s want=2m", got)
	}

	for _, value := range []string{"broken", "5s", "0s", "-1m"} {
		if _, err := sourceWorkerPollInterval(value); err == nil {
			t.Fatalf("invalid poll interval %q was accepted", value)
		}
	}
}

func TestSourceRunWakeupsReceivesPostgresNotification(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	wakeups := sourceRunWakeups(ctx, dsn)

	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close(context.Background()) }()

	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case _, ok := <-wakeups:
			if !ok {
				t.Fatal("wakeup listener closed before notification")
			}
			return
		case <-ticker.C:
			if _, err := conn.Exec(ctx, "SELECT pg_notify($1, $2)", sourcewake.PostgreSQLChannel, "42"); err != nil {
				t.Fatal(err)
			}
		case <-deadline.C:
			t.Fatal("timed out waiting for source wakeup notification")
		}
	}
}
