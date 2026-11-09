package api

import (
	"errors"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

func TestManagedSourceTargetRenameAcceptsCanonicalOnly(t *testing.T) {
	db, _, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.SyncRun{}, &meta.UploadSession{}); err != nil {
		t.Fatal(err)
	}
	syncRoot := createFilePropertiesDir(t, db, owner.ID, root.ID, yikeTargetRootName)
	pushRoot := createFilePropertiesDir(t, db, owner.ID, syncRoot.ID, "Push")
	pullRoot := createFilePropertiesDir(t, db, owner.ID, syncRoot.ID, "Pull")
	legacyPush := createFilePropertiesDir(t, db, owner.ID, syncRoot.ID, "设备备份")
	legacyPull := createFilePropertiesDir(t, db, owner.ID, syncRoot.ID, "远程拉取")
	type renameCase struct {
		name, kind, direction, connector string
		parentID                         uint64
		managed, allow                   bool
	}
	cases := []renameCase{
		{"local Push", meta.SourceKindLocalFolder, meta.SourceDirectionPush, "", pushRoot.ID, true, true},
		{"iOS Push", meta.SourceKindIOSPhotos, meta.SourceDirectionPush, "", pushRoot.ID, true, true},
		{"Android Push", meta.SourceKindAndroidPhotos, meta.SourceDirectionPush, "", pushRoot.ID, true, true},
		{"DSM Push", synologySourceKind, meta.SourceDirectionPush, "", pushRoot.ID, true, true},
		{"Yike Pull", yikeSourceKind, meta.SourceDirectionPull, "Yike Photos", pullRoot.ID, true, true},
		{"Synology Photos Pull", synologySourceKind, meta.SourceDirectionPull, "Synology Photos", pullRoot.ID, true, true},
		{"Synology Files Pull", synologyFilesSourceKind, meta.SourceDirectionPull, "Synology Files", pullRoot.ID, true, true},
		{"unmanaged canonical", yikeSourceKind, meta.SourceDirectionPull, "Yike Photos", pullRoot.ID, false, false},
		{"legacy device-group Push", meta.SourceKindLocalFolder, meta.SourceDirectionPush, "old-device", legacyPush.ID, true, false},
		{"legacy remote Pull", synologyFilesSourceKind, meta.SourceDirectionPull, "Synology Files", legacyPull.ID, true, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			parentID := tc.parentID
			if tc.connector != "" {
				parent := createFilePropertiesDir(t, db, owner.ID, parentID, tc.connector)
				parentID = parent.ID
			}
			leaf := "Source " + tc.name
			target := createFilePropertiesDir(t, db, owner.ID, parentID, leaf)
			source := meta.Source{
				OwnerID: owner.ID, Name: leaf, Kind: tc.kind,
				Direction: tc.direction, SyncMode: meta.SourceSyncModeBackup,
				RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusPaused,
				Revision: 1, TargetNodeID: &target.ID, TargetManaged: tc.managed,
			}
			if err := db.Create(&source).Error; err != nil {
				t.Fatal(err)
			}
			nextName := "Next " + tc.name
			err := db.Transaction(func(tx *gorm.DB) error {
				return renameManagedSourceTargetTx(tx, source, nextName)
			})
			if tc.allow && err != nil {
				t.Fatalf("canonical managed rename rejected: %v", err)
			}
			if !tc.allow && !errors.Is(err, errSourceTargetMigrationRequired) {
				t.Fatalf("legacy/unmanaged rename accepted: %v", err)
			}
			var after meta.Node
			if err := db.First(&after, target.ID).Error; err != nil {
				t.Fatal(err)
			}
			want := leaf
			if tc.allow {
				want = nextName
			}
			if after.Name != want || after.ParentID == nil || *after.ParentID != parentID {
				t.Fatalf("rename changed target identity: node=%+v expected=%q", after, want)
			}
		})
	}
}
