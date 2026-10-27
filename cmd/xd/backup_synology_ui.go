package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net/http/cgi"
	"os"
	"os/user"
	"runtime"
	"strconv"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
	"github.com/lazyxu/xdrive/internal/synologyui"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// Only the DSM-created unprivileged package user may read the Agent's 0600
// local discovery file or approve a DSM web principal. Never use setuid,
// root, a group-readable token, or a browser-provided username as a shortcut.
func requireDSMPackageIdentity() error {
	if runtime.GOOS != "linux" || os.Geteuid() == 0 {
		return errors.New("DSM UI requires the non-root xdrivenas package account")
	}
	account, err := user.Lookup("xdrivenas")
	if err != nil {
		return errors.New("DSM package user not installed")
	}
	uid, err := strconv.Atoi(account.Uid)
	if err != nil || uid != os.Geteuid() {
		return errors.New("DSM CGI must run as the owning xdrivenas account")
	}
	return nil
}

// Synology uses the original xd executable as an optional DSM-authenticated
// CGI adapter, never a second long-lived Runner or a public localhost server.
func backupSynologyUICmd(args []string) error {
	if runtime.GOOS != "linux" || len(args) == 0 {
		return errors.New("Synology UI requires DSM 7 on Linux")
	}
	if err := requireDSMPackageIdentity(); err != nil {
		return err
	}
	switch args[0] {
	case "authorize":
		if os.Getenv("GATEWAY_INTERFACE") != "" {
			return errors.New("cannot authorize a DSM user from CGI")
		}
		fs := flag.NewFlagSet("backup synology-ui authorize", flag.ContinueOnError)
		principal := fs.String("dsm-user", "", "explicit DSM login principal")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		if fs.NArg() != 0 || *principal == "" {
			return errors.New("use: xd backup synology-ui authorize --dsm-user USER")
		}
		dir, err := userconfig.Dir()
		if err != nil {
			return err
		}
		if err := synologyui.Authorize(dir, *principal); err != nil {
			return err
		}
		fmt.Println("DSM UI principal authorized for this local xdrive-agent; no browser endpoint was enabled")
		return nil
	case "cgi":
		if len(args) != 1 || os.Getenv("GATEWAY_INTERFACE") == "" || os.Getenv("REQUEST_METHOD") == "" || os.Getenv("REMOTE_ADDR") == "" || (os.Getenv("HTTPS") != "on" && os.Getenv("HTTPS") != "ON" && os.Getenv("HTTPS") != "1") {
			return errors.New("authenticated DSM HTTPS CGI environment required")
		}
		dir, err := userconfig.Dir()
		if err != nil {
			return err
		}
		gateway := &synologyui.Gateway{
			ConfigDir: dir, HTTPS: true, Authenticate: synologyui.AuthenticateDSM,
			Connect: func(ctx context.Context) (synologyui.Agent, error) {
				return localbackupipc.Connect(ctx, dir) // Never auto-spawn an Agent from a web request.
			},
		}
		if err := cgi.Serve(synologyui.CGIHandler(gateway)); err != nil {
			return fmt.Errorf("DSM CGI failed: %w", err)
		}
		return nil
	default:
		return errors.New("use: xd backup synology-ui authorize|cgi")
	}
}
