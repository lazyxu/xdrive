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

func runMediaCommand(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: xdrive-server media <verify|repair> [options]")
	}
	switch args[0] {
	case "verify":
		return runMediaVerify(args[1:])
	case "repair":
		return runMediaRepair(args[1:])
	default:
		return fmt.Errorf("usage: xdrive-server media <verify|repair> [options]")
	}
}

func runMediaVerify(args []string) error {
	fs := flag.NewFlagSet("media verify", flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "write machine-readable JSON")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return fmt.Errorf("usage: xdrive-server media verify [--json]")
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	report, err := maintenance.VerifyMediaWithStorageRoot(db, cfg.StorageRoot)
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
		fmt.Printf("media metadata:    %d\n", report.Metadata)
		fmt.Printf("media groups:      %d\n", report.Groups)
		fmt.Printf("media group items: %d\n", report.GroupItems)
		fmt.Printf("derived resources: %d\n", report.DerivedResources)
		fmt.Printf("thumbnails:        %d\n", report.Thumbnails)
		fmt.Printf("issues:            %d\n", len(report.Issues))
		for _, issue := range report.Issues {
			fmt.Printf(
				"MEDIA_INTEGRITY owner=%d node=%d group=%d role=%q storage_key=%q reason=%s",
				issue.OwnerID,
				issue.NodeID,
				issue.GroupID,
				issue.Role,
				issue.StorageKey,
				issue.Reason,
			)
			if issue.Expected != "" || issue.Actual != "" {
				fmt.Printf(" expected=%q actual=%q", issue.Expected, issue.Actual)
			}
			fmt.Println()
		}
	}
	if !report.OK() {
		return fmt.Errorf("media consistency check failed")
	}
	return nil
}

func runMediaRepair(args []string) error {
	fs := flag.NewFlagSet("media repair", flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "write machine-readable JSON")
	dryRun := fs.Bool("dry-run", false, "show deterministic repairs without changing metadata")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return fmt.Errorf("usage: xdrive-server media repair [--json] [--dry-run]")
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	report, err := maintenance.RepairMedia(
		context.Background(),
		db,
		cfg.StorageRoot,
		*dryRun,
	)
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
			"media repair: dry_run=%t thumbnail_actions=%d relation_actions=%d derived_actions=%d skipped=%d before_issues=%d after_issues=%d\n",
			report.DryRun,
			len(report.Actions),
			len(report.RelationActions),
			len(report.DerivedActions),
			len(report.Skipped),
			len(report.Before.Issues),
			len(report.After.Issues),
		)
		for _, action := range report.Actions {
			fmt.Printf(
				"REPAIR_MEDIA_THUMBNAIL owner=%d node=%d storage_key=%q reasons=%q applied=%t\n",
				action.OwnerID,
				action.NodeID,
				action.StorageKey,
				strings.Join(action.Reasons, ","),
				action.Applied,
			)
		}
		for _, action := range report.RelationActions {
			fmt.Printf(
				"REPAIR_MEDIA_RELATIONS owner=%d groups=%v reasons=%q applied=%t\n",
				action.OwnerID,
				action.GroupIDs,
				strings.Join(action.Reasons, ","),
				action.Applied,
			)
		}
		for _, action := range report.DerivedActions {
			fmt.Printf(
				"REPAIR_MEDIA_DERIVED owner=%d node=%d mode=%s reasons=%q applied=%t\n",
				action.OwnerID,
				action.NodeID,
				action.Mode,
				strings.Join(action.Reasons, ","),
				action.Applied,
			)
		}
		for _, issue := range report.Skipped {
			fmt.Printf(
				"SKIP_MEDIA_REPAIR owner=%d node=%d group=%d role=%q reason=%s\n",
				issue.OwnerID,
				issue.NodeID,
				issue.GroupID,
				issue.Role,
				issue.Reason,
			)
		}
	}
	if !*dryRun && !report.After.OK() {
		return fmt.Errorf("media consistency remains inconsistent after repair")
	}
	return nil
}
