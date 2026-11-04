package api

import (
    "strings"
    "testing"

    "github.com/lazyxu/xdrive/internal/meta"
)

func TestIOSPhotoBackupManagedDestinationPolicy(t *testing.T) {
    deviceID := "40410000-1111-4222-8333-555555555555"
    ownerID := uint64(17)
    right := meta.Source{
        OwnerID: ownerID, Name: "相册备份", Kind: meta.SourceKindIOSPhotos,
        Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
        Status: meta.SourceStatusPaused,
        LocalCreatorDeviceID: &deviceID,
    }
    if !iosPhotoDestinationSource(right) {
        t.Fatal("valid iOS photo source not recognized")
    }
    for _, change := range []func(*meta.Source){
        func(s *meta.Source) { s.Kind = meta.SourceKindLocalFolder },
        func(s *meta.Source) { s.Kind = "synology_photos" },
        func(s *meta.Source) { s.Direction = meta.SourceDirectionPull },
        func(s *meta.Source) { s.Status = meta.SourceStatusActive },
        func(s *meta.Source) { s.SyncMode = meta.SourceSyncModeMirror },
    } {
        clone := right
        change(&clone)
        if iosPhotoDestinationSource(clone) {
            t.Fatalf("cross-source identity incorrectly admitted: %+v", clone)
        }
    }
}

func TestIOSPhotoBackupSuggestedDeviceFolderName(t *testing.T) {
    if got := suggestedIOSPhotoDestinationName("  我的 iPhone  "); got != "我的 iPhone" {
        t.Fatalf("unexpected suggestion: %q", got)
    }
    for _, name := range []string{"", " ", "a/b", "a\\b", strings.Repeat("a", 129)} {
        got := suggestedIOSPhotoDestinationName(name)
        if got != "iPhone" {
            t.Fatalf("unsafe device display name %q suggested %q", name, got)
        }
    }
}
