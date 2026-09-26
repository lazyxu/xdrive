package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourceagent"
	"github.com/lazyxu/xdrive/internal/sourceagentconfig"
	"github.com/lazyxu/xdrive/internal/sourceagentidentity"
	"github.com/lazyxu/xdrive/internal/version"
)

const defaultIgnoreRules = "@eaDir/\n\\#recycle/\n"

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "login":
		err = login(os.Args[2:])
	case "password":
		err = passwordCmd(os.Args[2:])
	case "setup":
		err = setup(os.Args[2:])
	case "status":
		err = status()
	case "run":
		err = run(os.Args[2:])
	case "logout":
		err = logout()
	case "version":
		fmt.Println(version.String())
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "xdrive-source-agent:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `xDrive Synology source agent

Usage:
  xdrive-source-agent login --server https://drive.example.com --username USER [--password PASS]
  xdrive-source-agent password --current CURRENT --new NEW
  xdrive-source-agent setup --personal /volume1/homes/USER/Photos --shared /volume1/photo [--mode scan|sync] [--target Photos/Synology] [--ignore-file FILE]
  xdrive-source-agent status
  xdrive-source-agent run [--trigger scheduled|manual|reconcile] [--due] [--interval 6h]
  xdrive-source-agent logout
  xdrive-source-agent version

The setup command creates or reuses a Synology Photos push Source. The default mode is scan-only; use --mode sync to enable transfers.
DSM Task Scheduler should invoke "xdrive-source-agent run". Source-side deletion is never propagated to xDrive.`)
}

func login(args []string) error {
	fs := flag.NewFlagSet("login", flag.ContinueOnError)
	server := fs.String("server", "http://localhost:8080", "xDrive server URL")
	username := fs.String("username", "", "username")
	password := fs.String("password", "", "password (or XD_PASSWORD)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	*server = strings.TrimRight(strings.TrimSpace(*server), "/")
	*username = strings.TrimSpace(*username)
	if *username == "" {
		return fmt.Errorf("--username is required")
	}
	if *password == "" {
		*password = os.Getenv("XD_PASSWORD")
	}
	if *password == "" {
		return fmt.Errorf("--password or XD_PASSWORD is required")
	}

	resp, err := client.New(*server, "").Login(context.Background(), *username, *password)
	if err != nil {
		return err
	}
	cfg := sourceagentconfig.Config{Server: *server}
	if old, loadErr := sourceagentconfig.Load(); loadErr == nil &&
		strings.EqualFold(old.Server, *server) && old.Username == resp.Username {
		cfg = old
		cfg.Server = *server
	}
	if err := cfg.ApplyAuth(resp); err != nil {
		return err
	}
	if err := sourceagentconfig.Save(cfg); err != nil {
		return err
	}
	fmt.Printf("logged in as %s\ncredential store: %s\n", resp.Username, sourceagentconfig.CredentialBackend(cfg))
	if resp.MustChangePassword {
		fmt.Println("password change required before source setup/run; use xdrive-source-agent password")
	}
	return nil
}

func passwordCmd(args []string) error {
	fs := flag.NewFlagSet("password", flag.ContinueOnError)
	current := fs.String("current", "", "current password (or XD_PASSWORD)")
	next := fs.String("new", "", "new password (or XD_NEW_PASSWORD)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *current == "" {
		*current = os.Getenv("XD_PASSWORD")
	}
	if *next == "" {
		*next = os.Getenv("XD_NEW_PASSWORD")
	}
	if *current == "" || *next == "" {
		return fmt.Errorf("--current/--new or XD_PASSWORD/XD_NEW_PASSWORD are required")
	}
	cfg, err := sourceagentconfig.Load()
	if err != nil {
		return err
	}
	cli, err := sourceagentconfig.NewClient(cfg)
	if err != nil {
		return err
	}
	resp, err := cli.ChangePassword(context.Background(), *current, *next)
	if err != nil {
		return err
	}
	if err := cfg.ApplyAuth(resp); err != nil {
		return err
	}
	if err := sourceagentconfig.Save(cfg); err != nil {
		return err
	}
	fmt.Println("password changed")
	return nil
}

func setup(args []string) error {
	fs := flag.NewFlagSet("setup", flag.ContinueOnError)
	name := fs.String("name", "Synology Photos", "source display name")
	targetPath := fs.String("target", "Photos/Synology", "xDrive target directory path")
	personal := fs.String("personal", "", "Synology Photos Personal Space filesystem root")
	shared := fs.String("shared", "", "Synology Photos Shared Space filesystem root")
	ignoreFile := fs.String("ignore-file", "", "gitignore-style source ignore rules file")
	runMode := fs.String("mode", "", "source run mode: scan or sync (new sources default to scan)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	*runMode = strings.TrimSpace(*runMode)
	if *runMode != "" && !meta.ValidSourceRunMode(*runMode) {
		return fmt.Errorf("--mode must be scan or sync")
	}
	if strings.TrimSpace(*personal) == "" && strings.TrimSpace(*shared) == "" {
		return fmt.Errorf("at least one of --personal or --shared is required")
	}
	personalID, personalFingerprint, err := validateLocalRoot("personal", *personal)
	if err != nil {
		return fmt.Errorf("personal root: %w", err)
	}
	sharedID, sharedFingerprint, err := validateLocalRoot("shared", *shared)
	if err != nil {
		return fmt.Errorf("shared root: %w", err)
	}

	cfg, err := sourceagentconfig.Load()
	if err != nil {
		return err
	}
	if cfg.MustChangePassword {
		return fmt.Errorf("password change is required before setup")
	}
	cli, err := sourceagentconfig.NewClient(cfg)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	target, err := ensureRemoteDir(ctx, cli, *targetPath)
	if err != nil {
		return err
	}
	rules, err := loadIgnoreRules(*ignoreFile)
	if err != nil {
		return err
	}

	var remote client.Source
	if cfg.SourceID != 0 {
		remote, err = cli.Source(ctx, cfg.SourceID)
		if err != nil && !isNotFound(err) {
			return err
		}
	}
	if remote.ID == 0 {
		sources, listErr := cli.Sources(ctx)
		if listErr != nil {
			return listErr
		}
		for _, candidate := range sources {
			if strings.EqualFold(candidate.Name, strings.TrimSpace(*name)) &&
				candidate.Kind == sourceagent.SynologyKind &&
				candidate.Direction == meta.SourceDirectionPush {
				remote = candidate
				break
			}
		}
	}
	if remote.ID != 0 && strings.TrimSpace(*ignoreFile) == "" {
		rules = remote.IgnoreRules
	}
	effectiveMode := *runMode
	if effectiveMode == "" {
		effectiveMode = meta.SourceRunModeScan
		if remote.ID != 0 && meta.ValidSourceRunMode(remote.RunMode) {
			effectiveMode = remote.RunMode
		}
	}

	if remote.ID == 0 {
		remote, err = cli.CreateSource(ctx, client.CreateSourceInput{
			Name: strings.TrimSpace(*name), Kind: sourceagent.SynologyKind,
			Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
			RunMode: effectiveMode, TargetNodeID: target.ID, IgnoreRules: rules,
		})
		if err != nil {
			return err
		}
	} else {
		if remote.Kind != sourceagent.SynologyKind || remote.Direction != meta.SourceDirectionPush {
			return fmt.Errorf("source %d is not a Synology Photos push source", remote.ID)
		}
		mode := effectiveMode
		active := meta.SourceStatusActive
		sourceName := strings.TrimSpace(*name)
		targetID := target.ID
		remote, err = cli.UpdateSource(ctx, remote.ID, remote.Revision, client.UpdateSourceInput{
			Name: &sourceName, RunMode: &mode, Status: &active,
			TargetNodeID: &targetID, IgnoreRules: &rules,
		})
		if err != nil {
			return err
		}
	}

	cfg.SourceID = remote.ID
	cfg.PersonalRoot = strings.TrimSpace(*personal)
	cfg.PersonalRootID = personalID
	cfg.PersonalRootFingerprint = personalFingerprint
	cfg.SharedRoot = strings.TrimSpace(*shared)
	cfg.SharedRootID = sharedID
	cfg.SharedRootFingerprint = sharedFingerprint
	if err := sourceagentconfig.Save(cfg); err != nil {
		return err
	}
	fmt.Printf("source: %s (%d)\nmode: %s\ntarget node: %d\n", remote.Name, remote.ID, remote.RunMode, target.ID)
	if cfg.PersonalRoot != "" {
		fmt.Printf("personal: %s\n", cfg.PersonalRoot)
	}
	if cfg.SharedRoot != "" {
		fmt.Printf("shared: %s\n", cfg.SharedRoot)
	}
	fmt.Println("setup complete; use xdrive-source-agent run from DSM Task Scheduler")
	return nil
}

func status() error {
	cfg, err := sourceagentconfig.Load()
	if err != nil {
		return err
	}
	cli, err := sourceagentconfig.NewClient(cfg)
	if err != nil {
		return err
	}
	fmt.Printf("server: %s\nuser: %s\ncredential store: %s\n", cfg.Server, cfg.Username, sourceagentconfig.CredentialBackend(cfg))
	if cfg.SourceID == 0 {
		fmt.Println("source: not configured")
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	source, err := cli.Source(ctx, cfg.SourceID)
	if err != nil {
		return err
	}
	fmt.Printf("source: %s (%d)\nstatus: %s\nrun mode: %s\ntarget node: %s\n",
		source.Name, source.ID, source.Status, source.RunMode, optionalID(source.TargetNodeID))
	if source.RunRequestedAt != nil {
		fmt.Printf("manual scan requested: %s\n", source.RunRequestedAt.Format(time.RFC3339))
	}
	if cfg.PersonalRoot != "" {
		fmt.Printf("personal: %s\n", cfg.PersonalRoot)
	}
	if cfg.SharedRoot != "" {
		fmt.Printf("shared: %s\n", cfg.SharedRoot)
	}
	runs, err := cli.SourceRuns(ctx, source.ID, 1)
	if err == nil && len(runs) != 0 {
		run := runs[0]
		fmt.Printf("last run: %s %s; scanned %d (%s), ignored %d, new %d, changed %d, moved %d, missing %d\n",
			run.StartedAt.Format(time.RFC3339), run.Status, run.ScannedItems, formatBytes(run.ScannedBytes),
			run.IgnoredItems, run.NewItems, run.ChangedItems, run.MovedItems, run.MissingItems)
	}
	return nil
}

func run(args []string) error {
	fs := flag.NewFlagSet("run", flag.ContinueOnError)
	trigger := fs.String("trigger", meta.SyncRunTriggerScheduled, "run trigger: scheduled, manual, or reconcile")
	dueOnly := fs.Bool("due", false, "run only when the source is due or has a pending manual request")
	interval := fs.Duration("interval", 6*time.Hour, "scheduled scan interval used with --due")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if !meta.ValidSyncRunTrigger(strings.TrimSpace(*trigger)) {
		return fmt.Errorf("invalid --trigger")
	}
	if *interval <= 0 {
		return fmt.Errorf("--interval must be greater than zero")
	}
	cfg, err := sourceagentconfig.Load()
	if err != nil {
		return err
	}
	if cfg.MustChangePassword {
		return fmt.Errorf("password change is required before run")
	}
	if changed, err := migrateRootFingerprints(&cfg); err != nil {
		return err
	} else if changed {
		if err := sourceagentconfig.Save(cfg); err != nil {
			return fmt.Errorf("save migrated root fingerprints: %w", err)
		}
	}
	if err := cfg.ReadyForRun(); err != nil {
		return err
	}
	identityDir, err := sourceagentconfig.IdentityDir(cfg)
	if err != nil {
		return err
	}
	identityStore, err := sourceagentidentity.Open(identityDir)
	if err != nil {
		return fmt.Errorf("open source identity state: %w", err)
	}
	cli, err := sourceagentconfig.NewClient(cfg)
	if err != nil {
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	remoteSource, err := cli.Source(ctx, cfg.SourceID)
	if err != nil {
		return err
	}
	effectiveTrigger, shouldRun, err := resolveRunTrigger(
		remoteSource, strings.TrimSpace(*trigger), *dueOnly, *interval, time.Now().UTC(),
	)
	if err != nil {
		return err
	}
	if !shouldRun {
		fmt.Println("source not due; no scan started")
		return nil
	}

	scanner := sourceagent.Scanner{
		API: cli, ExecutionAPI: cli, SourceID: cfg.SourceID,
		Roots: sourceagent.RootsWithIdentityState(
			cfg.PersonalRoot, cfg.PersonalRootID, cfg.PersonalRootFingerprint,
			cfg.SharedRoot, cfg.SharedRootID, cfg.SharedRootFingerprint,
		),
		IdentityStore: identityStore,
	}
	result, err := scanner.Run(ctx, effectiveTrigger)
	printRun(result)
	return err
}

func resolveRunTrigger(source client.Source, requested string, dueOnly bool, interval time.Duration, now time.Time) (string, bool, error) {
	requested = strings.TrimSpace(requested)
	if !meta.ValidSyncRunTrigger(requested) {
		return "", false, fmt.Errorf("invalid run trigger")
	}
	if interval <= 0 {
		return "", false, fmt.Errorf("run interval must be greater than zero")
	}
	if dueOnly && source.Status != meta.SourceStatusActive {
		return requested, false, nil
	}
	if requested == meta.SyncRunTriggerScheduled && source.RunRequestedAt != nil {
		return meta.SyncRunTriggerManual, true, nil
	}
	if !dueOnly || requested != meta.SyncRunTriggerScheduled {
		return requested, true, nil
	}
	if source.LastRunAt == nil || !source.LastRunAt.After(now.Add(-interval)) {
		return requested, true, nil
	}
	return requested, false, nil
}

func logout() error {
	cfg, err := sourceagentconfig.Load()
	if err == nil {
		if cli, clientErr := sourceagentconfig.NewClient(cfg); clientErr == nil {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			_ = cli.LogoutSession(ctx)
			cancel()
		}
	}
	if err := sourceagentconfig.Remove(); err != nil {
		return err
	}
	fmt.Println("logged out")
	return nil
}

func ensureRemoteDir(ctx context.Context, cli *client.Client, value string) (client.Node, error) {
	value = strings.Trim(strings.ReplaceAll(strings.TrimSpace(value), "\\", "/"), "/")
	if value == "" {
		return client.Node{}, fmt.Errorf("--target path is required")
	}
	root, err := cli.Root(ctx)
	if err != nil {
		return client.Node{}, err
	}
	current := root
	for _, segment := range strings.Split(value, "/") {
		if err := meta.ValidateName(segment); err != nil {
			return client.Node{}, fmt.Errorf("invalid target path segment %q: %w", segment, err)
		}
		children, err := cli.List(ctx, current.ID)
		if err != nil {
			return client.Node{}, err
		}
		var found *client.Node
		for i := range children {
			if strings.EqualFold(children[i].Name, segment) {
				found = &children[i]
				break
			}
		}
		if found != nil {
			if found.Type != meta.NodeTypeDir {
				return client.Node{}, fmt.Errorf("target path %q collides with a file", segment)
			}
			current = *found
			continue
		}
		current, err = cli.CreateDir(ctx, current.ID, segment)
		if err != nil {
			return client.Node{}, err
		}
	}
	return current, nil
}

func validateLocalRoot(key, value string) (string, string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", "", nil
	}
	abs, err := filepath.Abs(value)
	if err != nil {
		return "", "", err
	}
	legacy, err := sourceagent.RootIdentity(key, abs)
	if err != nil {
		return "", "", err
	}
	fingerprint, err := sourceagent.RootFingerprint(key, abs)
	if err != nil {
		return "", "", err
	}
	return legacy, fingerprint, nil
}

func migrateRootFingerprints(cfg *sourceagentconfig.Config) (bool, error) {
	if cfg == nil {
		return false, fmt.Errorf("source-agent config is required")
	}
	changed := false
	migrate := func(key, root, legacy string, fingerprint *string) error {
		if strings.TrimSpace(root) == "" {
			return nil
		}
		currentLegacy, err := sourceagent.RootIdentity(key, root)
		if err != nil {
			return err
		}
		currentFingerprint, err := sourceagent.RootFingerprint(key, root)
		if err != nil {
			return err
		}
		if strings.TrimSpace(*fingerprint) == "" {
			if currentLegacy != strings.TrimSpace(legacy) {
				_, oldInode, oldOK := sourceagent.ParseLegacyRootIdentity(key, legacy)
				_, currentInode, currentOK := sourceagent.ParseLegacyRootIdentity(key, currentLegacy)
				if !oldOK || !currentOK || oldInode != currentInode ||
					!strings.HasPrefix(currentFingerprint, "root:btime:") {
					return fmt.Errorf("%s root identity changed before fingerprint migration: got %s want %s; run setup again after verifying the Synology volume is mounted", key, currentLegacy, legacy)
				}
			}
			*fingerprint = currentFingerprint
			changed = true
			return nil
		}
		if currentFingerprint != strings.TrimSpace(*fingerprint) {
			return fmt.Errorf("%s root fingerprint changed: got %s want %s; run setup again after verifying the Synology volume is mounted", key, currentFingerprint, *fingerprint)
		}
		return nil
	}
	if err := migrate("personal", cfg.PersonalRoot, cfg.PersonalRootID, &cfg.PersonalRootFingerprint); err != nil {
		return false, err
	}
	if err := migrate("shared", cfg.SharedRoot, cfg.SharedRootID, &cfg.SharedRootFingerprint); err != nil {
		return false, err
	}
	return changed, nil
}

func loadIgnoreRules(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return defaultIgnoreRules, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	if len(data) > 64<<10 {
		return "", fmt.Errorf("ignore file exceeds 64 KiB")
	}
	return string(data), nil
}

func isNotFound(err error) bool {
	var apiErr *client.APIError
	return errors.As(err, &apiErr) && apiErr.Status == http.StatusNotFound
}

func optionalID(id *uint64) string {
	if id == nil {
		return "unavailable"
	}
	return strconv.FormatUint(*id, 10)
}

func printRun(run client.SyncRun) {
	if run.ID == "" {
		return
	}
	fmt.Printf("run: %s\nstatus: %s\n", run.ID, run.Status)
	fmt.Printf("scanned: %d (%s)\n", run.ScannedItems, formatBytes(run.ScannedBytes))
	fmt.Printf("ignored: %d (%s)\n", run.IgnoredItems, formatBytes(run.IgnoredBytes))
	fmt.Printf("new: %d (%s)\n", run.NewItems, formatBytes(run.NewBytes))
	fmt.Printf("changed: %d (%s)\n", run.ChangedItems, formatBytes(run.ChangedBytes))
	fmt.Printf("moved: %d\n", run.MovedItems)
	fmt.Printf("unchanged: %d (%s)\n", run.UnchangedItems, formatBytes(run.UnchangedBytes))
	fmt.Printf("missing: %d (%s)\n", run.MissingItems, formatBytes(run.MissingBytes))
	fmt.Printf("planned transfer: %d (%s)\n", run.PlannedTransferItems, formatBytes(run.PlannedTransferBytes))
	fmt.Printf("committed: created %d, updated %d\n", run.CreatedItems, run.UpdatedItems)
	fmt.Printf("transferred: %d (%s)\n", run.TransferredItems, formatBytes(run.TransferredBytes))
	if run.Error != "" {
		fmt.Printf("error: %s\n", run.Error)
	}
}

func formatBytes(bytes int64) string {
	units := []string{"B", "KiB", "MiB", "GiB", "TiB"}
	value := float64(bytes)
	unit := 0
	for value >= 1024 && unit < len(units)-1 {
		value /= 1024
		unit++
	}
	if unit == 0 || value >= 10 {
		return fmt.Sprintf("%.0f %s", value, units[unit])
	}
	return fmt.Sprintf("%.1f %s", value, units[unit])
}
