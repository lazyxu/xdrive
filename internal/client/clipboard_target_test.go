package client

import (
	"strings"
	"testing"
	"github.com/google/uuid"
)

func TestClipboardPlaintextTargetValidation(t *testing.T) {
	base := ClipboardWrite{ClientEventID: uuid.NewString(), Kind: "text/plain", Content: "hello"}
	if !validClipboardWrite(base) { t.Fatal("valid broadcast rejected") }
	directed := base
	directed.TargetDeviceID = uuid.NewString()
	if !validClipboardWrite(directed) { t.Fatal("valid target rejected") }
	for name, mutate := range map[string]func(*ClipboardWrite){
		"empty": func(v *ClipboardWrite){ v.Content = "" },
		"too-large": func(v *ClipboardWrite){ v.Content = strings.Repeat("x", 65537) },
		"bad-utf8": func(v *ClipboardWrite){ v.Content = string([]byte{0xff}) },
		"bad-event": func(v *ClipboardWrite){ v.ClientEventID = "invalid" },
		"bad-target": func(v *ClipboardWrite){ v.TargetDeviceID = "invalid" },
		"text-node": func(v *ClipboardWrite){ v.NodeID = 123 },
		"unknown-kind": func(v *ClipboardWrite){ v.Kind = "text/html" },
	}{
		t.Run(name,func(t *testing.T){
			v := directed
			mutate(&v)
			if validClipboardWrite(v) { t.Fatalf("invalid write accepted: %+v",v) }
		})
	}
	file := directed
	file.Kind, file.NodeID, file.Content = "image/x-xdrive-node-ref", 118, "asset:118"
	if !validClipboardWrite(file) { t.Fatal("valid CAS reference rejected") }
	file.Kind = "application/x-xdrive-node-ref"
	if !validClipboardWrite(file) { t.Fatal("valid file reference rejected") }
	file.Content = "asset:119"
	if validClipboardWrite(file) { t.Fatal("mismatched CAS reference accepted") }
	file.Content, file.TargetDeviceID = "asset:118", ""
	if validClipboardWrite(file) { t.Fatal("unaddressed Node reference accepted") }
}

func TestClipboardPlaintextReceiptValidation(t *testing.T) {
	base := ClipboardItem{ID:1, ClientEventID:uuid.NewString(), Kind:"text/plain",
		Content:"hello", CreatedAt:"2026-11-10T06:00:00Z", ExpiresAt:"2026-11-11T06:00:00Z"}
	if !validClipboardItem(base) { t.Fatal("valid receipt rejected") }
	base.ID = 0
	if validClipboardItem(base) { t.Fatal("zero ID accepted") }
	base.ID = 1
	base.Content = ""
	if validClipboardItem(base) { t.Fatal("empty content accepted") }
}
