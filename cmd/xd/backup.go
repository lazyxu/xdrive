package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
	"github.com/lazyxu/xdrive/internal/sourceschedule"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

const (
	backupPollDefault         = 2 * time.Second
	backupAgentStartupTimeout = 10 * time.Second
)

func backupUsage(w io.Writer) {
	fmt.Fprintln(w, "Backup-only (the same owning xdrive-agent Runner as Desktop):")
	fmt.Fprintln(w, "  xd backup once --source ID [--poll 2s]")
	fmt.Fprintln(w, "  xd backup auto --source ID [--every 6h]")
	fmt.Fprintln(w, "  xd backup auto --source ID --cron '0 2 * * *' --timezone Asia/Tokyo")
	fmt.Fprintln(w, "  xd backup schedule --source ID --manual")
	fmt.Fprintln(w, "  xd backup list")
	fmt.Fprintln(w, "  xd backup status --source ID")
	fmt.Fprintln(w, "  xd backup history --source ID")
	fmt.Fprintln(w, "  xd backup pause --source ID")
	fmt.Fprintln(w, "  xd backup cancel --source ID")
	fmt.Fprintln(w, "  xd backup agent  (run the owning Agent in foreground for a service manager)")
	fmt.Fprintln(w, "Only existing, device-bound Backup-only Sources are accepted. Run once")
	fmt.Fprintln(w, "AFTER setting auto; scheduling changes the Source revision and requires\na verified partial checkpoint from a fresh explicit run.")
	fmt.Fprintln(w, "The Agent must stay running for unattended schedules (and start on login/boot).")
	fmt.Fprintln(w, "Stopping xd during an upload only stops observing, not the Agent worker.")
}

// Only the read-only Source index is unscoped. Every Source operation
// must carry an explicit positive owning Source ID, not a pathname/target.
func validBackupSourceSelector(action string, id uint64, provided bool) bool {
	if action == "list" {
		return !provided && id == 0
	}
	return provided && localbackupipc.ValidSourceID(id)
}

func backupCmd(args []string) error {
	if len(args) == 0 || args[0] == "help" {
		backupUsage(os.Stdout)
		return nil
	}
	if runtime.GOOS != "linux" && runtime.GOOS != "windows" {
		return errors.New("Backup-only requires the owning Linux/Windows xdrive-agent")
	}
	action := args[0]
	if action == "agent" {
		if len(args) != 1 {
			return errors.New("xd backup agent does not accept a Source ID or options")
		}
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
		defer stop()
		return runBackupAgentForeground(ctx)
	}
	if action != "once" && action != "auto" && action != "schedule" &&
		action != "status" && action != "history" && action != "list" && action != "pause" &&
		action != "cancel" {
		backupUsage(os.Stderr)
		return fmt.Errorf("unknown Backup-only action %q", action)
	}

	fs := flag.NewFlagSet("backup "+action, flag.ContinueOnError)
	id := fs.Uint64("source", 0, "existing owning Backup-only Source ID")
	poll := fs.Duration("poll", backupPollDefault, "once: progress refresh interval")
	every := fs.String("every", "", "auto: interval, e.g. 1h, 6h, 24h")
	cron := fs.String("cron", "", "auto: five-field cron expression")
	zone := fs.String("timezone", "", "cron IANA timezone, e.g. Asia/Tokyo")
	manual := fs.Bool("manual", false, "disable automatic scheduling (not Backup-only itself)")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	sourceProvided := false
	fs.Visit(func(f *flag.Flag) {
		if f.Name == "source" {
			sourceProvided = true
		}
	})
	if fs.NArg() != 0 || !validBackupSourceSelector(action, *id, sourceProvided) {
		return errors.New("backup list takes no --source; other actions require a positive --source ID, and no positional paths/targets are accepted")
	}
	if action != "auto" && action != "schedule" &&
		(*every != "" || *cron != "" || *zone != "" || *manual) {
		return errors.New("schedule options are valid only for backup auto/schedule")
	}
	if action != "once" && *poll != backupPollDefault {
		return errors.New("--poll is available only for backup once")
	}
	if *poll < 250*time.Millisecond || *poll > time.Minute {
		return errors.New("--poll must be between 250ms and 1m")
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	client, err := connectOwningBackupAgent(ctx)
	if err != nil {
		return err
	}
	switch action {
	case "once":
		return runBackupOnce(ctx, client, *id, *poll, os.Stdout)
	case "auto", "schedule":
		spec, err := parseBackupSchedule(action, *every, *cron, *zone, *manual)
		if err != nil {
			return err
		}
		ctxRead, done := context.WithTimeout(ctx, 30*time.Second)
		defer done()
		previous, err := client.ReadSchedule(ctxRead, *id)
		if err != nil {
			return err
		}
		saved, err := client.SaveSchedule(ctxRead, *id, previous.Revision,
			localbackupipc.Schedule{SourceID: *id, ScheduleType: spec.Type,
				ScheduleExpression: spec.Expression, ScheduleTimezone: spec.Timezone})
		if err != nil {
			return err
		}
		fmt.Printf("Source %d: %s %s %s (revision %d)\n",
			*id, saved.ScheduleType, saved.ScheduleExpression, saved.ScheduleTimezone, saved.Revision)
		if saved.ScheduleType != "manual" {
			fmt.Println("After saving a schedule, run: xd backup once --source " + strconv.FormatUint(*id, 10))
			fmt.Println("The schedule changes Source revision; automatic admission requires a fresh verified partial checkpoint.")
			fmt.Println("Keep xdrive-agent running; use 'xd backup agent' under your service manager to survive reboots.")
		}
		return nil
	case "list":
		check, done := context.WithTimeout(ctx, 30*time.Second)
		defer done()
		items, err := client.Sources(check)
		if err != nil {
			return err
		}
		found := 0
		for _, item := range items {
			if item.Kind != "local_folder" || item.Direction != "push" ||
				item.SyncMode != "backup" || !localbackupipc.ValidSourceID(item.ID) {
				continue
			}
			read, finish := context.WithTimeout(ctx, 30*time.Second)
			_, scopeErr := client.ReadSchedule(read, item.ID)
			finish()
			if scopeErr != nil {
				continue // another device's Source is read-only, never shown as writable
			}
			fmt.Printf("%d  %s\n", item.ID, item.Name)
			found++
		}
		if found == 0 {
			fmt.Println("No authorized local Backup-only Sources. Configure an owning Source first.")
		}
		return nil
	case "status":
		check, done := context.WithTimeout(ctx, 30*time.Second)
		defer done()
		status, err := client.Status(check, *id)
		if err != nil {
			return err
		}
		printBackupSummary(os.Stdout, status)
		return nil
	case "history":
		check, done := context.WithTimeout(ctx, 30*time.Second)
		defer done()
		history, err := client.History(check, *id)
		if err != nil {
			return err
		}
		for _, item := range history.Items {
			fmt.Printf("%s %s inspected=%d uploaded=%d unchanged=%d unsupported=%d uncertain=%d bytes=%d\n",
				item.FinishedAt.Format(time.RFC3339), item.State, item.InspectedFiles,
				item.ConfirmedFiles, item.SkippedFiles, item.UnsupportedFiles,
				item.UncertainFiles, item.ConfirmedBytes)
		}
		if len(history.Items) == 0 {
			fmt.Println("No local Backup-only attempts yet.")
		}
		return nil
	case "pause", "cancel":
		check, done := context.WithTimeout(ctx, 30*time.Second)
		defer done()
		status, err := client.Control(check, *id, action)
		if err != nil {
			return err
		}
		printBackupSummary(os.Stdout, status)
		fmt.Println("Only new file scheduling was stopped; an in-flight upload is not physically cancelled.")
		return nil
	}
	return errors.New("unknown backup action")
}

func parseBackupSchedule(action, every, cron, zone string, manual bool) (sourceschedule.Spec, error) {
	if manual {
		if every != "" || cron != "" || zone != "" {
			return sourceschedule.Spec{}, errors.New("--manual cannot be combined with an interval, cron or timezone")
		}
		return sourceschedule.Normalize("manual", "", "")
	}
	if cron != "" {
		if every != "" {
			return sourceschedule.Spec{}, errors.New("--every and --cron are mutually exclusive")
		}
		return sourceschedule.Normalize("cron", cron, zone)
	}
	if zone != "" {
		return sourceschedule.Spec{}, errors.New("--timezone is only valid with --cron")
	}
	if every == "" && action == "auto" {
		every = "6h"
	}
	if every == "" {
		return sourceschedule.Spec{}, errors.New("specify --every, --cron, or --manual")
	}
	return sourceschedule.Normalize("interval", every, "")
}

type backupOnceRunner interface {
	Start(context.Context, uint64) (localbackupipc.Summary, error)
	Status(context.Context, uint64) (localbackupipc.Summary, error)
}

func runBackupOnce(ctx context.Context, runner backupOnceRunner, id uint64, poll time.Duration, out io.Writer) error {
	if runner == nil || ctx == nil || ctx.Err() != nil ||
		!localbackupipc.ValidSourceID(id) || poll < 250*time.Millisecond {
		return errors.New("invalid Backup-only once arguments")
	}
	startCtx, done := context.WithTimeout(ctx, 30*time.Second)
	summary, err := runner.Start(startCtx, id)
	done()
	if err != nil {
		return err
	}
	printBackupSummary(out, summary)
	if !summary.Running {
		return backupTerminalResult(summary)
	}
	ticker := time.NewTicker(poll)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return errors.New("observer stopped; owning Agent backup continues or retains its original durable result")
		case <-ticker.C:
			check, finish := context.WithTimeout(ctx, 30*time.Second)
			summary, err = runner.Status(check, id)
			finish()
			if err != nil {
				return fmt.Errorf("status read unavailable; original Agent task may continue: %w", err)
			}
			printBackupSummary(out, summary)
			if !summary.Running {
				return backupTerminalResult(summary)
			}
		}
	}
}

func printBackupSummary(w io.Writer, s localbackupipc.Summary) {
	fmt.Fprintf(w, "Source %d: %s inspected=%d uploaded=%d unchanged=%d unsupported=%d uncertain=%d bytes=%d",
		s.SourceID, s.State, s.InspectedFiles, s.ConfirmedFiles, s.SkippedFiles,
		s.UnsupportedFiles, s.UncertainFiles, s.ConfirmedBytes)
	if s.StopRequested != "" {
		fmt.Fprintf(w, " requested=%s", s.StopRequested)
	}
	fmt.Fprintln(w)
}

func backupTerminalResult(s localbackupipc.Summary) error {
	if s.State != "partial" || s.UncertainFiles != 0 || s.UnsupportedFiles != 0 ||
		s.ConfirmedFiles+s.SkippedFiles != s.InspectedFiles {
		return fmt.Errorf("Source %d: file-level backup finished with %s or unsupported/unverified items; see status/history",
			s.SourceID, s.State)
	}
	// Per-file receipts, not backup_complete or present-day physical CAS.
	return nil
}

func connectOwningBackupAgent(ctx context.Context) (*localbackupipc.Client, error) {
	dir, err := userconfig.Dir()
	if err != nil {
		return nil, err
	}
	client, err := localbackupipc.Connect(ctx, dir)
	if err == nil {
		return client, nil
	}
	if !errors.Is(err, localbackupipc.ErrAgentUnavailable) {
		return nil, err // unsafe discovery / wrong identity must NOT launch another Agent
	}
	if err := spawnOwningAgent(); err != nil {
		return nil, err
	}
	started, cancel := context.WithTimeout(ctx, backupAgentStartupTimeout)
	defer cancel()
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		client, err := localbackupipc.Connect(started, dir)
		if err == nil {
			return client, nil
		}
		if !errors.Is(err, localbackupipc.ErrAgentUnavailable) {
			return nil, err
		}
		select {
		case <-started.Done():
			return nil, errors.New("xdrive-agent did not become ready; check its local log")
		case <-ticker.C:
		}
	}
}

func owningAgentCandidates() []string {
	if override := strings.TrimSpace(os.Getenv("XD_AGENT_PATH")); override != "" {
		return []string{override}
	}
	name := "xdrive-agent"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	var candidates []string
	if self, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(self), name))
	}
	if runtime.GOOS == "windows" {
		candidates = append(candidates, filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "xDrive", name))
	} else {
		candidates = append(candidates, "/usr/bin/xdrive-agent")
	}
	candidates = append(candidates, name)
	return candidates
}

func findOwningAgent() (string, error) {
	for _, candidate := range owningAgentCandidates() {
		abs, err := exec.LookPath(candidate)
		if err == nil {
			return abs, nil
		}
	}
	return "", errors.New("xdrive-agent executable is missing (install Desktop/Agent or set XD_AGENT_PATH)")
}

func spawnOwningAgent() error {
	command, err := findOwningAgent()
	if err != nil {
		return err
	}
	process := exec.Command(command)
	process.SysProcAttr = backupDetachedProcessAttr()
	null, err := os.OpenFile(os.DevNull, os.O_RDWR, 0)
	if err != nil {
		return err
	}
	defer null.Close()
	process.Stdin, process.Stdout, process.Stderr = null, null, null
	if err := process.Start(); err != nil {
		return fmt.Errorf("start owning Agent: %w", err)
	}
	return process.Process.Release()
}

func runBackupAgentForeground(ctx context.Context) error {
	dir, err := userconfig.Dir()
	if err != nil {
		return err
	}
	if _, err := localbackupipc.Connect(ctx, dir); err == nil {
		return errors.New("xdrive-agent is already running; use xd backup status/auto")
	} else if !errors.Is(err, localbackupipc.ErrAgentUnavailable) {
		return err
	}
	binary, err := findOwningAgent()
	if err != nil {
		return err
	}
	command := exec.CommandContext(ctx, binary)
	command.Stdout, command.Stderr = os.Stdout, os.Stderr
	return command.Run()
}

// Useful for scripts which already store a positive Source ID.
func parseBackupSourceID(s string) (uint64, error) {
	value, err := strconv.ParseUint(s, 10, 64)
	if err != nil || !localbackupipc.ValidSourceID(value) {
		return 0, errors.New("invalid Backup-only Source ID")
	}
	return value, nil
}
