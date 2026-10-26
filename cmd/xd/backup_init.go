package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
	"github.com/lazyxu/xdrive/internal/sourceschedule"
)

type backupBootstrapAgent interface {
	PreflightLocalRoot(context.Context, string) error
	CreateLocalBackupSource(context.Context, string, uint64) (localbackupipc.LocalBackupSource, error)
	AuthorizeLocalRoot(context.Context, uint64, string) (localbackupipc.LocalBackupRootGrant, error)
	ReadSchedule(context.Context, uint64) (localbackupipc.Schedule, error)
	SaveSchedule(context.Context, uint64, uint64, localbackupipc.Schedule) (localbackupipc.Schedule, error)
}

// The CLI and Desktop reuse one owning Agent; run-now adds no upload or
// scheduler implementation. Bootstrap permissions are checked before Start.
type backupBootstrapOnceAgent interface {
	backupBootstrapAgent
	backupOnceRunner
}

func normalizedExplicitBackupPath(path string) (string, error) {
	if !filepath.IsAbs(path) {
		return "", errors.New("--path must be an explicit absolute directory on the owning device")
	}
	clean := filepath.Clean(path)
	if !localbackupipc.ValidLocalBackupPath(clean) {
		return "", errors.New("invalid local Backup-only directory path")
	}
	return clean, nil
}

// runBackupInit is intentionally a short series of authenticated owning-Agent
// operations, not a separate Runner. No repeat-on-timeout or silent adoption
// of orphan/foreign drafts is permitted.
func runBackupInit(ctx context.Context, agent backupBootstrapAgent, name, path string,
	targetID uint64, spec sourceschedule.Spec, out io.Writer,
) (uint64, error) {
	name = strings.TrimSpace(name)
	if ctx == nil || ctx.Err() != nil || agent == nil || out == nil ||
		name == "" || len([]byte(name)) > 128 ||
		!localbackupipc.ValidSourceID(targetID) ||
		!localbackupipc.ValidLocalBackupPath(path) {
		return 0, errors.New("name, authorized local path and existing cloud target ID are required")
	}
	if spec.Type != "" && spec.Type != sourceschedule.TypeManual {
		normalized, err := sourceschedule.Normalize(spec.Type, spec.Expression, spec.Timezone)
		if err != nil || normalized != spec {
			return 0, errors.New("invalid automatic Backup-only schedule")
		}
	}
	if err := agent.PreflightLocalRoot(ctx, path); err != nil {
		return 0, fmt.Errorf("local directory preflight failed before creating Source: %w", err)
	}
	created, err := agent.CreateLocalBackupSource(ctx, name, targetID)
	if err != nil {
		return 0, fmt.Errorf("Source creation result is unknown; inspect 'xd backup drafts' before trying again: %w", err)
	}
	id := created.ID
	grant, err := agent.AuthorizeLocalRoot(ctx, id, path)
	if err != nil {
		return id, fmt.Errorf("Source %d remains a paused draft; use 'xd backup bind --source %d --path ABS_DIR' to retry: %w", id, id, err)
	}
	if grant.SourceID != id || grant.Status != "awaiting_executor" {
		return id, fmt.Errorf("Source %d local Root binding was not authenticated", id)
	}
	if spec.Type != "" && spec.Type != sourceschedule.TypeManual {
		schedule, err := agent.ReadSchedule(ctx, id)
		if err != nil {
			return id, fmt.Errorf("Source %d is bound but schedule read failed; configure 'xd backup auto' separately: %w", id, err)
		}
		_, err = agent.SaveSchedule(ctx, id, schedule.Revision, localbackupipc.Schedule{
			SourceID: id, ScheduleType: spec.Type,
			ScheduleExpression: spec.Expression, ScheduleTimezone: spec.Timezone,
		})
		if err != nil {
			return id, fmt.Errorf("Source %d is bound but schedule save is unconfirmed; inspect schedule before retrying: %w", id, err)
		}
	}
	fmt.Fprintf(out, "Source %d: locally authorized Backup-only folder (no Desktop required)\n", id)
	fmt.Fprintf(out, "Run now: xd backup once --source %d\n", id)
	if spec.Type != "" && spec.Type != sourceschedule.TypeManual {
		fmt.Fprintln(out, "This first verified run arms automatic scheduling for the saved Source revision.")
	}
	return id, nil
}

// A successful setup alone never claims a backed-up file. With explicit
// --run-now the existing Agent Start/Status produces the ordinary per-file
// result; on failure the authorized Source remains available for inspection.
func runBackupInitAndMaybeOnce(ctx context.Context, agent backupBootstrapOnceAgent,
	name, path string, targetID uint64, spec sourceschedule.Spec,
	runNow bool, out io.Writer,
) (uint64, error) {
	id, err := runBackupInit(ctx, agent, name, path, targetID, spec, out)
	if err != nil || !runNow {
		return id, err
	}
	fmt.Fprintf(out, "Starting explicit owning-Agent incremental run for Source %d\n", id)
	return id, runBackupOnce(ctx, agent, id, backupPollDefault, out)
}

func backupBootstrapCmd(args []string) error {
	if len(args) == 0 {
		return errors.New("missing bootstrap action")
	}
	action := args[0]
	if action != "init" && action != "bind" && action != "drafts" {
		return errors.New("unsupported Backup-only bootstrap command")
	}
	fs := flag.NewFlagSet("backup "+action, flag.ContinueOnError)
	name := fs.String("name", "", "init: name of the new local Backup-only Source")
	localPath := fs.String("path", "", "explicit absolute local directory on this device")
	target := fs.Uint64("target-id", 0, "init: existing owner-authorized cloud directory Node ID")
	source := fs.Uint64("source", 0, "bind: existing paused Source created by this owning device")
	every := fs.String("every", "", "init: optional interval such as 6h")
	cron := fs.String("cron", "", "init: optional five-field cron schedule")
	zone := fs.String("timezone", "", "init: optional IANA timezone for --cron")
	runNow := fs.Bool("run-now", false, "init: explicitly run first incremental backup after native Root binding")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	if err := validateBackupCLIFlags(fs, action); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New("unexpected positional argument")
	}
	switch action {
	case "init":
		if !localbackupipc.ValidSourceID(*target) {
			return errors.New("init requires --target-id and does not accept --source")
		}
	case "bind":
		if !localbackupipc.ValidSourceID(*source) {
			return errors.New("bind requires --source and --path only")
		}
	}
	var path string
	var err error
	if action != "drafts" {
		path, err = normalizedExplicitBackupPath(*localPath)
		if err != nil {
			return err
		}
	}
	var spec sourceschedule.Spec
	if action == "init" {
		if *every != "" || *cron != "" || *zone != "" {
			spec, err = parseBackupSchedule("schedule", *every, *cron, *zone, false)
			if err != nil {
				return err
			}
		}
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	agent, err := connectOwningBackupAgent(ctx)
	if err != nil {
		return err
	}
	switch action {
	case "init":
		_, err = runBackupInitAndMaybeOnce(ctx, agent, *name, path, *target, spec, *runNow, os.Stdout)
		return err
	case "bind":
		scoped, done := context.WithTimeout(ctx, 2*time.Minute)
		defer done()
		if err := agent.PreflightLocalRoot(scoped, path); err != nil {
			return err
		}
		if _, err := agent.AuthorizeLocalRoot(scoped, *source, path); err != nil {
			return err
		}
		fmt.Printf("Source %d: native Root bound; run 'xd backup once --source %d'\n", *source, *source)
		return nil
	case "drafts":
		scoped, done := context.WithTimeout(ctx, 30*time.Second)
		defer done()
		drafts, err := agent.LocalDrafts(scoped)
		if err != nil {
			return err
		}
		for _, item := range drafts {
			fmt.Printf("%d  %s (revision %d)\n", item.SourceID, item.Name, item.Revision)
		}
		if len(drafts) == 0 {
			fmt.Println("No recoverable unbound Sources on this owning device.")
		}
		return nil
	}
	return errors.New("unknown bootstrap command " + strconv.Quote(action))
}
