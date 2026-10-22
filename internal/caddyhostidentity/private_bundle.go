package caddyhostidentity

import (
	"bytes"
	"crypto/ed25519"
	"crypto/x509"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

const (
	privateManifestFile  = "caddy-running-identity.v1.json"
	privateSignatureFile = "caddy-running-identity.v1.sig"
	privatePublicDERFile = "caddy-running-identity.v1.pub.der"
)

type stablePrivateFile struct {
	name string
	info os.FileInfo
}

// readBoundedPrivateFile never follows a path outside the directory root.
// Strict mode (no group writes/other access), type, size and file-identity checks reject symlinks, replacements
// and partially published snapshots. The caller must independently pin trust.
func readBoundedPrivateFile(root *os.Root, dir, name string, max int) ([]byte, stablePrivateFile, error) {
	fail := func() ([]byte, stablePrivateFile, error) { return nil, stablePrivateFile{}, errUntrusted }
	full := filepath.Join(dir, name)
	before, err := os.Lstat(full)
	if err != nil || !before.Mode().IsRegular() || before.Size() <= 0 ||
		before.Size() > int64(max) || before.Mode().Perm()&0027 != 0 {
		return fail()
	}
	file, err := root.Open(name)
	if err != nil {
		return fail()
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !opened.Mode().IsRegular() || !os.SameFile(before, opened) ||
		before.Size() != opened.Size() || !before.ModTime().Equal(opened.ModTime()) {
		return fail()
	}
	raw, err := io.ReadAll(io.LimitReader(file, int64(max)+1))
	if err != nil || len(raw) != int(before.Size()) || len(raw) > max {
		return fail()
	}
	after, err := os.Lstat(full)
	if err != nil || !after.Mode().IsRegular() || !os.SameFile(opened, after) ||
		after.Size() != opened.Size() || !after.ModTime().Equal(opened.ModTime()) ||
		after.Mode() != opened.Mode() {
		return fail()
	}
	return raw, stablePrivateFile{name: name, info: after}, nil
}

// ReadPrivateBundle validates a fixed, short-lived, independently signed
// read-only Host observation from a trusted operator-configured private mount.
// Public-key/Host/Server SHA-256 pins must be supplied OUT OF BAND by a trusted
// caller: never from HTTP, the Host bundle, admin saved desired or env hints.
// Success does not authorize Host adoption, Caddy Apply or an Applied Receipt.
// Windows is deliberately unsupported until equivalent secure file ACL and
// root-confinement acceptance exists; the Windows path fails closed.
func ReadPrivateBundle(dir, keyDERPin, hostPin, serverPin string, now time.Time) (VerifiedReadOnly, error) {
	return readPrivateBundle(dir, keyDERPin, hostPin, serverPin, now, false)
}

// readPrivateBundle is private: only the in-package publisher which already
// owns the exclusive lock may bypass the public publication fence.
func readPrivateBundle(dir, keyDERPin, hostPin, serverPin string, now time.Time, publisherOwnsLock bool) (VerifiedReadOnly, error) {
	fail := func() (VerifiedReadOnly, error) { return VerifiedReadOnly{}, errUntrusted }
	if runtime.GOOS == "windows" || dir == "" || !filepath.IsAbs(dir) || filepath.Clean(dir) != dir {
		return fail()
	}
	beforeDir, err := os.Lstat(dir)
	if err != nil || !beforeDir.IsDir() || beforeDir.Mode()&os.ModeSymlink != 0 ||
		beforeDir.Mode().Perm()&0027 != 0 {
		return fail()
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return fail()
	}
	defer root.Close()
	// Verify the opened root is the validated directory, not a path-swap.
	openedDir, err := root.Stat(".")
	if err != nil || !os.SameFile(beforeDir, openedDir) ||
		openedDir.Mode() != beforeDir.Mode() {
		return fail()
	}
	// Missing is the only admissible public writer-lock state.
	if !publisherOwnsLock && !privateBundlePublisherLockAbsent(root) {
		return fail()
	}
	publicDER, pubMeta, err := readBoundedPrivateFile(root, dir, privatePublicDERFile, 44)
	if err != nil || len(publicDER) != 44 {
		return fail()
	}
	public, err := x509.ParsePKIXPublicKey(publicDER)
	if err != nil {
		return fail()
	}
	edKey, valid := public.(ed25519.PublicKey)
	if !valid || len(edKey) != ed25519.PublicKeySize {
		return fail()
	}
	// Reject a noncanonical public-key encoding, even when a parser accepts it.
	canonicalDER, err := x509.MarshalPKIXPublicKey(edKey)
	if err != nil || !bytes.Equal(publicDER, canonicalDER) {
		return fail()
	}
	raw, manifestMeta, err := readBoundedPrivateFile(root, dir, privateManifestFile, maxManifestSize)
	if err != nil {
		return fail()
	}
	defer clear(raw)
	sig, sigMeta, err := readBoundedPrivateFile(root, dir, privateSignatureFile, ed25519.SignatureSize)
	if err != nil || len(sig) != ed25519.SignatureSize {
		return fail()
	}
	defer clear(sig)
	verified, err := VerifyReadOnly(raw, sig, edKey, keyDERPin, hostPin, serverPin, now)
	if err != nil {
		return fail()
	}
	// Reject any visible publication rotation during the three-file read.
	for _, file := range []stablePrivateFile{pubMeta, manifestMeta, sigMeta} {
		current, err := os.Lstat(filepath.Join(dir, file.name))
		if err != nil || !current.Mode().IsRegular() || !os.SameFile(current, file.info) ||
			current.Size() != file.info.Size() ||
			!current.ModTime().Equal(file.info.ModTime()) || current.Mode() != file.info.Mode() {
			return fail()
		}
	}
	afterDir, err := os.Lstat(dir)
	if err != nil || !afterDir.IsDir() || !os.SameFile(beforeDir, afterDir) ||
		!os.SameFile(openedDir, afterDir) || afterDir.Mode() != openedDir.Mode() {
		return fail()
	}
	// A publisher might start after the first check. Fence again before
	// exposing verified read-only evidence outside the Host writer.
	if !publisherOwnsLock && !privateBundlePublisherLockAbsent(root) {
		return fail()
	}
	return verified, nil
}

func privateBundlePublisherLockAbsent(root *os.Root) bool {
	_, err := root.Lstat(privateBundlePublisherLock)
	return errors.Is(err, os.ErrNotExist)
}
