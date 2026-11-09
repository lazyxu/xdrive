package client

import (
	"encoding/base64"
	"testing"

	"github.com/google/uuid"
)

func TestClipboardClientV2TargetEnvelopeIsAuthenticatedAndBoundToRecipient(t *testing.T) {
	encoded := func(size int) string {
		raw := make([]byte, size)
		for i := range raw {
			raw[i] = byte(i%250 + 1)
		}
		return base64.StdEncoding.EncodeToString(raw)
	}
	item := ClipboardWrite{
		ClientEventID:  uuid.NewString(),
		Kind:           "image/x-xdrive-node-ref",
		Nonce:          encoded(12),
		Ciphertext:     encoded(40),
		TargetDeviceID: uuid.NewString(),
		EphemeralKey:   encoded(32),
		WrappedKey:     encoded(60),
		NodeID:         118,
	}
	if !validClipboardWrite(item) {
		t.Fatal("valid per-device file Node reference rejected")
	}
	tests := []struct {
		name   string
		mutate func(*ClipboardWrite)
	}{
		{"broadcast-media", func(a *ClipboardWrite) { a.TargetDeviceID = "" }},
		{"target-without-wrap", func(a *ClipboardWrite) { a.WrappedKey = "" }},
		{"wrong-ephemeral-length", func(a *ClipboardWrite) { a.EphemeralKey = encoded(31) }},
		{"bad-target-uuid", func(a *ClipboardWrite) { a.TargetDeviceID = "other-device" }},
		{"missing-node", func(a *ClipboardWrite) { a.NodeID = 0 }},
		{"bad-nonce", func(a *ClipboardWrite) { a.Nonce = encoded(11) }},
		{"wrong-content-kind", func(a *ClipboardWrite) { a.Kind = "image/png" }},
		{"mixed-text-and-node", func(a *ClipboardWrite) { a.Kind = "text/plain" }},
		{"malformed-cipher", func(a *ClipboardWrite) { a.Ciphertext = "plaintext" }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			value := item
			tc.mutate(&value)
			if validClipboardWrite(value) {
				t.Fatal("unsafe target payload accepted")
			}
		})
	}
	text := item
	text.Kind = "text/plain"
	text.NodeID = 0
	if !validClipboardWrite(text) {
		t.Fatal("valid device-targeted E2EE text rejected")
	}
	text.TargetDeviceID = ""
	text.WrappedKey = ""
	text.EphemeralKey = ""
	if !validClipboardWrite(text) {
		t.Fatal("existing v1 Owner broadcast text must remain supported")
	}
	text.NodeID = 118
	if validClipboardWrite(text) {
		t.Fatal("v1 must never carry a file Node as an authorization token")
	}
	receipt := ClipboardItem{
		ID: 79, ClientEventID: item.ClientEventID, Kind: item.Kind,
		Nonce: item.Nonce, Ciphertext: item.Ciphertext, TargetDeviceID: item.TargetDeviceID,
		EphemeralKey: item.EphemeralKey, WrappedKey: item.WrappedKey,
		NodeID: item.NodeID, CreatedAt: "2026-11-08T00:00:00Z",
		ExpiresAt: "2026-11-09T00:00:00Z",
	}
	if !validClipboardItem(receipt) {
		t.Fatal("v2 canonical E2EE receipt rejected")
	}
	receipt.NodeID = 0
	if validClipboardItem(receipt) {
		t.Fatal("a media receipt must bind its exact CAS Node")
	}
}
