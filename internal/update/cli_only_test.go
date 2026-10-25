package update

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestCLIOnlyAssetNamesAndSafeCache(t *testing.T) {
	for _, tc := range []struct {
		goos, goarch, name string
		allowed            bool
	}{
		{"linux", "amd64", "xdrive-backup-linux-amd64.tar.gz", true},
		{"windows", "amd64", "xdrive-backup-windows-amd64.zip", true},
		{"linux", "arm64", "", false},
		{"windows", "386", "", false},
		{"darwin", "amd64", "", false},
	} {
		got, err := CLIOnlyAssetName(tc.goos, tc.goarch)
		if got != tc.name || (err == nil) != tc.allowed {
			t.Fatalf("CLI-only target %s/%s: %q %v", tc.goos, tc.goarch, got, err)
		}
	}
	base := t.TempDir()
	for _, version := range []string{"snapshot", "v1.2.3"} {
		dir, err := CLIOnlyDownloadDir(base, version)
		if err != nil || dir != filepath.Join(base, "xdrive", "updates", "cli-only", version) {
			t.Fatalf("safe CLI-only cache path: %s %v", dir, err)
		}
	}
	for _, version := range []string{"", ".", "..", "../escape", "v1\\foo", "snapshot:evil", strings.Repeat("x", 81)} {
		if _, err := CLIOnlyDownloadDir(base, version); err == nil {
			t.Fatalf("unsafe CLI-only cache version accepted: %q", version)
		}
	}
	if err := ValidateCLIOnlyArchive(filepath.Join(t.TempDir(), "missing.zip"), "xdrive-backup-windows-amd64.zip"); err == nil {
		t.Fatal("nonexistent CLI-only archive accepted")
	}
}

func compileCLIOnlyFixture(t *testing.T, goos, name string) []byte {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "go.mod"), []byte("module github.com/lazyxu/xdrive\n\ngo 1.23\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	sourceDir := filepath.Join(dir, "cmd", name)
	if err := os.MkdirAll(sourceDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sourceDir, "main.go"), []byte("package main\nfunc main() {}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), name)
	if goos == "windows" {
		target += ".exe"
	}
	cmd := exec.Command("go", "build", "-trimpath", "-o", target, "./cmd/"+name)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "CGO_ENABLED=0", "GOOS="+goos, "GOARCH=amd64", "GOTOOLCHAIN=local")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("compile %s/%s fixture: %v: %s", goos, name, err, out)
	}
	bytes, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	return bytes
}

type cliOnlyArchiveMember struct {
	name    string
	payload []byte
	mode    os.FileMode
}

func createCLIOnlyTestTar(t *testing.T, members []cliOnlyArchiveMember) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "xdrive-backup-linux-amd64.tar.gz")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	gz := gzip.NewWriter(f)
	tw := tar.NewWriter(gz)
	for _, m := range members {
		header := &tar.Header{Name: m.name, Size: int64(len(m.payload)), Mode: int64(m.mode.Perm())}
		if m.name == "xdrive-backup/" {
			header.Size = 0
			header.Typeflag = tar.TypeDir
		} else if m.mode&os.ModeSymlink != 0 {
			header.Typeflag = tar.TypeSymlink
			header.Linkname = "outside"
			header.Size = 0
		} else {
			header.Typeflag = tar.TypeReg
		}
		if err := tw.WriteHeader(header); err != nil {
			t.Fatal(err)
		}
		if header.Typeflag == tar.TypeReg {
			if _, err := tw.Write(m.payload); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

func createCLIOnlyTestZIP(t *testing.T, members []cliOnlyArchiveMember) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "xdrive-backup-windows-amd64.zip")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	for _, m := range members {
		h := &zip.FileHeader{Name: m.name, Method: zip.Deflate}
		h.SetMode(m.mode)
		w, err := zw.CreateHeader(h)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(m.payload); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestCLIOnlyArchiveAllowsExactOriginalGoBinaryPair(t *testing.T) {
	if runtime.GOOS != "linux" && runtime.GOOS != "windows" {
		t.Skip("standalone releases currently support Linux and Windows")
	}
	xd := compileCLIOnlyFixture(t, runtime.GOOS, "xd")
	agent := compileCLIOnlyFixture(t, runtime.GOOS, "xdrive-agent")
	if runtime.GOOS == "linux" {
		valid := []cliOnlyArchiveMember{
			{"xdrive-backup/", nil, os.ModeDir | 0o755},
			{"xdrive-backup/README.md", []byte("CLI-only"), 0o644},
			{"xdrive-backup/xd", xd, 0o755},
			{"xdrive-backup/xdrive-agent", agent, 0o755},
			{"xdrive-backup/xdrive-backup-agent.service", []byte("service"), 0o644},
		}
		name := "xdrive-backup-linux-amd64.tar.gz"
		if err := ValidateCLIOnlyArchive(createCLIOnlyTestTar(t, valid), name); err != nil {
			t.Fatalf("original Go binaries rejected: %v", err)
		}
		invalid := append([]cliOnlyArchiveMember(nil), valid...)
		invalid = append(invalid, cliOnlyArchiveMember{"xdrive-backup/xdrive-desktop", []byte("gui"), 0o755})
		if err := ValidateCLIOnlyArchive(createCLIOnlyTestTar(t, invalid), name); err == nil {
			t.Fatal("Desktop smuggled into CLI-only tar")
		}
		invalid = append([]cliOnlyArchiveMember(nil), valid...)
		invalid[3].payload = xd // same Go exe, but not the original Agent package
		if err := ValidateCLIOnlyArchive(createCLIOnlyTestTar(t, invalid), name); err == nil {
			t.Fatal("incorrect second executable identity accepted")
		}
		invalid = append([]cliOnlyArchiveMember(nil), valid...)
		invalid[2].mode = os.ModeSymlink | 0o777
		if err := ValidateCLIOnlyArchive(createCLIOnlyTestTar(t, invalid), name); err == nil {
			t.Fatal("symlinked xd executable accepted")
		}
		invalid = append([]cliOnlyArchiveMember(nil), valid...)
		invalid = append(invalid, cliOnlyArchiveMember{"../outside", []byte("bad"), 0o644})
		if err := ValidateCLIOnlyArchive(createCLIOnlyTestTar(t, invalid), name); err == nil {
			t.Fatal("tar traversal accepted")
		}
	} else {
		valid := []cliOnlyArchiveMember{
			{"xdrive-backup/README.md", []byte("CLI-only"), 0o644},
			{"xdrive-backup/xd.exe", xd, 0o755},
			{"xdrive-backup/xdrive-agent.exe", agent, 0o755},
		}
		name := "xdrive-backup-windows-amd64.zip"
		if err := ValidateCLIOnlyArchive(createCLIOnlyTestZIP(t, valid), name); err != nil {
			t.Fatalf("original Go binaries rejected: %v", err)
		}
		// Both the legacy three-member ZIP and the optional paired helper
		// layout must pass, without allowing arbitrary scripts or Desktop.
		helper := []cliOnlyArchiveMember{
			{"xdrive-backup/WINDOWS_TASK.md", []byte("user login instructions"), 0o644},
			{"xdrive-backup/install-backup-agent-task.ps1", []byte("user-only task helper"), 0o644},
		}
		withHelper := append(append([]cliOnlyArchiveMember(nil), valid...), helper...)
		if err := ValidateCLIOnlyArchive(createCLIOnlyTestZIP(t, withHelper), name); err != nil {
			t.Fatalf("paired Windows user helper rejected: %v", err)
		}
		for _, member := range helper {
			incomplete := append(append([]cliOnlyArchiveMember(nil), valid...), member)
			if err := ValidateCLIOnlyArchive(createCLIOnlyTestZIP(t, incomplete), name); err == nil {
				t.Fatalf("incomplete Windows user helper accepted: %s", member.name)
			}
		}
		unsafeHelper := append([]cliOnlyArchiveMember(nil), withHelper...)
		unsafeHelper[len(unsafeHelper)-1].mode = os.ModeSymlink | 0o777
		if err := ValidateCLIOnlyArchive(createCLIOnlyTestZIP(t, unsafeHelper), name); err == nil {
			t.Fatal("symlinked Windows helper accepted")
		}
		invalid := append([]cliOnlyArchiveMember(nil), valid...)
		invalid = append(invalid, cliOnlyArchiveMember{"xdrive-backup/xdrive-desktop.exe", []byte("gui"), 0o755})
		if err := ValidateCLIOnlyArchive(createCLIOnlyTestZIP(t, invalid), name); err == nil {
			t.Fatal("Desktop smuggled into CLI-only ZIP")
		}
		invalid = append([]cliOnlyArchiveMember(nil), valid...)
		invalid[2].payload = xd
		if err := ValidateCLIOnlyArchive(createCLIOnlyTestZIP(t, invalid), name); err == nil {
			t.Fatal("incorrect Agent package accepted")
		}
		invalid = append([]cliOnlyArchiveMember(nil), valid...)
		invalid[1].mode = os.ModeSymlink | 0o777
		if err := ValidateCLIOnlyArchive(createCLIOnlyTestZIP(t, invalid), name); err == nil {
			t.Fatal("symlinked ZIP executable accepted")
		}
		invalid = append([]cliOnlyArchiveMember(nil), valid...)
		invalid = append(invalid, cliOnlyArchiveMember{"../outside", []byte("bad"), 0o644})
		if err := ValidateCLIOnlyArchive(createCLIOnlyTestZIP(t, invalid), name); err == nil {
			t.Fatal("ZIP traversal accepted")
		}
	}
}

func TestCLIOnlyRejectsUnexpectedReleaseAssetNameBeforeCacheWrite(t *testing.T) {
	cache := t.TempDir()
	result := Result{Current: "v1.0.0", Latest: "v1.0.1",
		UpdateAvailable: true, Asset: Asset{Name: "../escape"}}
	if _, err := DownloadVerifiedCLIOnly(context.Background(), Checker{}, result,
		filepath.Join(cache, "updates"), nil); err == nil ||
		!strings.Contains(err.Error(), "unexpected CLI-only release asset name") {
		t.Fatalf("unexpected release asset was not rejected before download: %v", err)
	}
	if _, err := os.Stat(filepath.Join(cache, "escape")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("malformed asset escaped staging cache: %v", err)
	}
}

func TestCLIOnlyDownloadRejectsReleaseDigestMatchingInvalidArchive(t *testing.T) {
	invalid := []byte("not-a-real-cli-only-archive")
	hash := sha256.Sum256(invalid)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/archive" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(invalid)
	}))
	defer server.Close()
	name := "xdrive-backup-linux-amd64.tar.gz"
	target := Result{
		Current: "v1.0.0", Latest: "v1.0.1", Channel: ChannelStable,
		UpdateAvailable: true,
		Asset: Asset{Name: name, URL: server.URL + "/archive",
			Size: int64(len(invalid)), Digest: "sha256:" + hex.EncodeToString(hash[:])},
	}
	dir := t.TempDir()
	path, err := DownloadVerifiedCLIOnly(context.Background(),
		Checker{HTTP: server.Client()}, target, dir, nil)
	if err == nil || path != "" || !strings.Contains(err.Error(), "rejected CLI-only release archive") {
		t.Fatalf("accepted release digest but invalid archive: path=%q err=%v", path, err)
	}
	if _, err := os.Stat(filepath.Join(dir, name)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("unsafe CLI-only download cache retained: %v", err)
	}
}

func TestCLIOnlyZIPRejectsDuplicateAndUnknownNames(t *testing.T) {
	for _, members := range [][]cliOnlyArchiveMember{
		{{"xdrive-backup/xd.exe", []byte("one"), 0o644},
			{"xdrive-backup/xd.exe", []byte("two"), 0o644}},
		{{"../payload.exe", []byte("no"), 0o755}},
	} {
		path := createCLIOnlyTestZIP(t, members)
		if err := ValidateCLIOnlyArchive(path, "xdrive-backup-windows-amd64.zip"); err == nil {
			t.Fatalf("unsafe Windows archive accepted: %+v", members)
		}
	}
}
