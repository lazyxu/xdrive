package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushrunner"
)

func TestManualFirstFileSelectsOnlyStrongSafeRootLeaf(t *testing.T) {
	now := time.Now().UTC()
	native := &localpush.InventoryNativeIdentity{
		Key: strings.Repeat("a", 64), Strong: true, LinkCount: 1, RenameCandidate: true,
	}
	valid := localpush.InventoryItem{Path: "photo.jpg", Kind: "file", Size: 200,
		ModifiedAt: &now, NativeIdentity: native}
	if !eligibleLocalBackupFirstLeaf(valid) {
		t.Fatal("valid strongly bound local regular first file was denied")
	}
	tests := []struct {
		name string
		edit func(*localpush.InventoryItem)
	}{
		{"nested", func(i *localpush.InventoryItem) { i.Path = "sub/photo.jpg" }},
		{"relative-escape", func(i *localpush.InventoryItem) { i.Path = "../photo.jpg" }},
		{"ignored", func(i *localpush.InventoryItem) { i.Ignored = true }},
		{"directory", func(i *localpush.InventoryItem) { i.Kind = "directory" }},
		{"size", func(i *localpush.InventoryItem) { i.Size = localpushrunner.MaxFirstLeafBytes + 1 }},
		{"negative", func(i *localpush.InventoryItem) { i.Size = -1 }},
		{"mtime", func(i *localpush.InventoryItem) { i.ModifiedAt = nil }},
		{"identity", func(i *localpush.InventoryItem) { i.NativeIdentity = nil }},
		{"weak", func(i *localpush.InventoryItem) { a := *native; a.Strong = false; i.NativeIdentity = &a }},
		{"hardlink", func(i *localpush.InventoryItem) { a := *native; a.LinkCount = 2; i.NativeIdentity = &a }},
		{"rename", func(i *localpush.InventoryItem) { a := *native; a.RenameCandidate = false; i.NativeIdentity = &a }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			i := valid
			tc.edit(&i)
			if eligibleLocalBackupFirstLeaf(i) {
				t.Fatal("unsafe first-file selection admitted")
			}
		})
	}
}
func TestManualFirstFileNeverReportsCompleteBackupOrSecrets(t *testing.T) {
	r := localBackupFirstFileSummary{SourceID: 42, Revision: 3, ObservedFiles: 1,
		ObservedBytes: 200, PhysicalObserved: true, BackupComplete: false, RetirementSafe: false}
	data, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	raw := string(data)
	for _, field := range []string{"root_id", "path", "sha256", "operation_id", "stage_id", "request_key", "token"} {
		if strings.Contains(raw, field) {
			t.Fatalf("leaked private identifier through Desktop response: %s", raw)
		}
	}
	if !strings.Contains(raw, "\"backup_complete\":false") ||
		!strings.Contains(raw, "\"retirement_safe\":false") {
		t.Fatal("first-file observation was upgraded into completed backup")
	}
	if _, err := (&agentController{}).CloudStartLocalBoundBackupFirstFile(nil, 42); err == nil {
		t.Fatal("nil context admitted")
	}
	if _, err := (&agentController{}).CloudStartLocalBoundBackupFirstFile(context.Background(), 0); err == nil {
		t.Fatal("invalid Source admitted")
	}
}
