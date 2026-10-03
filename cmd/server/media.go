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

func runMediaCommand(args []string) error {
	if len(args) == 0 || args[0] != "verify" {
		return fmt.Errorf("usage: xdrive-server media verify [--json]")
	}
	return runMediaVerify(args[1:])
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
