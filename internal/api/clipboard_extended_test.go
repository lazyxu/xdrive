package api

import (
	"fmt"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestClipboardPlaintextTargetAndFileRefValidation(t *testing.T) {
	original := clipboardWriteRequest{
		ClientEventID: uuid.NewString(), Kind: "text/plain", Content: "hello",
	}
	if err := validateClipboardWrite(original); err != nil {
		t.Fatal(err)
	}
	target := original
	target.TargetDeviceID = uuid.NewString()
	if err := validateClipboardWrite(target); err != nil {
		t.Fatal("valid plaintext target rejected:", err)
	}
	invalid := []clipboardWriteRequest{
		func() clipboardWriteRequest { v := target; v.TargetDeviceID = "wrong"; return v }(),
		func() clipboardWriteRequest { v := original; v.NodeID = 34; return v }(),
		func() clipboardWriteRequest { v := original; v.Kind = "image/x-xdrive-node-ref"; return v }(),
		func() clipboardWriteRequest {
			v := target
			v.Kind = "application/x-xdrive-node-ref"
			v.NodeID = 34
			return v
		}(),
	}
	for _, v := range invalid {
		if validateClipboardWrite(v) == nil {
			t.Fatalf("unsafe item accepted: %+v", v)
		}
	}
	file := target
	file.Kind = "image/x-xdrive-node-ref"
	file.NodeID = 34
	file.Content = fmt.Sprintf("asset:%d", file.NodeID)
	if err := validateClipboardWrite(file); err != nil {
		t.Fatal("image Node rejected:", err)
	}
	file.Kind = "application/x-xdrive-node-ref"
	if err := validateClipboardWrite(file); err != nil {
		t.Fatal("file Node rejected:", err)
	}
	file.Content = "asset:35"
	if validateClipboardWrite(file) == nil {
		t.Fatal("mismatched Node content accepted")
	}
	file.Content = "asset:34"
	file.TargetDeviceID = ""
	if validateClipboardWrite(file) == nil {
		t.Fatal("broadcast Node reference accepted")
	}

	record := meta.ClipboardItem{Kind: original.Kind, Nonce: "", Ciphertext: original.Content}
	if !clipboardSameItem(record, original) || clipboardSameItem(record, target) {
		t.Fatal("recipient must be part of idempotent retry matching")
	}
	record.Nonce = "legacy-encryption"
	if clipboardSameItem(record, original) {
		t.Fatal("legacy encrypted item was retried as plaintext")
	}
}
