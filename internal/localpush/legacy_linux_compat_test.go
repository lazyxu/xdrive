//go:build linux

package localpush

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/unix"
)

func TestLegacyLinuxIdentityMatchesPinnedFDWithoutStatx(t *testing.T) {
	root := filepath.Join(t.TempDir(), "nas-ext4")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	info, err := os.Lstat(root)
	if err != nil {
		t.Fatal(err)
	}
	// An explicit generation-reader seam tests old-kernel identity logic
	// even on CI host filesystems without the ext4 generation ioctl.
	getVersion := func(fd int) (uint32, error) {
		if fd < 0 {
			return 0, ErrRootChanged
		}
		return 0xfedcba98, nil
	}
	pathIdentity, strong, err := linuxLegacyObjectIdentity(root, info, getVersion)
	if err != nil || !strong || !pathIdentity.Strong ||
		!strings.Contains(pathIdentity.Token, ":ext4-generation:4275878552") {
		t.Fatalf("legacy path generation not strong: %+v strong=%v err=%v", pathIdentity, strong, err)
	}
	pinned, err := os.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	defer pinned.Close()
	pinnedInfo, err := pinned.Stat()
	if err != nil {
		t.Fatal(err)
	}
	pinnedIdentity, err := linuxLegacyPinnedIdentity(pinned, pinnedInfo, getVersion)
	if err != nil || pinnedIdentity != pathIdentity {
		t.Fatalf("pinned and path generation differ: %+v %+v err=%v", pinnedIdentity, pathIdentity, err)
	}
	if _, strong, err := linuxLegacyObjectIdentity(root, info,
		func(int) (uint32, error) { return 0, ErrRootChanged }); err != nil || strong {
		t.Fatalf("unavailable generation was admitted: strong=%v err=%v", strong, err)
	}
	if _, err := linuxLegacyPinnedIdentity(pinned, pinnedInfo,
		func(int) (uint32, error) { return 0, nil }); !errors.Is(err, ErrRootChanged) {
		t.Fatalf("zero generation accepted by pinned witness: %v", err)
	}
}

func TestLegacyLinuxGenerationRejectsReplacedAndSymlinkedPath(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "nas")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	before, err := os.Lstat(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(root, root+"-old"); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	stub := func(int) (uint32, error) { return 76, nil }
	if _, _, err := linuxLegacyObjectIdentity(root, before, stub); !errors.Is(err, ErrRootChanged) {
		t.Fatalf("reused pathname with different inode accepted: %v", err)
	}
	if err := os.Remove(root); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(root+"-old", root); err != nil {
		t.Fatal(err)
	}
	if _, _, err := linuxLegacyObjectIdentity(root, before, stub); !errors.Is(err, ErrRootChanged) {
		t.Fatalf("symlink replacement accepted: %v", err)
	}
}

func TestLegacyOpenatFallbackReadsOnlyAuthorizedNestedRegularFile(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "NAS")
	nested := filepath.Join(root, "year", "month")
	if err := os.MkdirAll(nested, 0o700); err != nil {
		t.Fatal(err)
	}
	original := []byte("original ext4 NAS file bytes")
	if err := os.WriteFile(filepath.Join(nested, "photo.bin"), original, 0o600); err != nil {
		t.Fatal(err)
	}
	opener := func(int, string, *unix.OpenHow) (int, error) {
		return -1, unix.ENOSYS
	}
	grant := RootGrant{Path: root}
	file, err := openRootScopedRegularFileWithOpener(grant, "year/month/photo.bin", opener)
	if err != nil {
		t.Fatalf("old-kernel descriptor walk rejected safe nested file: %v", err)
	}
	got, err := io.ReadAll(file)
	_ = file.Close()
	if err != nil || string(got) != string(original) {
		t.Fatalf("wrong bytes from pinned old-kernel file: %q %v", got, err)
	}
	for _, relative := range []string{
		"", ".", "/etc/passwd", "../private", "year/../month/photo.bin",
		"year//month/photo.bin", "year/./month/photo.bin", "year/month/",
	} {
		if f, err := openRootScopedRegularFileWithOpener(grant, relative, opener); err == nil {
			_ = f.Close()
			t.Fatalf("legacy open accepted path traversal %q", relative)
		}
	}
	sensitive := filepath.Join(base, "outside")
	if err := os.WriteFile(sensitive, []byte("outside secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(sensitive, filepath.Join(nested, "escape.bin")); err != nil {
		t.Fatal(err)
	}
	if f, err := openRootScopedRegularFileWithOpener(grant, "year/month/escape.bin", opener); err == nil {
		_ = f.Close()
		t.Fatal("legacy fallback followed final symlink")
	}
	if err := os.Symlink(base, filepath.Join(root, "jump")); err != nil {
		t.Fatal(err)
	}
	if f, err := openRootScopedRegularFileWithOpener(grant, "jump/outside", opener); err == nil {
		_ = f.Close()
		t.Fatal("legacy fallback followed intermediate symlink")
	}
	blocked := false
	if f, err := openRootScopedRegularFileWithOpener(grant, "year/month/photo.bin",
		func(int, string, *unix.OpenHow) (int, error) {
			blocked = true
			return -1, unix.EPERM
		}); err == nil {
		_ = f.Close()
		t.Fatal("openat2 EPERM incorrectly triggered a fallback")
	}
	if !blocked {
		t.Fatal("injected openat2 was not used")
	}
}

func TestLegacyLinuxExt4IoctlIsReadOnlyAndNonzeroWhenAvailable(t *testing.T) {
	p := filepath.Join(t.TempDir(), "native-inode")
	if err := os.WriteFile(p, []byte("original"), 0o600); err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	generation, err := linuxExt4Generation(int(f.Fd()))
	if err != nil {
		// GitHub runners may use overlayfs or an ext4 implementation without
		// generation ioctls. This does not count as physical DSM acceptance.
		t.Skipf("host filesystem does not expose ext4 generation ioctl: %v", err)
	}
	other, err := linuxExt4Generation(int(f.Fd()))
	if err != nil || generation == 0 || other != generation {
		t.Fatalf("read-only generation changed: before=%d after=%d err=%v", generation, other, err)
	}
}
