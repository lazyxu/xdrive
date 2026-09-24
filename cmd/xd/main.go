package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/mount"
	xupdate "github.com/lazyxu/xdrive/internal/update"
	"github.com/lazyxu/xdrive/internal/userconfig"
	"github.com/lazyxu/xdrive/internal/version"
)

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
	case "logout":
		err = logout()
	case "status":
		err = status()
	case "mount":
		err = mountCmd(os.Args[2:])
	case "config":
		err = configCmd(os.Args[2:])
	case "cleanup":
		err = cleanupCmd()
	case "version":
		fmt.Println(version.String())
	case "update":
		err = updateCmd(os.Args[2:])
	case "doctor":
		err = doctorCmd(os.Args[2:])
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "xd:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `xDrive CLI

Usage:
  xd login --server https://drive.example.com --username USER --password PASS
  xd password --current CURRENT --new NEW
  xd status
  xd config --mount PATH
  xd mount [PATH]
  xd version
  xd update [--channel stable|master|commit] [--commit SHA] [--install]
  xd doctor [--strict]
  xd logout

Accounts are created by an xDrive administrator; self-registration is not supported.
When PATH is omitted, xd uses the configured mount path or ~/xDrive.
On Linux, the path is a FUSE mountpoint. On Windows, it is a CfAPI sync root.`)
}

func login(args []string) error {
	fs := flag.NewFlagSet("login", flag.ContinueOnError)
	server := fs.String("server", "http://localhost:8080", "xDrive server URL")
	username := fs.String("username", "", "username")
	password := fs.String("password", "", "password (or XD_PASSWORD)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *username == "" {
		return fmt.Errorf("--username is required")
	}
	if *password == "" {
		*password = os.Getenv("XD_PASSWORD")
	}
	if *password == "" {
		return fmt.Errorf("--password or XD_PASSWORD is required")
	}
	cli := client.New(strings.TrimRight(*server, "/"), "")
	resp, err := cli.Login(context.Background(), *username, *password)
	if err != nil {
		return err
	}
	mountPath := ""
	sessionID := ""
	var syncRules []userconfig.SyncRule
	var cacheLimitBytes int64
	if existing, loadErr := userconfig.Load(); loadErr == nil {
		mountPath = existing.MountPath
		sessionID = existing.SessionID
		cacheLimitBytes = existing.CacheLimitBytes
		if strings.EqualFold(strings.TrimRight(existing.Server, "/"), strings.TrimRight(*server, "/")) &&
			existing.Username == resp.Username {
			syncRules = append([]userconfig.SyncRule(nil), existing.SyncRules...)
		}
	}
	cfg := userconfig.Config{
		Server:          strings.TrimRight(*server, "/"),
		MountPath:       mountPath,
		SessionID:       sessionID,
		SyncRules:       syncRules,
		CacheLimitBytes: cacheLimitBytes,
	}
	if err := cfg.ApplyAuth(resp, true); err != nil {
		return err
	}
	if err := userconfig.Save(cfg); err != nil {
		return err
	}
	root, err := userconfig.EffectiveMountPath(cfg)
	if err != nil {
		return err
	}
	fmt.Printf("logged in as %s\nmount path: %s\n", resp.Username, root)
	if resp.MustChangePassword {
		fmt.Println("administrator requires a password change before sync can start; run: xd password --current CURRENT --new NEW")
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
	cfg, err := userconfig.Load()
	if err != nil {
		return err
	}
	cli, err := userconfig.NewClient(cfg)
	if err != nil {
		return err
	}
	resp, err := cli.ChangePassword(context.Background(), *current, *next)
	if err != nil {
		return err
	}
	latest, err := userconfig.Load()
	if err != nil {
		latest = cfg
	}
	if err := latest.ApplyAuth(resp, false); err != nil {
		return err
	}
	if err := userconfig.Save(latest); err != nil {
		return err
	}
	fmt.Println("password changed; existing sessions were revoked and this client received a new session")
	return nil
}

func logout() error {
	cfg, err := userconfig.Load()
	if err == nil {
		if cli, clientErr := userconfig.NewClient(cfg); clientErr == nil {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			_ = cli.LogoutSession(ctx)
			cancel()
		}
	}
	if err := userconfig.Remove(); err != nil {
		return err
	}
	fmt.Println("logged out; the background agent will stop the active mount")
	return nil
}

func formatStorageBytes(bytes int64) string {
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

func status() error {
	cfg, err := userconfig.Load()
	if err != nil {
		return err
	}
	cli, err := userconfig.NewClient(cfg)
	if err != nil {
		return err
	}
	quota, err := cli.Quota(context.Background())
	if err != nil {
		return err
	}
	root, err := cli.Root(context.Background())
	if err != nil {
		return err
	}
	children, err := cli.List(context.Background(), root.ID)
	if err != nil {
		return err
	}
	mountPath, err := userconfig.EffectiveMountPath(cfg)
	if err != nil {
		return err
	}
	quotaLimit := "unlimited"
	if quota.QuotaBytes > 0 {
		quotaLimit = formatStorageBytes(quota.QuotaBytes)
	}
	cacheLimit := "unlimited"
	if cfg.CacheLimitBytes > 0 {
		cacheLimit = formatStorageBytes(cfg.CacheLimitBytes)
	}
	fmt.Printf("server: %s\nuser: %s\nmount: %s\ncredential store: %s\nroot items: %d\nstorage: %s / %s\nstorage detail: files %s, trash %s, history %s\nlocal cache limit: %s\nselective sync rules: %d\nclient version: %s\n",
		cfg.Server, cfg.Username, mountPath, userconfig.CredentialBackend(cfg), len(children),
		formatStorageBytes(quota.PhysicalUsedBytes), quotaLimit,
		formatStorageBytes(quota.LogicalFileBytes), formatStorageBytes(quota.TrashBytes), formatStorageBytes(quota.HistoryBytes),
		cacheLimit, len(cfg.SyncRules), version.String())
	return nil
}

func configCmd(args []string) error {
	fs := flag.NewFlagSet("config", flag.ContinueOnError)
	mountPath := fs.String("mount", "", "default mount/sync-root path")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*mountPath) == "" {
		return fmt.Errorf("--mount PATH is required")
	}
	cfg, err := userconfig.Load()
	if err != nil {
		return err
	}
	abs, err := filepath.Abs(*mountPath)
	if err != nil {
		return err
	}
	cfg.MountPath = filepath.Clean(abs)
	if err := userconfig.Save(cfg); err != nil {
		return err
	}
	fmt.Printf("mount path: %s\n", cfg.MountPath)
	fmt.Println("the background agent will apply the new path automatically")
	return nil
}

func mountCmd(args []string) error {
	fs := flag.NewFlagSet("mount", flag.ContinueOnError)
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() > 1 {
		return fmt.Errorf("mount accepts zero or one PATH")
	}
	cfg, err := userconfig.Load()
	if err != nil {
		return err
	}
	if cfg.MustChangePassword {
		return fmt.Errorf("password change required; run xd password first")
	}
	var path string
	if fs.NArg() == 1 {
		path, err = filepath.Abs(fs.Arg(0))
	} else {
		path, err = userconfig.EffectiveMountPath(cfg)
	}
	if err != nil {
		return err
	}
	if err := os.MkdirAll(path, 0o755); err != nil {
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	cli, err := userconfig.NewClient(cfg)
	if err != nil {
		return err
	}
	fmt.Printf("xDrive mounted at %s; press Ctrl+C to stop\n", path)
	return mount.RunWithOptions(ctx, cli, path, mountOptionsFromConfig(cfg))
}

func mountOptionsFromConfig(cfg userconfig.Config) mount.Options {
	opts := mount.Options{CacheLimitBytes: cfg.CacheLimitBytes}
	for _, rule := range cfg.SyncRules {
		switch rule.Mode {
		case userconfig.SyncModeExclude:
			opts.ExcludedPaths = append(opts.ExcludedPaths, rule.Path)
		case userconfig.SyncModeAlwaysLocal:
			opts.AlwaysLocalPaths = append(opts.AlwaysLocalPaths, rule.Path)
		}
	}
	return opts
}

func cleanupCmd() error {
	cfg, err := userconfig.Load()
	if err != nil {
		return nil
	}
	root, err := userconfig.EffectiveMountPath(cfg)
	if err != nil {
		return err
	}
	return mount.Cleanup(root)
}

func updateCmd(args []string) error {
	fs := flag.NewFlagSet("update", flag.ContinueOnError)
	install := fs.Bool("install", false, "install the available update now")
	channelFlag := fs.String("channel", "", "update channel: stable, master, or commit")
	commitFlag := fs.String("commit", "", "commit SHA for the commit channel")
	if err := fs.Parse(args); err != nil {
		return err
	}

	current := version.String()
	channel := strings.TrimSpace(*channelFlag)
	commit := strings.TrimSpace(*commitFlag)
	if channel == "" && commit != "" {
		channel = xupdate.ChannelCommit
	}
	if channel == "" {
		var err error
		channel, commit, err = xupdate.AutomaticTarget(current)
		if err != nil {
			return err
		}
	}
	if channel == "" {
		fmt.Printf("client version: %s\n", current)
		fmt.Println("this development build has no automatic channel; use: xd update --channel master")
		return nil
	}
	normalized, err := xupdate.NormalizeChannel(channel)
	if err != nil {
		return err
	}
	if normalized == xupdate.ChannelCommit && commit == "" {
		return fmt.Errorf("--commit SHA is required for commit channel")
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	if *install {
		started, installed, err := xupdate.InstallTargetWithProgress(ctx, current, normalized, commit, func(event xupdate.ProgressEvent) {
			fmt.Println(xupdate.FormatProgress(event))
		})
		if err != nil {
			return err
		}
		if started {
			fmt.Printf("updated target verified: %s from %s channel; installer started\n", installed.Latest, normalized)
		}
		return nil
	}

	fmt.Printf("[update 1/1] check: checking %s channel from %s\n", normalized, current)
	result, err := xupdate.CheckTarget(ctx, current, normalized, commit)
	if err != nil {
		return err
	}
	if !result.UpdateAvailable {
		fmt.Printf("xDrive %s is current on %s channel\n", current, normalized)
		return nil
	}
	fmt.Printf("update available on %s: %s -> %s\n", normalized, current, result.Latest)
	if result.Asset.Size > 0 {
		fmt.Printf("download: %s (%s)\n", result.Asset.Name, formatStorageBytes(result.Asset.Size))
	}
	if normalized == xupdate.ChannelCommit {
		fmt.Printf("run: xd update --channel commit --commit %s --install\n", result.Commit)
	} else {
		fmt.Printf("run: xd update --channel %s --install\n", normalized)
	}
	return nil
}
