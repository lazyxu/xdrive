package main

import (
	"context"
	"errors"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/lazyxu/xdrive/internal/mediaworker"
)

// The independent process never needs the Server's database, credentials,
// source records, storage mount or authentication secret.
func runMediaWorkerCommand(args []string) error {
	if len(args) != 1 || (args[0] != "serve" && args[0] != "check") {
		return errors.New("usage: xdrive-server media-worker <serve|check>")
	}
	socket := strings.TrimSpace(os.Getenv("XD_MEDIA_WORKER_SOCKET"))
	if err := mediaworker.ValidateSocket(socket); err != nil {
		return err
	}
	if args[0] == "serve" {
		ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer cancel()
		return mediaworker.ServeUnix(ctx, socket, nil)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	client, err := mediaworker.NewUnixClient(socket, 1500*time.Millisecond)
	if err != nil {
		return err
	}
	_, err = client.Info(ctx)
	return err
}
