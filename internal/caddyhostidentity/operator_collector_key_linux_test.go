//go:build linux

package caddyhostidentity

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func fixtureOperatorCollectorKey(t *testing.T) (string, string) {
	t.Helper()
	directory := t.TempDir()
	if err := os.Chmod(directory, 0700); err != nil {
		t.Fatal(err)
	}
	pub, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { clear(der); clear(privateKey) })
	if err := os.WriteFile(filepath.Join(directory, privateCollectorKeyName), der, 0600); err != nil {
		t.Fatal(err)
	}
	pubDER, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(pubDER)
	return directory, hex.EncodeToString(sum[:])
}

func TestOperatorPinnedCollectorKeyPreflight(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("operator must run under non-root UID")
	}
	dir, pin := fixtureOperatorCollectorKey(t)
	witness, err := privatePreflightOperatorCollectorKey(dir, pin, uint32(os.Geteuid()+1))
	if err != nil || witness.publicDERPin != pin || !validDigest(witness.fileEpochSHA) {
		t.Fatalf("valid isolated operator key refused: %v", err)
	}
	encoded, err := json.Marshal(witness)
	if err != nil || string(encoded) != "{}" {
		t.Fatal("private key/preflight information escaped JSON")
	}
	if strings.Contains(witness.fileEpochSHA, pin) {
		t.Fatal("file epoch exposed key identity")
	}
	original := witness.fileEpochSHA
	bytes, err := os.ReadFile(filepath.Join(dir, privateCollectorKeyName))
	if err != nil {
		t.Fatal(err)
	}
	tmp := filepath.Join(dir, "replacement")
	if err := os.WriteFile(tmp, bytes, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(tmp, filepath.Join(dir, privateCollectorKeyName)); err != nil {
		t.Fatal(err)
	}
	again, err := privatePreflightOperatorCollectorKey(dir, pin, uint32(os.Geteuid()+1))
	if err != nil || again.fileEpochSHA == original {
		t.Fatalf("same-key atomic rename was undetected: %v", err)
	}
}

func TestOperatorPinnedCollectorKeyRejectsUntrustedSource(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("operator must run under non-root UID")
	}
	tests := []struct {
		name   string
		modify func(t *testing.T, dir string, pin string) (string, string, uint32)
	}{
		{"same UID as Server", func(_ *testing.T, d, p string) (string, string, uint32) { return d, p, uint32(os.Geteuid()) }},
		{"untrusted pin", func(_ *testing.T, d, p string) (string, string, uint32) {
			return d, strings.Repeat("f", 64), uint32(os.Geteuid() + 1)
		}},
		{"missing pin", func(_ *testing.T, d, p string) (string, string, uint32) { return d, "", uint32(os.Geteuid() + 1) }},
		{"setuid key mode", func(t *testing.T, d, p string) (string, string, uint32) {
			path := filepath.Join(d, privateCollectorKeyName)
			if err := os.Chmod(path, 0600|os.ModeSetuid); err != nil {
				t.Fatal(err)
			}
			info, err := os.Lstat(path)
			if err != nil || info.Mode()&os.ModeSetuid == 0 {
				t.Fatal("fixture failed to set setuid")
			}
			return d, p, uint32(os.Geteuid() + 1)
		}},
		{"setgid directory mode", func(t *testing.T, d, p string) (string, string, uint32) {
			if err := os.Chmod(d, 0700|os.ModeSetgid); err != nil {
				t.Fatal(err)
			}
			info, err := os.Lstat(d)
			if err != nil || info.Mode()&os.ModeSetgid == 0 {
				t.Fatal("fixture failed to set setgid")
			}
			return d, p, uint32(os.Geteuid() + 1)
		}},
		{"sticky directory mode", func(t *testing.T, d, p string) (string, string, uint32) {
			if err := os.Chmod(d, 0700|os.ModeSticky); err != nil {
				t.Fatal(err)
			}
			info, err := os.Lstat(d)
			if err != nil || info.Mode()&os.ModeSticky == 0 {
				t.Fatal("fixture failed to set sticky")
			}
			return d, p, uint32(os.Geteuid() + 1)
		}},
		{"group-readable key", func(t *testing.T, d, p string) (string, string, uint32) {
			if err := os.Chmod(filepath.Join(d, privateCollectorKeyName), 0640); err != nil {
				t.Fatal(err)
			}
			return d, p, uint32(os.Geteuid() + 1)
		}},
		{"group-readable folder", func(t *testing.T, d, p string) (string, string, uint32) {
			if err := os.Chmod(d, 0750); err != nil {
				t.Fatal(err)
			}
			return d, p, uint32(os.Geteuid() + 1)
		}},
		{"symlink key", func(t *testing.T, d, p string) (string, string, uint32) {
			k := filepath.Join(d, privateCollectorKeyName)
			old := filepath.Join(d, "original")
			if err := os.Rename(k, old); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(old, k); err != nil {
				t.Fatal(err)
			}
			return d, p, uint32(os.Geteuid() + 1)
		}},
		{"hardlink key", func(t *testing.T, d, p string) (string, string, uint32) {
			if err := os.Link(filepath.Join(d, privateCollectorKeyName), filepath.Join(d, "hardlink")); err != nil {
				t.Fatal(err)
			}
			return d, p, uint32(os.Geteuid() + 1)
		}},
		{"wrong signing algorithm", func(t *testing.T, d, p string) (string, string, uint32) {
			key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
			if err != nil {
				t.Fatal(err)
			}
			der, err := x509.MarshalPKCS8PrivateKey(key)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(d, privateCollectorKeyName), der, 0600); err != nil {
				t.Fatal(err)
			}
			return d, p, uint32(os.Geteuid() + 1)
		}},
		{"malformed PKCS8", func(t *testing.T, d, p string) (string, string, uint32) {
			if err := os.WriteFile(filepath.Join(d, privateCollectorKeyName), []byte("not-pkcs8"), 0600); err != nil {
				t.Fatal(err)
			}
			return d, p, uint32(os.Geteuid() + 1)
		}},
		{"empty key", func(t *testing.T, d, p string) (string, string, uint32) {
			if err := os.WriteFile(filepath.Join(d, privateCollectorKeyName), []byte{}, 0600); err != nil {
				t.Fatal(err)
			}
			return d, p, uint32(os.Geteuid() + 1)
		}},
		{"oversized key", func(t *testing.T, d, p string) (string, string, uint32) {
			if err := os.WriteFile(filepath.Join(d, privateCollectorKeyName), []byte(strings.Repeat("A", privateCollectorKeyMaxBytes+1)), 0600); err != nil {
				t.Fatal(err)
			}
			return d, p, uint32(os.Geteuid() + 1)
		}},
		{"symlink folder", func(t *testing.T, d, p string) (string, string, uint32) {
			link := d + "-link"
			if err := os.Symlink(d, link); err != nil {
				t.Fatal(err)
			}
			return link, p, uint32(os.Geteuid() + 1)
		}},
		{"relative folder", func(_ *testing.T, d, p string) (string, string, uint32) {
			return "relative/path", p, uint32(os.Geteuid() + 1)
		}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			dir, pin := fixtureOperatorCollectorKey(t)
			dir, pin, serverUID := tc.modify(t, dir, pin)
			witness, err := privatePreflightOperatorCollectorKey(dir, pin, serverUID)
			if err == nil || witness != (privateCollectorKeyWitness{}) {
				t.Fatal("untrusted key preflight accepted")
			}
		})
	}
}

// Simulate the precise post-Lstat race: an otherwise-valid directory
// component is renamed away and replaced with a symlink before openat.
// Both the final leaf and an ancestor alias must be rejected by the kernel.
func TestOperatorCollectorDirectoryOpenRejectsRacedSymlinks(t *testing.T) {
	base := t.TempDir()
	realDir := filepath.Join(base, "real")
	if err := os.Mkdir(realDir, 0700); err != nil {
		t.Fatal(err)
	}
	opened, err := privateOpenCollectorDirNoSymlinks(realDir)
	if err != nil {
		t.Fatalf("real key directory refused: %v", err)
	}
	opened.Close()
	retired := filepath.Join(base, "retired")
	if err := os.Rename(realDir, retired); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(retired, realDir); err != nil {
		t.Fatal(err)
	}
	if opened, err := privateOpenCollectorDirNoSymlinks(realDir); err == nil {
		opened.Close()
		t.Fatal("swapped final symlink admitted after Lstat")
	}
	keyDir := filepath.Join(retired, "keys")
	if err := os.Mkdir(keyDir, 0700); err != nil {
		t.Fatal(err)
	}
	if opened, err := privateOpenCollectorDirNoSymlinks(filepath.Join(realDir, "keys")); err == nil {
		opened.Close()
		t.Fatal("symlinked ancestor admitted by pathname walk")
	}
}

// A malicious same-UID sibling process may race a FIFO into the fixed key
// location after Lstat. The openat must never block waiting for a FIFO writer.
func TestOperatorKeyPreflightOpenCannotBlockOnSwappedFIFO(t *testing.T) {
	if privateCollectorKeyOpenFlags&syscall.O_NONBLOCK == 0 ||
		privateCollectorKeyOpenFlags&syscall.O_NOFOLLOW == 0 ||
		privateCollectorKeyOpenFlags&syscall.O_CLOEXEC == 0 {
		t.Fatal("key must be opened nonblocking, nofollow and close-on-exec")
	}
	if os.Geteuid() == 0 {
		t.Skip("non-root Collector required")
	}
	dir, pin := fixtureOperatorCollectorKey(t)
	keyPath := filepath.Join(dir, privateCollectorKeyName)
	if err := os.Remove(keyPath); err != nil {
		t.Fatal(err)
	}
	if err := syscall.Mkfifo(keyPath, 0600); err != nil {
		t.Fatal(err)
	}
	witness, err := privatePreflightOperatorCollectorKey(dir, pin, uint32(os.Geteuid()+1))
	if err == nil || witness != (privateCollectorKeyWitness{}) {
		t.Fatal("FIFO key unexpectedly admitted")
	}
}
