package main

import (
	"errors"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestValidateCreatedLocalBackupSourceRequiresManagedTargetAndOwningDevice(t *testing.T) {
	id := uint64(42)
	request := client.CreateSourceInput{
		Name: "win", Kind: meta.SourceKindLocalFolder,
		Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, ScheduleType: "manual",
	}
	valid := client.Source{
		ID: 10, Name: request.Name, Kind: request.Kind,
		Direction: request.Direction, SyncMode: request.SyncMode,
		RunMode: request.RunMode, Status: meta.SourceStatusPaused,
		Revision: 1, TargetNodeID: &id, TargetManaged: true,
		TargetPath: "同步文件夹/Push/Windows_device-a/win",
		DeviceID:   "device-a",
	}
	if err := validateCreatedLocalBackupSource(valid, request, "device-a"); err != nil {
		t.Fatalf("valid managed Local Push must be accepted: %v", err)
	}
	cases := map[string]func(*client.Source){
		"missing source id":     func(s *client.Source) { s.ID = 0 },
		"missing revision":      func(s *client.Source) { s.Revision = 0 },
		"changed name":          func(s *client.Source) { s.Name = "other" },
		"wrong kind":            func(s *client.Source) { s.Kind = "synology_photos" },
		"wrong direction":       func(s *client.Source) { s.Direction = meta.SourceDirectionPull },
		"wrong sync mode":       func(s *client.Source) { s.SyncMode = meta.SourceSyncModeMirror },
		"wrong run mode":        func(s *client.Source) { s.RunMode = meta.SourceRunModeScan },
		"already active":        func(s *client.Source) { s.Status = meta.SourceStatusActive },
		"wrong device":          func(s *client.Source) { s.DeviceID = "device-b" },
		"missing device":        func(s *client.Source) { s.DeviceID = "" },
		"unmanaged directory":   func(s *client.Source) { s.TargetManaged = false },
		"missing target id":     func(s *client.Source) { s.TargetNodeID = nil },
		"zero target id":        func(s *client.Source) { zero := uint64(0); s.TargetNodeID = &zero },
		"missing target path":   func(s *client.Source) { s.TargetPath = " " },
		"oversized target path": func(s *client.Source) { s.TargetPath = strings.Repeat("x", 2049) },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			got := valid
			mutate(&got)
			if err := validateCreatedLocalBackupSource(got, request, "device-a"); err == nil {
				t.Fatal("invalid local Source acknowledgement was accepted")
			}
		})
	}
}

func TestExplainLocalBackupCreateErrorPreservesCauseAndOnlyMatchesLegacyContract(t *testing.T) {
	legacy := errors.New("Valid Source configuration is required")
	wrapped := explainLocalBackupCreateError(legacy)
	if !errors.Is(wrapped, legacy) ||
		!strings.Contains(wrapped.Error(), "Server/Agent version compatibility") ||
		!strings.Contains(wrapped.Error(), legacy.Error()) {
		t.Fatalf("legacy diagnostic must retain original error: %v", wrapped)
	}
	unrelated := errors.New("device credential revoked")
	if explainLocalBackupCreateError(unrelated) != unrelated {
		t.Fatal("unrelated errors must pass through without a misleading version diagnosis")
	}
	if explainLocalBackupCreateError(nil) != nil {
		t.Fatal("nil error must remain nil")
	}
}
