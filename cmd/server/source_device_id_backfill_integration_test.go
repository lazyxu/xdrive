package main

import (
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// DeviceID backfill is metadata-only and must never claim another Owner's
// Device or treat an identity-only Synology/Android credential as a local Root.
func TestMigrateBackfillsOnlySameOwnerPlatformPushDeviceID(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("XD_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	base, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "source_deviceid_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := base.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = base.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error })
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.Source{}, &meta.ClientDevice{}); err != nil {
		t.Fatal(err)
	}
	owner := meta.User{Username: "deviceid-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	other := meta.User{Username: "deviceid-other", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	makeDevice := func(who uint64, platform string) string {
		t.Helper()
		id := uuid.NewString()
		device := meta.ClientDevice{
			ID: id, OwnerID: who, Platform: platform, Name: platform + " test",
			CredentialHash: strings.Repeat("a", 64),
		}
		if err := db.Create(&device).Error; err != nil {
			t.Fatal(err)
		}
		return id
	}
	windows := makeDevice(owner.ID, "windows")
	ios := makeDevice(owner.ID, "ios")
	synology := makeDevice(owner.ID, "synology")
	otherWindows := makeDevice(other.ID, "windows")
	android := makeDevice(owner.ID, "android")
	type row struct {
		name    string
		kind    string
		old     string
		current string
		want    string
	}
	rows := []row{
		{"local verified", meta.SourceKindLocalFolder, windows, "", windows},
		{"iphone verified", meta.SourceKindIOSPhotos, ios, "", ios},
		{"different owner denied", meta.SourceKindLocalFolder, otherWindows, "", ""},
		{"wrong local platform denied", meta.SourceKindLocalFolder, synology, "", ""},
		{"wrong photo platform denied", meta.SourceKindIOSPhotos, android, "", ""},
		{"canonical retained", meta.SourceKindLocalFolder, otherWindows, windows, windows},
	}
	ids := make(map[string]uint64)
	for _, item := range rows {
		var current *string
		if item.current != "" {
			value := item.current
			current = &value
		}
		old := item.old
		source := meta.Source{
			OwnerID: owner.ID, Name: item.name, Kind: item.kind,
			Direction: meta.SourceDirectionPush,
			SyncMode:  meta.SourceSyncModeBackup,
			RunMode:   meta.SourceRunModeSync,
			Status:    meta.SourceStatusPaused,
			Revision:  1, DeviceID: current, LocalCreatorDeviceID: &old,
		}
		if err := db.Create(&source).Error; err != nil {
			t.Fatal(err)
		}
		ids[item.name] = source.ID
	}
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	for _, item := range rows {
		var source meta.Source
		if err := db.First(&source, ids[item.name]).Error; err != nil {
			t.Fatal(err)
		}
		got := ""
		if source.DeviceID != nil {
			got = *source.DeviceID
		}
		if got != item.want {
			t.Fatalf("%s canonical DeviceID=%q want=%q", item.name, got, item.want)
		}
		// Backfill never edits historical creator metadata or changes Target.
		if source.LocalCreatorDeviceID == nil || *source.LocalCreatorDeviceID != item.old || source.TargetNodeID != nil {
			t.Fatalf("%s backfill rewrote legacy Source ownership or target: %+v", item.name, source)
		}
	}
}
