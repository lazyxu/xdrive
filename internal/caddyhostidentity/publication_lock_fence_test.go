package caddyhostidentity

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

// The three signed files are individually renamed and not an atomic set.
// A valid old claim cannot be exposed while the writer lock remains.
func TestReadPrivateBundleRefusesActiveOrStalePublishLock(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix-only private bundle directory")
	}
	f := makePrivatePublishFixture(t)
	if err := f.write(); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadPrivateBundle(f.dir, f.pin, f.host, f.server, time.Now().UTC()); err != nil {
		t.Fatal("completed unlocked bundle rejected")
	}
	lock := filepath.Join(f.dir, privateBundlePublisherLock)
	if err := os.WriteFile(lock, []byte("in-progress"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadPrivateBundle(f.dir, f.pin, f.host, f.server, time.Now().UTC()); err == nil {
		t.Fatal("public Reader accepted a locked publication")
	}
	// The same durable lock must prevent the publisher from rotating even
	// one of the previously accepted signed files.
	before, err := os.ReadFile(filepath.Join(f.dir, privateManifestFile))
	if err != nil {
		t.Fatal(err)
	}
	if err := f.write(); err == nil {
		t.Fatal("concurrent publisher incorrectly bypassed active lock")
	}
	after, err := os.ReadFile(filepath.Join(f.dir, privateManifestFile))
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("rejected concurrent publication modified accepted signed bytes")
	}
	verified, err := readPrivateBundle(f.dir, f.pin, f.host, f.server, time.Now().UTC(), true)
	if err != nil {
		t.Fatal("in-package writer could not verify completed files under its lock")
	}
	if verified.CandidateComplete() || verified.CanAdopt() || verified.ApplySupported() {
		t.Fatal("writer-only self-verification granted elevated authority")
	}
	if err := os.Remove(lock); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadPrivateBundle(f.dir, f.pin, f.host, f.server, time.Now().UTC()); err != nil {
		t.Fatal("finished and unlocked bundle was not accepted")
	}
}

func TestReadPrivateBundleRefusesMalformedPublishLock(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix-only private bundle directory")
	}
	f := makePrivatePublishFixture(t)
	if err := f.write(); err != nil {
		t.Fatal(err)
	}
	lock := filepath.Join(f.dir, privateBundlePublisherLock)
	target := filepath.Join(t.TempDir(), "outside")
	if err := os.WriteFile(target, []byte("outside"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, lock); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err := ReadPrivateBundle(f.dir, f.pin, f.host, f.server, time.Now().UTC()); err == nil {
		t.Fatal("symlinked publisher lock was ignored")
	}
	if err := os.Remove(lock); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(lock, 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadPrivateBundle(f.dir, f.pin, f.host, f.server, time.Now().UTC()); err == nil {
		t.Fatal("unexpected directory publisher lock was ignored")
	}
}
