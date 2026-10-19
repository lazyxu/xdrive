package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/lazyxu/xdrive/internal/api"
	"github.com/lazyxu/xdrive/internal/config"
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

const caddyHostAdoptMaxBytes = 1024

// A private CLI invocation from the trusted installer, not an API route.
// The four NUL-terminated fields are domain, private IP, AliDNS ID and
// AliDNS secret. Credentials NEVER appear in argv, stdout, or an audit event.
func parseCaddyHostAdoptStdin(raw []byte) (api.CaddyHostDeploymentImport, error) {
	if len(raw) == 0 || len(raw) > caddyHostAdoptMaxBytes {
		return api.CaddyHostDeploymentImport{}, errors.New("invalid bounded Caddy host import input")
	}
	fields := bytes.Split(raw, []byte{0})
	if len(fields) != 5 || len(fields[4]) != 0 {
		return api.CaddyHostDeploymentImport{}, errors.New("invalid Caddy host import fields")
	}
	return api.CaddyHostDeploymentImport{
		Domain: string(fields[0]), LANIP: string(fields[1]),
		AliDNSAccessKeyID: string(fields[2]), AliDNSAccessSecret: string(fields[3]),
	}, nil
}

func runCaddyHostCommand(args []string) error {
	if len(args) != 1 || args[0] != "adopt-stdin" {
		return errors.New("usage: xdrive-server caddy-host adopt-stdin (trusted installer stdin only)")
	}
	raw, readErr := io.ReadAll(io.LimitReader(os.Stdin, caddyHostAdoptMaxBytes+1))
	if readErr != nil {
		return errors.New("cannot read trusted Caddy host import input")
	}
	defer clear(raw)
	input, err := parseCaddyHostAdoptStdin(raw)
	if err != nil {
		return err
	}
	cfg, err := config.Load()
	if err != nil {
		return errors.New("Caddy host adoption service configuration unavailable")
	}
	ring, err := connectorsecret.ParseKeyring(
		cfg.ConnectorSecretActiveVersion, cfg.ConnectorSecretKeys,
		cfg.ConnectorSecretLegacyKey,
	)
	if err != nil {
		return errors.New("Caddy host adoption encryption keyring unavailable")
	}
	db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{})
	if err != nil {
		return errors.New("Caddy host adoption database unavailable")
	}
	// The existing running Server must already have run its normal schema
	// migration. Import refuses missing tables instead of bypassing a failed
	// upgrade or writing into an incompatible schema.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	state, err := api.ImportCaddyHostDeployment(ctx, db, ring, input)
	if err != nil {
		return errors.New("Caddy host adoption was blocked; original host configuration was not changed")
	}
	fmt.Printf("Caddy System Dependencies adoption: %s\n", state)
	return nil
}
