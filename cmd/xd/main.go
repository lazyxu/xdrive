package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/mount"
)

type localConfig struct {
	Server   string `json:"server"`
	Token    string `json:"token"`
	Username string `json:"username"`
}

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
  xd register --server http://localhost:8080 --username USER --password PASS
  xd login    --server http://localhost:8080 --username USER --password PASS
  xd status
  xd mount PATH
  xd logout

On Linux, PATH is a FUSE mountpoint. On Windows, PATH is a CfAPI sync root directory.`)
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
	if err := saveConfig(localConfig{Server: strings.TrimRight(*server, "/"), Token: resp.Token, Username: resp.Username}); err != nil {
		return err
	}
	fmt.Printf("logged in as %s\n", resp.Username)
	return nil
}

func logout() error {
	p, err := configPath()
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
		return err
	}
	fmt.Println("logged out")
	return nil
}

func status() error {
	cfg, err := loadConfig()
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
	fmt.Printf("server: %s\nuser: %s\nroot items: %d\n", cfg.Server, cfg.Username, len(children))
	return nil
}

func mountCmd(args []string) error {
	fs := flag.NewFlagSet("mount", flag.ContinueOnError)
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 1 {
		return fmt.Errorf("mount requires exactly one PATH")
	}
	cfg, err := loadConfig()
	if err != nil {
		return err
	}
	path, err := filepath.Abs(fs.Arg(0))
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

func configPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "xdrive", "config.json"), nil
}

func saveConfig(cfg localConfig) error {
	p, err := configPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, b, 0o600)
}

func loadConfig() (localConfig, error) {
	var cfg localConfig
	p, err := configPath()
	if err != nil {
		return cfg, err
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return cfg, fmt.Errorf("not logged in; run xd login: %w", err)
	}
	if err := json.Unmarshal(b, &cfg); err != nil {
		return cfg, err
	}
	if cfg.Server == "" || cfg.Token == "" {
		return cfg, fmt.Errorf("invalid local config; run xd login again")
	}
	return cfg, nil
}
