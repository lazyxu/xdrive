package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"github.com/lazyxu/xdrive/internal/offlinebundle"
)

// This command is compiled into a standalone linux/amd64 binary at publish
// time. Linux operators do NOT need Go, Python or a separate package manager
// to run the Go release verifier/installer.
func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run(argv []string) error {
	if len(argv) == 0 {
		return fmt.Errorf("usage: xdrive-offline <list|verify|plan|install> --dir DIRECTORY")
	}
	verb := argv[0]
	if verb != "list" && verb != "verify" && verb != "plan" && verb != "install" {
		return fmt.Errorf("unknown offline operation: %s", verb)
	}
	fs := flag.NewFlagSet(verb, flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	dir := fs.String("dir", "", "five-component release directory")
	components := fs.String("components", "", "comma-separated subset; defaults to archives present")
	trusted := fs.String("trusted-manifest-sha256", "", "SHA-256 from independent authenticated source")
	signedDelivery := fs.Bool("signed-delivery", false, "require authenticated publisher delivery binding")
	trustedInstaller := fs.String("trusted-installer-sha256", "", "Host-attested Go ELF SHA-256")
	trustedDelivery := fs.String("trusted-delivery-sha256", "", "Host-attested delivery.json SHA-256")
	workdir := fs.String("workdir", "", "private staging parent")
	configDir := fs.String("config-dir", "", "existing xDrive home")
	noStart := fs.Bool("no-start", false, "validate and stage without starting services")
	enableMedia := fs.Bool("enable-media", false, "activate media worker profile")
	enableAI := fs.Bool("enable-ai", false, "activate photo intelligence profile")
	source := fs.String("update-source", "", "pinned update transport preference (xdrive only)")
	backup := fs.Bool("backup-file-data", false, "include canonical file data in rollback snapshot")
	if err := fs.Parse(argv[1:]); err != nil {
		return err
	}
	if fs.NArg() != 0 || *dir == "" {
		return fmt.Errorf("offline %s requires --dir with no trailing arguments", verb)
	}
	if verb != "install" && (*noStart || *source != "" || *backup || *workdir != "" ||
		(verb != "plan" && (*enableMedia || *enableAI || *configDir != ""))) {
		return fmt.Errorf("installation options require install operation")
	}
	if verb == "plan" && *trusted == "" {
		return fmt.Errorf("offline plan requires independently authenticated Manifest SHA-256")
	}
	if *signedDelivery {
		if verb == "list" || *trustedInstaller == "" || *trustedDelivery == "" {
			return fmt.Errorf("signed delivery requires verify/install and Host-attested Go ELF identity")
		}
	} else if *trustedInstaller != "" || *trustedDelivery != "" {
		return fmt.Errorf("trusted installer identity requires signed delivery")
	}
	info, err := os.Lstat(*dir)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("offline release directory is missing or unsafe")
	}
	manifest, err := offlinebundle.ReadManifest(*dir, *trusted, verb == "install" || verb == "plan")
	if err != nil {
		return err
	}
	if *signedDelivery {
		if err := offlinebundle.VerifySignedDelivery(*dir, manifest, *trusted, *trustedInstaller, *trustedDelivery); err != nil {
			return err
		}
	}
	selected, err := offlinebundle.Select(*dir, manifest, *components)
	if err != nil {
		return err
	}
	switch verb {
	case "list":
		choice := map[string]bool{}
		for _, n := range selected {
			choice[n] = true
		}
		for _, name := range offlinebundle.Components {
			status := "missing"
			if choice[name] {
				status = "present"
			}
			fmt.Printf("%-14s %-8s %s\n", name, status, manifest.Packages[name].Filename)
		}
		return nil
	case "verify":
		return offlinebundle.VerifySelection(*dir, manifest, selected, "")
	case "plan":
		// A preview is never an installation authorization. The Host will
		// recheck the publisher, snapshot bytes and live Docker state.
		home := *configDir
		if home == "" {
			base, err := os.UserHomeDir()
			if err != nil {
				return err
			}
			home = filepath.Join(base, ".xd")
		}
		home, err = filepath.Abs(home)
		if err != nil {
			return err
		}
		plan, err := offlinebundle.BuildUpgradePlan(*dir, manifest, selected, home, *enableMedia, *enableAI)
		if err != nil {
			return err
		}
		plan.TrustBasis = "independently_pinned_manifest_sha256"
		if *signedDelivery {
			plan.TrustBasis = "host_attested_sigstore_delivery"
		}
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		return encoder.Encode(plan)
	case "install":
		if runtime.GOOS != "linux" || runtime.GOARCH != "amd64" {
			return fmt.Errorf("offline install supports linux/amd64 only")
		}
		home := *configDir
		if home != "" {
			home, err = filepath.Abs(home)
			if err != nil {
				return err
			}
		}
		opts := offlinebundle.InstallOptions{
			Directory: *dir, Workdir: *workdir, Home: home,
			Components: selected, NoStart: *noStart, EnableMedia: *enableMedia,
			EnableAI: *enableAI, UpdateSource: *source, BackupFileData: *backup,
		}
		return offlinebundle.Install(context.Background(), manifest, opts)
	}
	return fmt.Errorf("unreachable offline operation")
}
