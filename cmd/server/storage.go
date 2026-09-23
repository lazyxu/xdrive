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

func runStorageCommand(args []string) error {
	if len(args) == 0 || args[0] != "verify" {
		return fmt.Errorf("usage: xdrive-server storage verify [--json]")
	}
	fs := flag.NewFlagSet("storage verify", flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "write machine-readable JSON")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	report, err := maintenance.Verify(db, cfg.StorageRoot)
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
		fmt.Printf("referenced files:    %d\n", report.ReferencedFiles)
		fmt.Printf("referenced versions: %d\n", report.ReferencedVersions)
		fmt.Printf("blob files:          %d\n", report.BlobFiles)
		fmt.Printf("blob bytes:       %d\n", report.BlobBytes)
		fmt.Printf("missing blobs:    %d\n", len(report.Missing))
		fmt.Printf("size mismatches:  %d\n", len(report.SizeMismatches))
		fmt.Printf("duplicate refs:   %d\n", len(report.DuplicateRefs))
		fmt.Printf("orphan blobs:     %d\n", len(report.Orphans))
		fmt.Printf("ignored temp:     %d\n", report.IgnoredTemps)
		for _, issue := range report.Missing {
			fmt.Printf("MISSING node=%d key=%q expected=%d reason=%s\n", issue.NodeID, issue.StorageKey, issue.Expected, issue.Reason)
		}
		for _, issue := range report.SizeMismatches {
			fmt.Printf("SIZE_MISMATCH node=%d key=%q expected=%d actual=%d\n", issue.NodeID, issue.StorageKey, issue.Expected, issue.Actual)
		}
		for _, issue := range report.DuplicateRefs {
			fmt.Printf("DUPLICATE_REFERENCE key=%q references=%d\n", issue.StorageKey, issue.References)
		}
		for _, issue := range report.Orphans {
			fmt.Printf("ORPHAN key=%q size=%d\n", issue.StorageKey, issue.Size)
		}
	}
	if !report.OK() {
		return fmt.Errorf("storage consistency check failed")
	}
	return nil
}
