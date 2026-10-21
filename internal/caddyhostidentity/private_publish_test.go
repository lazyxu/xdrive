package caddyhostidentity

import (
	"bytes"
	"crypto/ed25519"
	"crypto/x509"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

type publishFixture struct {
	dir, pin, host, server string
	raw, signature, der    []byte
}

func makePrivatePublishFixture(t *testing.T) publishFixture {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("Windows private signed Host publisher intentionally unsupported")
	}
	dir := t.TempDir()
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	public, private, pin := testKeys(t)
	claim := testClaim(now)
	raw, signature, err := signPreparedHostProbe(preparedHostProbeEnvelope{
		manifest: claim, domainProbeObserved: true, lanProbeObserved: true,
	}, private, now)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKIXPublicKey(public)
	if err != nil {
		t.Fatal(err)
	}
	return publishFixture{dir, pin, claim.HostID, claim.ServerID, raw, signature, der}
}

func (f publishFixture) write() error {
	return publishPrivateSignedReadOnlyBundle(f.dir, f.raw, f.signature, f.der,
		f.pin, f.host, f.server)
}

func TestPrivateSignedHostPublisherWritesOnlyPinnedReadonlyBundle(t *testing.T) {
	f := makePrivatePublishFixture(t)
	if err := f.write(); err != nil {
		t.Fatalf("trusted signed private bundle write rejected: %v", err)
	}
	for _, name := range []string{privatePublicDERFile, privateManifestFile, privateSignatureFile} {
		info, err := os.Lstat(filepath.Join(f.dir, name))
		if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0640 {
			t.Fatal("published private read-only file has unsafe mode/type")
		}
	}
	if _, err := os.Stat(filepath.Join(f.dir, privateBundlePublisherLock)); !os.IsNotExist(err) {
		t.Fatal("success did not retire the durable exclusive publisher lock")
	}
	verified, err := ReadPrivateBundle(f.dir, f.pin, f.host, f.server, time.Now().UTC())
	if err != nil {
		t.Fatalf("published fixed bundle not readable through canonical verifier: %v", err)
	}
	if verified.CandidateComplete() || verified.CanAdopt() || verified.ApplySupported() {
		t.Fatal("private published signature incorrectly granted Host adoption/Apply")
	}
	if err := f.write(); err != nil {
		t.Fatalf("independent next bounded publish rejected: %v", err)
	}
}

func TestPrivateSignedHostPublisherRejectsTamperBeforeAnyWrite(t *testing.T) {
	for _, tc := range []struct {
		name string
		edit func(*publishFixture)
	}{
		{"forged signature", func(f *publishFixture) {
			f.signature = bytes.Clone(f.signature)
			f.signature[0] ^= 0x80
		}},
		{"wrong Host pin", func(f *publishFixture) { f.host = strings.Repeat("a", 64) }},
		{"wrong Server pin", func(f *publishFixture) { f.server = strings.Repeat("a", 64) }},
		{"short public key", func(f *publishFixture) { f.der = f.der[:43] }},
		{"oversized manifest", func(f *publishFixture) { f.raw = bytes.Repeat([]byte("a"), maxManifestSize+1) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := makePrivatePublishFixture(t)
			tc.edit(&f)
			if err := f.write(); err == nil {
				t.Fatal("untrusted private Host evidence was published")
			}
			for _, name := range []string{privateManifestFile, privateSignatureFile,
				privatePublicDERFile, privateBundlePublisherLock} {
				if _, err := os.Lstat(filepath.Join(f.dir, name)); !os.IsNotExist(err) {
					t.Fatal("failed signature preflight wrote sensitive Host files")
				}
			}
		})
	}
}

func TestPrivateSignedHostPublisherRejectsUnsafeDirectoryAndPreexistingFiles(t *testing.T) {
	for _, tc := range []struct {
		name    string
		corrupt func(*testing.T, publishFixture)
	}{
		{"group writable root", func(t *testing.T, f publishFixture) {
			if err := os.Chmod(f.dir, 0770); err != nil {
				t.Fatal(err)
			}
		}},
		{"world traversable root", func(t *testing.T, f publishFixture) {
			if err := os.Chmod(f.dir, 0701); err != nil {
				t.Fatal(err)
			}
		}},
		{"stale publisher lock", func(t *testing.T, f publishFixture) {
			if err := os.WriteFile(filepath.Join(f.dir, privateBundlePublisherLock), []byte("held"), 0600); err != nil {
				t.Fatal(err)
			}
		}},
		{"symlinked manifest", func(t *testing.T, f publishFixture) {
			target := filepath.Join(t.TempDir(), "outside")
			if err := os.WriteFile(target, []byte("private-outside"), 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(target, filepath.Join(f.dir, privateManifestFile)); err != nil {
				t.Skipf("symlinks unavailable: %v", err)
			}
		}},
		{"world readable existing DER", func(t *testing.T, f publishFixture) {
			if err := os.WriteFile(filepath.Join(f.dir, privatePublicDERFile), f.der, 0644); err != nil {
				t.Fatal(err)
			}
			if err := os.Chmod(filepath.Join(f.dir, privatePublicDERFile), 0644); err != nil {
				t.Fatal(err)
			}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := makePrivatePublishFixture(t)
			tc.corrupt(t, f)
			if err := f.write(); err == nil {
				t.Fatal("publisher overwrote untrusted existing filesystem evidence")
			}
		})
	}
}

func TestPrivateSignedHostPublisherFailsClosedOnWindows(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows fail-closed constraint")
	}
	if err := publishPrivateSignedReadOnlyBundle(
		"C:\\host-control", []byte("{}\n"), make([]byte, ed25519.SignatureSize),
		make([]byte, 44), strings.Repeat("a", 64), strings.Repeat("b", 64),
		strings.Repeat("c", 64)); err == nil {
		t.Fatal("Windows private Host publisher implicitly enabled")
	}
}
