//go:build linux

package update

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPlatformAssetNameUsesUnifiedLinuxInstaller(t *testing.T) {
	if got, want := platformAssetName(), "xdrive-linux-amd64.deb"; got != want {
		t.Fatalf("platformAssetName()=%q want=%q", got, want)
	}
}

func TestLinuxCurrentCommitRequiresInteractivePolicyKitWithoutRoot(t *testing.T) {
	path := filepath.Join(t.TempDir(), platformAssetName())
	t.Setenv("DISPLAY", "")
	t.Setenv("WAYLAND_DISPLAY", "")
	if _, err := linuxInstallerCommand(context.Background(), path, 1000); err == nil {
		t.Fatal("headless unprivileged install unexpectedly acquired root")
	}
	if _, err := linuxInstallerCommand(context.Background(), path, 0); err != nil {
		t.Fatalf("explicit already-root apt installer unexpectedly rejected: %v", err)
	}
	fakeBin := t.TempDir()
	if err := os.WriteFile(filepath.Join(fakeBin, "pkexec"), []byte("#!/bin/sh\nexit 0\n"), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", fakeBin+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("DISPLAY", ":1")
	cmd, err := linuxInstallerCommand(context.Background(), path, 1000)
	if err != nil {
		t.Fatalf("interactive PolicyKit installer refused: %v", err)
	}
	if !strings.HasSuffix(cmd.Args[0], "pkexec") ||
		!strings.HasSuffix(cmd.Args[1], "apt-get") ||
		cmd.Args[len(cmd.Args)-1] != path {
		t.Fatalf("wrong privileged install plan: %v", cmd.Args)
	}
	if _, err := linuxInstallerCommand(context.Background(), filepath.Join(t.TempDir(), "wrong.deb"), 1000); err == nil {
		t.Fatal("arbitrary local package was accepted by privilege helper")
	}
}

func TestLinuxPackageIdentityMustMatchExpectedPackageAndArchitecture(t *testing.T) {
	path := filepath.Join(t.TempDir(), platformAssetName())
	if err := os.WriteFile(path, []byte("verified-install-fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	bin := t.TempDir()
	script := "#!/bin/sh\ncase \"$3\" in\n Package) echo xdrive-client;;\n Architecture) echo amd64;;\n *) exit 9;;\nesac\n"
	if err := os.WriteFile(filepath.Join(bin, "dpkg-deb"), []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	if err := assertLinuxClientPackage(context.Background(), path); err != nil {
		t.Fatalf("expected Linux package rejected: %v", err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(bin, "dpkg-deb"), path); err != nil {
		t.Fatal(err)
	}
	if err := assertLinuxClientPackage(context.Background(), path); err == nil {
		t.Fatal("symlink installer admitted for privileged execution")
	}
}
