package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/lazyxu/xdrive/internal/config"
	"github.com/lazyxu/xdrive/internal/maintenance"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func runSourceCommand(args []string) error {
	if len(args) == 0 || args[0] != "verify" {
		return fmt.Errorf("usage: xdrive-server source verify [--json]")
	}
	return runSourceVerify(args[1:])
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
