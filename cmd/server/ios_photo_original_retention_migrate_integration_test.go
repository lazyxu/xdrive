package main

import (
    "fmt"
    "net/url"
    "os"
    "strings"
    "testing"
    "time"

    "github.com/google/uuid"
    "github.com/lazyxu/xdrive/internal/meta"
    "github.com/lazyxu/xdrive/internal/storage"
    "gorm.io/driver/postgres"
    "gorm.io/gorm"
)

func TestMigrateIOSPhotoOriginalRetentionProtectsCASAndAncestors(t *testing.T) {
    dsn := os.Getenv("XD_TEST_DATABASE_URL")
    if dsn == "" { t.Skip("XD_TEST_DATABASE_URL is not set") }
    admin, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
    if err != nil { t.Fatal(err) }
    schema := "ios_retention_" + strings.ReplaceAll(uuid.NewString(), "-", "")
    if err := admin.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil { t.Fatal(err) }
    defer func() { _ = admin.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
    parsed, err := url.Parse(dsn)
    if err != nil { t.Fatal(err) }
    q := parsed.Query()
    q.Set("search_path", schema)
    parsed.RawQuery = q.Encode()
    db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
    if err != nil { t.Fatal(err) }
    if err := migrate(db); err != nil { t.Fatal(err) }
    // Idempotent reinstall must leave all original guards active.
    if err := migrate(db); err != nil { t.Fatalf("repeat migration failed: %v", err) }

    owner := meta.User{
        Username: "ios-retain-" + uuid.NewString(), PasswordHash: "fixture",
        Role: meta.UserRoleUser, SessionVersion: 1,
    }
    if err := db.Create(&owner).Error; err != nil { t.Fatal(err) }
    root := meta.Node{OwnerID: owner.ID, Name: "", Type: meta.NodeTypeDir, Revision: 1}
    if err := db.Create(&root).Error; err != nil { t.Fatal(err) }
    target := meta.Node{OwnerID: owner.ID, ParentID: &root.ID, Name: "iPhone",
        Type: meta.NodeTypeDir, Revision: 1}
    if err := db.Create(&target).Error; err != nil { t.Fatal(err) }
    node := meta.Node{OwnerID: owner.ID, ParentID: &target.ID,
        Name: "IMG-xios-0123456789abcdef01234567-0123456789ab.heic",
        Type: meta.NodeTypeFile, Revision: 1}
    if err := db.Create(&node).Error; err != nil { t.Fatal(err) }
    deviceID := uuid.NewString()
    device := meta.ClientDevice{
        ID: deviceID, OwnerID: owner.ID, Name: "iPhone", Platform: "ios",
        CredentialHash: strings.Repeat("b", 64), CreatedAt: time.Now(), UpdatedAt: time.Now(),
    }
    if err := db.Create(&device).Error; err != nil { t.Fatal(err) }
    source := meta.Source{
        OwnerID: owner.ID, Name: target.Name, Kind: meta.SourceKindIOSPhotos,
        Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
        Status: meta.SourceStatusPaused, Revision: 1, TargetManaged: true,
        TargetNodeID: &target.ID, DeviceID: &deviceID,
    }
    if err := db.Create(&source).Error; err != nil { t.Fatal(err) }
    hash := strings.Repeat("a", 64)
    key, err := storage.ContentAddressedKey(hash)
    if err != nil { t.Fatal(err) }
    file := meta.File{NodeID: node.ID, Size: 3, SHA256: hash, StorageKey: key}
    if err := db.Create(&file).Error; err != nil { t.Fatal(err) }
    // Historical file revisions of a protected original are independently
    // fenced from version-pruning jobs, not just the current File row.
    version := meta.FileVersion{NodeID: node.ID, Revision: 1,
        Size: file.Size, SHA256: hash, StorageKey: key}
    if err := db.Create(&version).Error; err != nil { t.Fatal(err) }
    blob := meta.ContentBlob{SHA256: hash, Size: file.Size,
        StorageKey: key, RefCount: 1, State: meta.ContentBlobStateReady}
    if err := db.Create(&blob).Error; err != nil { t.Fatal(err) }
    hold := meta.IOSPhotoOriginalHold{
        ID: uuid.NewString(), OwnerID: owner.ID, DeviceID: deviceID,
        SourceID: source.ID, SourceRevision: 1, TargetNodeID: target.ID,
        NodeID: node.ID, NodeRevision: 1, SessionID: uuid.NewString(),
        Kind: "image", SHA256: hash, ByteSize: file.Size, StorageKey: key,
        CreatedAt: time.Now().UTC(),
    }
    if err := db.Create(&hold).Error; err != nil { t.Fatal(err) }
    for _, ancestorID := range []uint64{node.ID, target.ID, root.ID} {
        if err := db.Create(&meta.IOSPhotoOriginalHoldAncestor{
            HoldID: hold.ID, NodeID: ancestorID, OwnerID: owner.ID,
        }).Error; err != nil { t.Fatal(err) }
    }

    blocked := []struct{name string; apply func() error}{
        {"file delete", func() error { return db.Delete(&meta.File{}, "node_id = ?", node.ID).Error }},
        {"FileVersion delete", func() error { return db.Delete(&meta.FileVersion{}, "node_id = ?", node.ID).Error }},
        {"FileVersion replacement", func() error { return db.Model(&meta.FileVersion{}).Where("node_id = ?", node.ID).Update("storage_key", "other-key").Error }},
        {"file SHA replacement", func() error { return db.Model(&meta.File{}).Where("node_id = ?", node.ID).Update("sha256", strings.Repeat("c", 64)).Error }},
        {"original Node trash", func() error { return db.Model(&meta.Node{}).Where("id = ?", node.ID).Update("deleted_at", time.Now()).Error }},
        {"target Node trash", func() error { return db.Model(&meta.Node{}).Where("id = ?", target.ID).Update("deleted_at", time.Now()).Error }},
        {"target Node rename", func() error { return db.Model(&meta.Node{}).Where("id = ?", target.ID).Update("name", "other").Error }},
        {"root Node trash", func() error { return db.Model(&meta.Node{}).Where("id = ?", root.ID).Update("deleted_at", time.Now()).Error }},
        {"physical CAS delete", func() error { return db.Delete(&meta.ContentBlob{}, "sha256 = ?", hash).Error }},
        {"physical CAS GC state", func() error { return db.Model(&meta.ContentBlob{}).Where("sha256 = ?", hash).Update("state", meta.ContentBlobStateDeleting).Error }},
        {"physical CAS refcount drop", func() error { return db.Model(&meta.ContentBlob{}).Where("sha256 = ?", hash).Update("ref_count", 0).Error }},
        {"Source delete", func() error { return db.Delete(&meta.Source{}, "id = ?", source.ID).Error }},
        {"Source rebound", func() error { return db.Model(&meta.Source{}).Where("id = ?", source.ID).Update("target_node_id", root.ID).Error }},
        {"Source revision changed", func() error { return db.Model(&meta.Source{}).Where("id = ?", source.ID).Update("revision", uint64(2)).Error }},
        {"Source renamed", func() error { return db.Model(&meta.Source{}).Where("id = ?", source.ID).Update("name", "renamed").Error }},
        {"Source archived", func() error { return db.Model(&meta.Source{}).Where("id = ?", source.ID).Update("status", meta.SourceStatusArchived).Error }},
        {"retention hold delete", func() error { return db.Delete(&meta.IOSPhotoOriginalHold{}, "id = ?", hold.ID).Error }},
        {"retention ancestor delete", func() error { return db.Delete(&meta.IOSPhotoOriginalHoldAncestor{}, "hold_id = ?", hold.ID).Error }},
    }
    for _, item := range blocked {
        t.Run(item.name, func(t *testing.T) {
            if err := item.apply(); err == nil { t.Fatal("retained original was mutated") }
        })
    }
    var still meta.File
    if err := db.First(&still, "node_id = ?", node.ID).Error; err != nil ||
        still.SHA256 != hash { t.Fatalf("retained File lost: %+v %v", still, err) }
    var stillBlob meta.ContentBlob
    if err := db.First(&stillBlob, "sha256 = ?", hash).Error; err != nil ||
        stillBlob.State != meta.ContentBlobStateReady || stillBlob.RefCount != 1 {
        t.Fatalf("retained CAS lost: %+v %v", stillBlob, err)
    }
    // Unrelated ordinary Node deletes must continue. A BEFORE DELETE
    // trigger returning NEW(nil) silently suppresses deletes; guard against it.
    unrelated := meta.Node{OwnerID: owner.ID, ParentID: &root.ID,
        Name:"unrelated.txt", Type: meta.NodeTypeFile, Revision: 1}
    if err := db.Create(&unrelated).Error; err != nil { t.Fatal(err) }
    if err := db.Delete(&unrelated).Error; err != nil { t.Fatalf("unrelated delete blocked: %v",err) }
    var count int64
    if err := db.Model(&meta.Node{}).Where("id = ?", unrelated.ID).Count(&count).Error; err != nil || count != 0 {
        t.Fatalf("unretained delete unexpectedly suppressed: count=%d error=%v", count, err)
    }
}
