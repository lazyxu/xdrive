package api

import (
	"encoding/base64"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestClipboardTargetedEnvelopeAndFileRefValidation(t *testing.T) {
	nonce := base64.StdEncoding.EncodeToString(make([]byte, 12))
	ciphertext := base64.StdEncoding.EncodeToString(make([]byte, 32))
	original := clipboardWriteRequest{
		ClientEventID: uuid.NewString(), Kind: "text/plain", Nonce: nonce, Ciphertext: ciphertext,
	}
	if err := validateClipboardWrite(original); err != nil {
		t.Fatal("original text rejected", err)
	}
	target := original
	target.TargetDeviceID = uuid.NewString()
	target.EphemeralKey = base64.StdEncoding.EncodeToString([]byte(strings.Repeat("a", 32)))
	target.WrappedKey = base64.StdEncoding.EncodeToString([]byte(strings.Repeat("b", 60)))
	if err := validateClipboardWrite(target); err != nil {
		t.Fatal("valid wrapped target rejected", err)
	}
	invalid := []clipboardWriteRequest{
		func() clipboardWriteRequest { v := target; v.WrappedKey = ""; return v }(),
		func() clipboardWriteRequest { v := target; v.EphemeralKey = ""; return v }(),
		func() clipboardWriteRequest { v := target; v.TargetDeviceID = "wrong"; return v }(),
		func() clipboardWriteRequest { v := original; v.WrappedKey = target.WrappedKey; return v }(),
		func() clipboardWriteRequest { v := original; v.NodeID = 34; return v }(),
		func() clipboardWriteRequest { v := original; v.Kind = "image/x-xdrive-node-ref"; return v }(),
		func() clipboardWriteRequest { v := original; v.Kind = "application/x-xdrive-node-ref"; v.NodeID = 34; return v }(),
	}
	for _, v := range invalid {
		if validateClipboardWrite(v) == nil {
			t.Fatalf("unsafe item accepted: %+v", v)
		}
	}
	file := target
	file.Kind = "image/x-xdrive-node-ref"
	file.NodeID = 34
	if validateClipboardWrite(file) != nil {
		t.Fatal("valid image Node ref rejected")
	}
	file.Kind = "application/x-xdrive-node-ref"
	if validateClipboardWrite(file) != nil {
		t.Fatal("valid file Node ref rejected")
	}
	if clipboardValidPublicKey("") ||
		clipboardValidPublicKey(base64.StdEncoding.EncodeToString(make([]byte, 32))) {
		t.Fatal("invalid X25519 public key accepted")
	}
	if !clipboardValidPublicKey(target.EphemeralKey) {
		t.Fatal("valid X25519 public key rejected")
	}
	record := meta.ClipboardItem{Kind: original.Kind, Nonce: nonce, Ciphertext: ciphertext}
	if !clipboardSameItem(record, original) || clipboardSameItem(record, target) {
		t.Fatal("target identity must be part of idempotent retry matching")
	}
}
