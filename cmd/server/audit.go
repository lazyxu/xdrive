package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"strings"

	auditpkg "github.com/lazyxu/xdrive/internal/audit"
)

func runAuditCommand(args []string) error {
	if len(args) == 0 || args[0] != "record" {
		return fmt.Errorf("usage: xdrive-server audit record --action ACTION --result success|failure [--target-id ID] [--metadata-json JSON]")
	}
	fs := flag.NewFlagSet("audit record", flag.ContinueOnError)
	action := fs.String("action", "", "audit action")
	result := fs.String("result", "", "success or failure")
	targetID := fs.String("target-id", "", "optional target identifier")
	metadataJSON := fs.String("metadata-json", "", "optional JSON object metadata")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return fmt.Errorf("unexpected positional arguments")
	}
	switch strings.TrimSpace(*action) {
	case auditpkg.ActionBackup, auditpkg.ActionRestore, auditpkg.ActionUpdate:
	default:
		return fmt.Errorf("unsupported system audit action %q", *action)
	}
	if *result != auditpkg.ResultSuccess && *result != auditpkg.ResultFailure {
		return fmt.Errorf("--result must be success or failure")
	}
	var metadata map[string]any
	if raw := strings.TrimSpace(*metadataJSON); raw != "" {
		if err := json.Unmarshal([]byte(raw), &metadata); err != nil {
			return fmt.Errorf("invalid --metadata-json: %w", err)
		}
		if metadata == nil {
			return fmt.Errorf("--metadata-json must be a JSON object")
		}
	}
	db, err := openAdminDB()
	if err != nil {
		return err
	}
	return auditpkg.Record(db, auditpkg.Event{
		ActorUsername: "host",
		ActorRole:     "system",
		Action:        strings.TrimSpace(*action),
		TargetType:    "system",
		TargetID:      strings.TrimSpace(*targetID),
		Result:        *result,
		Metadata:      metadata,
	})
}
