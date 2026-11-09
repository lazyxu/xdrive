package main

import (
	"bytes"
	"crypto/ecdh"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"

	"github.com/lazyxu/xdrive/internal/clipboardcrypto"
	"github.com/lazyxu/xdrive/internal/secretstore"
)

// The Agent's independent Clipboard device key must never be indexed by a
// shared login name alone, nor stored as a renderer/DSM-accessible credential.
func TestClipboardRecipientPrivateKeyIsScopedToExactOwnerAndInstallation(t *testing.T) {
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")
	dir := t.TempDir()
	server, owner, device := "https://nas.example", "owner-a", "a8d11b3e-eaf7-4a8a-aedb-3c51908c6df2"
	keyID := clipboardLocalSecretID(server, owner, device)
	if keyID == clipboardLocalSecretID(server, "owner-b", device) ||
		keyID == clipboardLocalSecretID("https://other.example", owner, device) ||
		keyID == clipboardLocalSecretID(server, owner, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb") {
		t.Fatal("private key identity reused across Owner, Server or device")
	}
	private, _, err := clipboardcrypto.GenerateDeviceKey()
	if err != nil {
		t.Fatal(err)
	}
	defer clear(private)
	err = secretstore.Save(dir, keyID, "test Clipboard recipient", secretstore.Credentials{
		OpaquePayload: base64.StdEncoding.EncodeToString(private),
	})
	if err != nil {
		t.Fatal(err)
	}
	defer secretstore.Delete(dir, keyID)
	read, exists, err := clipboardDevicePrivateKey(dir, server, owner, device)
	if err != nil || !exists || !bytes.Equal(read, private) {
		t.Fatalf("verified device private key was not preserved: %v", err)
	}
	clear(read)
	if _, found, err := clipboardDevicePrivateKey(dir, server, "owner-b", device); err != nil || found {
		t.Fatalf("other Owner reused device private key: %v", err)
	}
	if _, found, err := clipboardDevicePrivateKey(dir, "https://other.example", owner, device); err != nil || found {
		t.Fatalf("other Server reused device private key: %v", err)
	}
	// Linux fallback must remain private when the session's Secret Service
	// is unavailable; Windows DPAPI may use the separate encrypted format.
	if p := filepath.Join(dir, "credentials", keyID+".json"); clipboardCredentialTestFileExists(p) {
		info, err := os.Stat(p)
		if err != nil || info.Mode().Perm()&0077 != 0 {
			t.Fatalf("fallback credential is world readable: %v", err)
		}
	}
}

func clipboardCredentialTestFileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func TestClipboardInvalidStoredKeyFailsClosed(t *testing.T) {
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")
	dir := t.TempDir()
	const owner = "account"
	const server = "https://nas.example"
	const id = "a8d11b3e-eaf7-4a8a-aedb-3c51908c6df2"
	keyID := clipboardLocalSecretID(server, owner, id)
	if err := secretstore.Save(dir, keyID, "invalid test",
		secretstore.Credentials{OpaquePayload: base64.StdEncoding.EncodeToString(make([]byte, 31))}); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := clipboardDevicePrivateKey(dir, server, owner, id); err == nil || ok {
		t.Fatalf("malformed local private key must fail closed: %v", err)
	}
	// The Curve25519 representation is exactly 32 bytes.
	private, _, err := clipboardcrypto.GenerateDeviceKey()
	if err != nil {
		t.Fatal(err)
	}
	defer clear(private)
	if _, err := ecdh.X25519().NewPrivateKey(private); err != nil {
		t.Fatal("generated OS-store private key cannot be used for ECDH", err)
	}
}
