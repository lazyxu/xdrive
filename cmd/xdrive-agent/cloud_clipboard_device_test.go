package main

import (
  "os"
  "strings"
  "testing"
)

// Deleting Clipboard E2EE must not accidentally remove the independently
// verified Owner/installation admission required for targeted messages.
func TestClipboardRecipientNoPrivateKeyStorageOrDecryption(t *testing.T) {
  src, err := os.ReadFile("cloud_clipboard_device.go")
  if err != nil { t.Fatal(err) }
  code := string(src)
  for _, forbidden := range []string{
    "clipboardLocalSecretID", "clipboardDevicePrivateKey",
    "clipboardcrypto.", "secretstore.", "PublicKey:",
    "CloudClipboardDecrypt(", "GenerateDeviceKey(",
  } {
    if strings.Contains(code, forbidden) {
      t.Errorf("retired crypto path still available: %s", forbidden)
    }
  }
}

func TestClipboardRecipientGrantStillRequiresVerifiedOwnerAndDevice(t *testing.T) {
  src, err := os.ReadFile("cloud_clipboard_device.go")
  if err != nil { t.Fatal(err) }
  code := string(src)
  for _, required := range []string{
    "clipboardOwnerDevice(ctx)", "clipboardCurrentAgentSession(cfg)",
    "cli.ClipboardEnrollSelf(ctx, deviceID, token)",
    "cli.ClipboardListForDevice(ctx, before, deviceID, token)",
    "clipboardDeviceActive(ctx, cli, deviceID)",
  } {
    if !strings.Contains(code, required) {
      t.Errorf("required Owner/device authorization missing: %s", required)
    }
  }
}
