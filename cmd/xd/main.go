package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/mount"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "login":
		err = login(false, os.Args[2:])
	case "register":
		err = login(true, os.Args[2:])
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
  xd register --server https://drive.example.com --username USER --password PASS
  xd login    --server https://drive.example.com --username USER --password PASS
  xd status
  xd config --mount PATH
  xd mount [PATH]
  xd logout

When PATH is omitted, xd uses the configured mount path or ~/xDrive.
On Linux, the path is a FUSE mountpoint. On Windows, it is a CfAPI sync root.`)
}

func login(register bool, args []string) error {
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
	ctx := context.Background()
	var resp client.AuthResponse
	var err error
	if register {
		resp, err = cli.Register(ctx, *username, *password)
	} else {
		resp, err = cli.Login(ctx, *username, *password)
	}
	if err != nil {
		return err
	}
	mountPath := ""
	if existing, loadErr := userconfig.Load(); loadErr == nil {
		mountPath = existing.MountPath
	}
	cfg := userconfig.Config{
		Server:    strings.TrimRight(*server, "/"),
		Token:     resp.Token,
		Username:  resp.Username,
		MountPath: mountPath,
	}
	if err := userconfig.Save(cfg); err != nil {
		return err
	}
	root, err := userconfig.EffectiveMountPath(cfg)
	if err != nil {
		return err
	}
	fmt.Printf("logged in as %s\nmount path: %s\n", resp.Username, root)
	return nil
}

func logout() error {
	if err := userconfig.Remove(); err != nil {
		return err
	}
	fmt.Println("logged out; the background agent will stop the active mount")
	return nil
}

func status() error {
	cfg, err := userconfig.Load()
	if err != nil {
		return err
	}
	cli := client.New(cfg.Server, cfg.Token)
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
	fmt.Printf("server: %s\nuser: %s\nmount: %s\nroot items: %d\n", cfg.Server, cfg.Username, mountPath, len(children))
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
	fmt.Printf("xDrive mounted at %s; press Ctrl+C to stop\n", path)
	return mount.Run(ctx, client.New(cfg.Server, cfg.Token), path)
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
