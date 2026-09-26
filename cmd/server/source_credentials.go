package main

import (
	"context"
	"flag"
	"fmt"

	"github.com/lazyxu/xdrive/internal/config"
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/sourcecredential"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

const sourceCredentialUsage = "usage: xdrive-server source-credentials <status|rewrap> [--dry-run]"

func runSourceCredentialCommand(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf(sourceCredentialUsage)
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	if err := migrate(db); err != nil {
		return fmt.Errorf("migrate database: %w", err)
	}
	keyring, err := connectorsecret.ParseKeyring(
		cfg.ConnectorSecretActiveVersion,
		cfg.ConnectorSecretKeys,
		cfg.ConnectorSecretLegacyKey,
	)
	if err != nil {
		return err
	}

	switch args[0] {
	case "status":
		if len(args) != 1 {
			return fmt.Errorf("usage: xdrive-server source-credentials status")
		}
		counts, err := sourcecredential.Status(context.Background(), db)
		if err != nil {
			return err
		}
		active := uint32(0)
		versions := []uint32(nil)
		if keyring != nil {
			active = keyring.ActiveVersion()
			versions = keyring.Versions()
		}
		fmt.Printf("active_key_version: %d\n", active)
		fmt.Printf("configured_key_versions: %v\n", versions)
		var total int64
		for _, row := range counts {
			total += row.Count
			fmt.Printf("credential_key_version_%d: %d\n", row.KeyVersion, row.Count)
		}
		fmt.Printf("credentials_total: %d\n", total)
		return nil

	case "rewrap":
		fs := flag.NewFlagSet("source-credentials rewrap", flag.ContinueOnError)
		dryRun := fs.Bool("dry-run", false, "show rewrap count without changing ciphertext")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		if fs.NArg() != 0 {
			return fmt.Errorf("usage: xdrive-server source-credentials rewrap [--dry-run]")
		}
		if keyring == nil {
			return fmt.Errorf("connector secret keyring is not configured")
		}
		report, err := sourcecredential.RewrapAll(context.Background(), db, keyring, *dryRun)
		if err != nil {
			return err
		}
		fmt.Printf("active_key_version: %d\n", report.ActiveVersion)
		fmt.Printf("scanned: %d\n", report.Scanned)
		fmt.Printf("already_active: %d\n", report.AlreadyActive)
		fmt.Printf("rewrapped: %d\n", report.Rewrapped)
		fmt.Printf("dry_run: %t\n", *dryRun)
		return nil

	default:
		return fmt.Errorf(sourceCredentialUsage)
	}
}
