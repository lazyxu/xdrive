package main

import (
	"context"
	"flag"
	"fmt"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	humanize "github.com/dustin/go-humanize"
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
	case "backup":
		if len(os.Args) > 2 && os.Args[2] == "synology-ui" {
			err = backupSynologyUICmd(os.Args[3:])
		} else {
			err = backupCmd(os.Args[2:])
		}
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
  xd login --server https://drive.example.com --username USER --password-stdin
  xd password --current CURRENT --new NEW
  xd status
  xd config --mount PATH
  xd mount [PATH]    (configure the owning Agent; CLI exits without stopping mount)
  xd version
  xd update [--source github|gitlab] [--channel stable|master] [--install] (Desktop only)
  xd update --cli-only [--download] [--source github|gitlab] [--channel stable|master]
  xd update --status
  xd doctor [--strict]
  xd backup init|bind|drafts|list|once|auto|schedule|status|history|pause|cancel|agent [options]
  xd backup synology-ui authorize --dsm-user USER   (DSM local package account only)
  xd logout

Accounts are created by an xDrive administrator; self-registration is not supported.
When PATH is omitted, xd uses the configured mount path or ~/xDrive.
On Linux, the path is a FUSE mountpoint. On Windows, it is a CfAPI sync root.`)
}

// validateXDHTTPSLoginOrigin rejects plaintext and ambiguous remote origins
// before resolving password input or constructing the HTTP client.
func validateXDHTTPSLoginOrigin(input string) (string, error) {
	fail := func() (string, error) { return "", fmt.Errorf("--server must be a complete HTTPS root URL") }
	if input == "" || input != strings.TrimSpace(input) { return fail() }
	u, err := url.ParseRequestURI(input)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil ||
		(u.Path != "" && u.Path != "/") || u.RawQuery != "" ||
		u.ForceQuery || u.Fragment != "" || u.Opaque != "" { return fail() }
	return strings.TrimSuffix(u.String(), "/"), nil
}

func login(args []string) error {
	fs := flag.NewFlagSet("login", flag.ContinueOnError)
	server := fs.String("server", "", "xDrive HTTPS server origin (required)")
	username := fs.String("username", "", "username")
	password := fs.String("password", "", "password (or XD_PASSWORD)")
	passwordStdin := fs.Bool("password-stdin", false, "read password from stdin (no argv/env secret)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *username == "" {
		return fmt.Errorf("--username is required")
	}
	secureServer, err := validateXDHTTPSLoginOrigin(*server)
	if err != nil { return err }
	*server = secureServer
	resolvedPassword, err := resolveLoginPassword(*password, os.Getenv("XD_PASSWORD"), *passwordStdin, os.Stdin)
	if err != nil {
		return err
	}
	cli := client.New(strings.TrimRight(*server, "/"), "")
	resp, err := cli.Login(context.Background(), *username, resolvedPassword)
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
	return humanize.IBytes(uint64(max(int64(0), bytes)))
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

func cleanupCmd() error {
	// Windows CfAPI root unregister must never race an active owning Agent
	// or a headless backup Agent; do not treat a malformed discovery as absent.
	if err := refuseMountCleanupWhenAgentActive(); err != nil {
		return err
	}

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
	install := fs.Bool("install", false, "install the Desktop update (only for an existing Desktop installation)")
	cliOnly := fs.Bool("cli-only", false, "target the standalone xd + xdrive-agent portable archive, never the Desktop installer")
	download := fs.Bool("download", false, "CLI-only: download and verify the portable archive without installing")
	showStatus := fs.Bool("status", false, "show the most recent Desktop platform update transaction")
	sourceFlag := fs.String("source", "", "update source: github or gitlab")
	channelFlag := fs.String("channel", "", "update channel: stable or master")
	if err := fs.Parse(args); err != nil {
		return err
	}
	self, selfErr := os.Executable()
	if selfErr != nil {
		return fmt.Errorf("cannot establish xd installation identity: %w", selfErr)
	}
	useCLIOnly := *cliOnly || portableCLIOnlyDistribution(self, runtime.GOOS)
	if *download && (*install || !useCLIOnly) {
		return fmt.Errorf("--download is supported only for CLI-only archive staging, without --install")
	}
	if err := rejectCLIOnlyInstall(*install, useCLIOnly); err != nil {
		return err
	}
	if *install {
		if err := requireExistingDesktopDistribution(self, runtime.GOOS); err != nil {
			return err
		}
	}
	if *showStatus {
		if useCLIOnly || *download || *install || strings.TrimSpace(*sourceFlag) != "" || strings.TrimSpace(*channelFlag) != "" {
			return fmt.Errorf("--status is only for an installed Desktop update transaction and cannot be combined with CLI-only, download or install options")
		}
		status, err := xupdate.LastInstallStatus()
		if err != nil {
			return err
		}
		fmt.Printf("state: %s\n", status.State)
		if status.CurrentVersion != "" {
			fmt.Printf("from: %s\n", status.CurrentVersion)
		}
		if status.TargetVersion != "" {
			fmt.Printf("to: %s\n", status.TargetVersion)
		}
		if status.Message != "" {
			fmt.Printf("message: %s\n", status.Message)
		}
		fmt.Printf("rolled back: %t\n", status.RolledBack)
		if status.UpdatedAt != "" {
			fmt.Printf("updated at: %s\n", status.UpdatedAt)
		}
		if status.LogPath != "" {
			fmt.Printf("log: %s\n", status.LogPath)
		}
		return nil
	}

	current := version.String()
	source := strings.TrimSpace(*sourceFlag)
	if source == "" {
		if prefs, prefsErr := userconfig.LoadUpdatePreferences(); prefsErr == nil {
			source = prefs.Source
		}
	}
	if source == "" {
		var sourceErr error
		source, sourceErr = xupdate.AutomaticSource()
		if sourceErr != nil {
			return sourceErr
		}
	} else {
		var sourceErr error
		source, sourceErr = xupdate.NormalizeSource(source)
		if sourceErr != nil {
			return sourceErr
		}
	}
	channel := strings.TrimSpace(*channelFlag)
	if channel == "" {
		var err error
		channel, err = xupdate.AutomaticChannel(current)
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

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	if useCLIOnly {
		return runCLIOnlyUpdate(ctx, current, normalized, source, *download)
	}

	if *install {
		started, installed, err := xupdate.InstallTargetFromSourceWithProgress(ctx, current, normalized, source, func(event xupdate.ProgressEvent) {
			fmt.Println(xupdate.FormatProgress(event))
		})
		if err != nil {
			return err
		}
		if started {
			fmt.Printf("updated target verified: %s from %s channel via %s; upgrade handoff accepted\n", installed.Latest, normalized, source)
		}
		return nil
	}

	fmt.Printf("[update 1/1] check: checking %s channel from %s via %s\n", normalized, current, source)
	result, err := xupdate.CheckPlatformTargetFromSource(ctx, current, normalized, source)
	if err != nil {
		return err
	}
	if !result.UpdateAvailable {
		fmt.Printf("xDrive %s is current on %s channel via %s\n", current, normalized, source)
		return nil
	}
	fmt.Printf("update available on %s via %s: %s -> %s\n", normalized, source, current, result.Latest)
	if result.Asset.Size > 0 {
		fmt.Printf("download: %s (%s)\n", result.Asset.Name, formatStorageBytes(result.Asset.Size))
	}
	fmt.Printf("run: xd update --source %s --channel %s --install\n", source, normalized)
	return nil
}
