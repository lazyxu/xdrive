package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/lazyxu/xdrive/internal/config"
	"github.com/lazyxu/xdrive/internal/maintenance"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func runSourceCommand(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: xdrive-server source <verify|repair> [options]")
	}
	switch args[0] {
	case "verify":
		return runSourceVerify(args[1:])
	case "repair":
		return runSourceRepair(args[1:])
	default:
		return fmt.Errorf("usage: xdrive-server source <verify|repair> [options]")
	}
}

func runSourceVerify(args []string) error {
	fs := flag.NewFlagSet("source verify", flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "write machine-readable JSON")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return fmt.Errorf("usage: xdrive-server source verify [--json]")
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	report, err := maintenance.VerifySources(db)
	if err != nil {
		return err
	}
	if *asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(report); err != nil {
			return err
		}
	} else {
		fmt.Printf("sources:     %d\n", report.Sources)
		fmt.Printf("source items:%d\n", report.Items)
		fmt.Printf("bound items: %d\n", report.BoundItems)
		fmt.Printf("issues:      %d\n", len(report.Issues))
		for _, issue := range report.Issues {
			fmt.Printf("SOURCE_BINDING source=%d item=%d external=%q node=%d reason=%s",
				issue.SourceID, issue.SourceItemID, issue.ExternalID, issue.NodeID, issue.Reason)
			if issue.Expected != "" || issue.Actual != "" {
				fmt.Printf(" expected=%q actual=%q", issue.Expected, issue.Actual)
			}
			fmt.Println()
		}
	}
	if !report.OK() {
		return fmt.Errorf("source consistency check failed")
	}
	return nil
}

func runSourceRepair(args []string) error {
	fs := flag.NewFlagSet("source repair", flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "write machine-readable JSON")
	dryRun := fs.Bool("dry-run", false, "show deterministic repairs without changing source bindings")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return fmt.Errorf("usage: xdrive-server source repair [--json] [--dry-run]")
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	report, err := maintenance.RepairSources(context.Background(), db, *dryRun)
	if err != nil {
		return err
	}
	if *asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(report); err != nil {
			return err
		}
	} else {
		fmt.Printf(
			"source repair: dry_run=%t actions=%d skipped=%d before_issues=%d after_issues=%d\n",
			report.DryRun,
			len(report.Actions),
			len(report.Skipped),
			len(report.Before.Issues),
			len(report.After.Issues),
		)
		for _, action := range report.Actions {
			fmt.Printf(
				"REPAIR_SOURCE_BINDING source=%d item=%d external=%q node=%d reasons=%q applied=%t\n",
				action.SourceID,
				action.SourceItemID,
				action.ExternalID,
				action.PreviousNodeID,
				strings.Join(action.Reasons, ","),
				action.Applied,
			)
		}
		for _, issue := range report.Skipped {
			fmt.Printf(
				"SKIP_SOURCE_REPAIR source=%d item=%d external=%q node=%d reason=%s\n",
				issue.SourceID,
				issue.SourceItemID,
				issue.ExternalID,
				issue.NodeID,
				issue.Reason,
			)
		}
	}
	if !*dryRun && !report.After.OK() {
		return fmt.Errorf("source consistency remains inconsistent after repair")
	}
	return nil
}
