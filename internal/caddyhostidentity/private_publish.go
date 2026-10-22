package caddyhostidentity

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

const privateBundlePublisherLock = ".caddy-running-identity.publish.lock"

// publishPrivateSignedReadOnlyBundle accepts ONLY a correctly pinned, fresh,
// canonical signed Host envelope. It is package-private and has no signing key,
// Caddy, Docker, DNS, certificate management or HTTP privileges. The caller is
// still responsible for genuine independent Host/ingress observation; this
// function does NOT make any claimed negative proof true or authorize adoption.
//
// The fixed directory MUST be operator-controlled; the signing key is NEVER
// stored there. An incomplete publish may leave a mixed bundle; the strict
// Reader will fail closed. A failed publish retains its private writer lock
// for explicit operator recovery, never an automatic ambiguous retry.
func publishPrivateSignedReadOnlyBundle(dir string, raw, sig, publicDER []byte,
	expectedKeyPin, expectedHostPin, expectedServerPin string,
) error {
	fail := func() error { return errUntrusted }
	if runtime.GOOS == "windows" || dir == "" || !filepath.IsAbs(dir) ||
		filepath.Clean(dir) != dir || len(raw) < 2 || len(raw) > maxManifestSize ||
		len(sig) != ed25519.SignatureSize || len(publicDER) != 44 {
		return fail()
	}
	publicAny, err := x509.ParsePKIXPublicKey(publicDER)
	if err != nil {
		return fail()
	}
	public, ok := publicAny.(ed25519.PublicKey)
	if !ok || len(public) != ed25519.PublicKeySize {
		return fail()
	}
	canonicalDER, err := x509.MarshalPKIXPublicKey(public)
	if err != nil || !bytes.Equal(canonicalDER, publicDER) {
		return fail()
	}
	if _, err := VerifyReadOnly(raw, sig, public,
		expectedKeyPin, expectedHostPin, expectedServerPin, time.Now().UTC()); err != nil {
		return fail()
	}
	before, err := os.Lstat(dir)
	if err != nil || !before.IsDir() || before.Mode()&os.ModeSymlink != 0 ||
		before.Mode().Perm()&0027 != 0 {
		return fail()
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return fail()
	}
	defer root.Close()
	opened, err := root.Stat(".")
	if err != nil || !os.SameFile(before, opened) || opened.Mode() != before.Mode() {
		return fail()
	}
	names := []string{privatePublicDERFile, privateManifestFile, privateSignatureFile}
	for _, name := range names {
		status, err := root.Lstat(name)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return fail()
		}
		if err == nil && (!status.Mode().IsRegular() || status.Mode().Perm()&0027 != 0) {
			return fail()
		}
	}
	lock, err := root.OpenFile(privateBundlePublisherLock, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return fail()
	}
	if err := lock.Sync(); err != nil {
		lock.Close()
		return fail()
	}
	if err := lock.Close(); err != nil {
		return fail()
	}
	// A stale lock intentionally blocks future publishers after an unexpected
	// termination. It can only be cleared by trusted operator recovery.
	if err := syncHostBundleRoot(root); err != nil {
		return fail()
	}
	contents := [][]byte{publicDER, raw, sig}
	for i, name := range names {
		if err := publishHostBundleFile(root, name, contents[i]); err != nil {
			return fail()
		}
	}
	if err := syncHostBundleRoot(root); err != nil {
		return fail()
	}
	after, err := os.Lstat(dir)
	if err != nil || !after.IsDir() || !os.SameFile(before, after) ||
		!os.SameFile(opened, after) || after.Mode() != before.Mode() {
		return fail()
	}
	// The exclusive Host writer validates the completed files while its
	// publisher lock is held, then atomically retires that lock.
	if _, err := readPrivateBundle(dir, expectedKeyPin,
		expectedHostPin, expectedServerPin, time.Now().UTC(), true); err != nil {
		return fail()
	}
	if err := root.Remove(privateBundlePublisherLock); err != nil {
		return fail()
	}
	if err := syncHostBundleRoot(root); err != nil {
		return fail()
	}
	return nil
}

func syncHostBundleRoot(root *os.Root) error {
	dirFD, err := root.Open(".")
	if err != nil {
		return err
	}
	err = dirFD.Sync()
	if closeErr := dirFD.Close(); err == nil {
		err = closeErr
	}
	return err
}

// Writes always use a random O_EXCL temporary regular file under a held root
// directory descriptor; destination basenames are hard-coded constants.
// Each individual replacement is atomic, but three-file publication is NOT a
// transaction. Readers must verify the detached signature/freshness and fail
// closed during a mixed-generation window.
func publishHostBundleFile(root *os.Root, name string, data []byte) error {
	var nonce [16]byte
	if _, err := io.ReadFull(rand.Reader, nonce[:]); err != nil {
		return errUntrusted
	}
	tmp := ".caddy-publish-" + hex.EncodeToString(nonce[:])
	f, err := root.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return errUntrusted
	}
	replaced := false
	defer func() {
		if !replaced {
			_ = root.Remove(tmp)
		}
	}()
	if err := f.Chmod(0640); err != nil {
		f.Close()
		return errUntrusted
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		return errUntrusted
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return errUntrusted
	}
	if err := f.Close(); err != nil {
		return errUntrusted
	}
	if err := root.Rename(tmp, name); err != nil {
		return errUntrusted
	}
	replaced = true
	return nil
}
