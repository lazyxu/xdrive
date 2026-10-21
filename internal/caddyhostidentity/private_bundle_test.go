package caddyhostidentity

import (
	"bytes"
	"crypto/ed25519"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

type privateFixture struct {
	dir     string
	now     time.Time
	claim   Manifest
	public  ed25519.PublicKey
	private ed25519.PrivateKey
	keyPin  string
}

func makePrivateFixture(t *testing.T) privateFixture {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("private Host bundle requires Unix secure directory and file permissions")
	}
	dir := t.TempDir()
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 10, 21, 11, 0, 0, 0, time.UTC)
	pub, priv, pin := testKeys(t)
	claim := testClaim(now)
	raw, sig := signClaim(t, claim, priv)
	der, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string][]byte{
		privateManifestFile:  raw,
		privateSignatureFile: sig,
		privatePublicDERFile: der,
	} {
		if err := os.WriteFile(filepath.Join(dir, name), content, 0600); err != nil {
			t.Fatal(err)
		}
	}
	return privateFixture{dir: dir, now: now, claim: claim, public: pub, private: priv, keyPin: pin}
}

func (f privateFixture) read() (VerifiedReadOnly, error) {
	return ReadPrivateBundle(f.dir, f.keyPin, f.claim.HostID, f.claim.ServerID, f.now)
}

func (f privateFixture) overwrite(t *testing.T, name string, content []byte) {
	t.Helper()
	path := filepath.Join(f.dir, name)
	if err := os.WriteFile(path, content, 0600); err != nil {
		t.Fatal(err)
	}
}

func TestPrivateSignedBundleRemainsOnlyNonsecretReadOnlyEvidence(t *testing.T) {
	f := makePrivateFixture(t)
	verified, err := f.read()
	if err != nil {
		t.Fatalf("trusted private bundle rejected: %v", err)
	}
	if verified.CandidateComplete() || verified.CanAdopt() || verified.ApplySupported() {
		t.Fatal("read-only bundle improperly granted Host adoption/Apply")
	}
	serialized, err := json.Marshal(verified)
	if err != nil {
		t.Fatal(err)
	}
	printed := [][]byte{serialized, []byte(fmt.Sprintf("%+v", verified)), []byte(fmt.Sprintf("%#v", verified))}
	for _, result := range printed {
		for _, secret := range []string{f.claim.Domain, f.claim.LANIP, f.claim.HostID,
			f.claim.ServerID, f.claim.LiveConfigSHA, f.claim.DomainProbeSHA} {
			if bytes.Contains(result, []byte(secret)) {
				t.Fatal("private Host witness escaped via returned evidence encoding")
			}
		}
	}
}

func TestPrivateSignedBundleFailsClosedOnBadTrustOrSource(t *testing.T) {
	cases := []struct {
		name    string
		corrupt func(*testing.T, privateFixture)
	}{
		{"missing detached signature", func(t *testing.T, f privateFixture) {
			if err := os.Remove(filepath.Join(f.dir, privateSignatureFile)); err != nil {
				t.Fatal(err)
			}
		}},
		{"forged signature", func(t *testing.T, f privateFixture) {
			sig, err := os.ReadFile(filepath.Join(f.dir, privateSignatureFile))
			if err != nil {
				t.Fatal(err)
			}
			sig[0] ^= 0x80
			f.overwrite(t, privateSignatureFile, sig)
		}},
		{"oversized private JSON", func(t *testing.T, f privateFixture) {
			f.overwrite(t, privateManifestFile, bytes.Repeat([]byte{'X'}, maxManifestSize+1))
		}},
		{"short public DER", func(t *testing.T, f privateFixture) {
			f.overwrite(t, privatePublicDERFile, bytes.Repeat([]byte{'X'}, 43))
		}},
		{"public-key replaced", func(t *testing.T, f privateFixture) {
			f.overwrite(t, privatePublicDERFile, bytes.Repeat([]byte{'X'}, 44))
		}},
		{"manifest identity tampered", func(t *testing.T, f privateFixture) {
			raw, err := os.ReadFile(filepath.Join(f.dir, privateManifestFile))
			if err != nil {
				t.Fatal(err)
			}
			raw = bytes.Replace(raw, []byte(f.claim.Domain), []byte("other.example.com"), 1)
			f.overwrite(t, privateManifestFile, raw)
		}},
		{"world-readable private source", func(t *testing.T, f privateFixture) {
			if err := os.Chmod(filepath.Join(f.dir, privateManifestFile), 0644); err != nil {
				t.Fatal(err)
			}
		}},
		{"group-writable private manifest", func(t *testing.T, f privateFixture) {
			if err := os.Chmod(filepath.Join(f.dir, privateManifestFile), 0620); err != nil {
				t.Fatal(err)
			}
		}},
		{"group-writable detached signature", func(t *testing.T, f privateFixture) {
			if err := os.Chmod(filepath.Join(f.dir, privateSignatureFile), 0620); err != nil {
				t.Fatal(err)
			}
		}},
		{"group-writable public-key DER", func(t *testing.T, f privateFixture) {
			if err := os.Chmod(filepath.Join(f.dir, privatePublicDERFile), 0620); err != nil {
				t.Fatal(err)
			}
		}},
		{"directory group writable", func(t *testing.T, f privateFixture) {
			if err := os.Chmod(f.dir, 0770); err != nil {
				t.Fatal(err)
			}
		}},
		{"directory world traversable", func(t *testing.T, f privateFixture) {
			if err := os.Chmod(f.dir, 0701); err != nil {
				t.Fatal(err)
			}
		}},
		{"directory world writable", func(t *testing.T, f privateFixture) {
			if err := os.Chmod(f.dir, 0777); err != nil {
				t.Fatal(err)
			}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := makePrivateFixture(t)
			tc.corrupt(t, f)
			if _, err := f.read(); err == nil {
				t.Fatal("unsafe Host bundle admitted")
			}
		})
	}
}

func TestPrivateSignedBundleAllowsReadOnlyServerGroup(t *testing.T) {
	f := makePrivateFixture(t)
	if err := os.Chmod(f.dir, 0750); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{privateManifestFile, privateSignatureFile, privatePublicDERFile} {
		if err := os.Chmod(filepath.Join(f.dir, name), 0640); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := f.read(); err != nil {
		t.Fatalf("read-only service group access must remain supported: %v", err)
	}
}

func TestPrivateSignedBundleRejectedForWrongIndependentPinsAndExpiredClaim(t *testing.T) {
	f := makePrivateFixture(t)
	for _, pin := range []struct{ name, key, host, server string }{
		{"wrong-public-key", strings.Repeat("a", 64), f.claim.HostID, f.claim.ServerID},
		{"wrong-host", f.keyPin, strings.Repeat("a", 64), f.claim.ServerID},
		{"wrong-server", f.keyPin, f.claim.HostID, strings.Repeat("a", 64)},
		{"missing-pin", "", f.claim.HostID, f.claim.ServerID},
	} {
		t.Run(pin.name, func(t *testing.T) {
			if _, err := ReadPrivateBundle(f.dir, pin.key, pin.host, pin.server, f.now); err == nil {
				t.Fatal("independent pin failure admitted")
			}
		})
	}
	if _, err := ReadPrivateBundle(f.dir, f.keyPin, f.claim.HostID, f.claim.ServerID, f.now.Add(time.Minute)); err == nil {
		t.Fatal("expired signed Host observation admitted")
	}
}

func TestPrivateSignedBundleRejectsFileAndRootSymlinks(t *testing.T) {
	f := makePrivateFixture(t)
	original := filepath.Join(f.dir, privateSignatureFile)
	target := filepath.Join(t.TempDir(), "outside.sig")
	raw, err := os.ReadFile(original)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(original); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, original); err != nil {
		t.Skipf("host disallows symlinks: %v", err)
	}
	if _, err := f.read(); err == nil {
		t.Fatal("symlinked signed evidence admitted")
	}
	link := filepath.Join(t.TempDir(), "linked-root")
	if err := os.Symlink(f.dir, link); err != nil {
		t.Skipf("host disallows symlinks: %v", err)
	}
	if _, err := ReadPrivateBundle(link, f.keyPin, f.claim.HostID, f.claim.ServerID, f.now); err == nil {
		t.Fatal("symlinked private Host root admitted")
	}
}

func TestPrivateSignedBundleWindowsNoImplicitHostAuthority(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows fail-closed contract only")
	}
	if _, err := ReadPrivateBundle("C:\\host-control", strings.Repeat("a", 64),
		strings.Repeat("b", 64), strings.Repeat("c", 64), time.Now()); err == nil {
		t.Fatal("unimplemented Windows Host trust was enabled")
	}
}
