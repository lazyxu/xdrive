package api

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

func TestManagedSourceTargetRenameAcceptsCanonicalAndExistingNamespaces(t *testing.T) {
	db, _, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	syncFolder := createFilePropertiesDir(t, db, owner.ID, root.ID, yikeTargetRootName)
	namespaces := map[string]meta.Node{}
	for _, name := range []string{"Push", "设备备份", "Pull", "远程拉取"} {
		namespaces[name] = createFilePropertiesDir(t, db, owner.ID, syncFolder.ID, name)
	}
	cases := []struct {
		name        string
		kind        string
		direction   string
		namespace   string
		connector   string
		leaf        string
		nextName    string
		wantLeaf    string
		managed     bool
	}{
		{name: "local Push", kind: meta.SourceKindLocalFolder, direction: meta.SourceDirectionPush,
			namespace: "Push", connector: "device_a1b2c3d4e5f6", leaf: "Local", nextName: "LocalNew", wantLeaf: "LocalNew", managed: true},
		{name: "legacy local Push", kind: meta.SourceKindLocalFolder, direction: meta.SourceDirectionPush,
			namespace: "设备备份", connector: "device_a1b2c3d4e5f6", leaf: "LocalOld", nextName: "LocalOldNew", wantLeaf: "LocalOldNew", managed: true},
		{name: "iOS Push", kind: meta.SourceKindIOSPhotos, direction: meta.SourceDirectionPush,
			namespace: "Push", connector: "iPhone_a1b2c3d4e5f6", leaf: "Photos", nextName: "PhotosNew", wantLeaf: "PhotosNew", managed: true},
		{name: "DSM Push", kind: synologySourceKind, direction: meta.SourceDirectionPush,
			namespace: "Push", connector: "NAS_a1b2c3d4e5f6", leaf: "NAS Photos", nextName: "NAS Photos New", wantLeaf: "NAS Photos New", managed: true},
		{name: "Android Push", kind: "android_photos", direction: meta.SourceDirectionPush,
			namespace: "Push", connector: "Pixel_a1b2c3d4e5f6", leaf: "Android Photos", nextName: "Android Photos New", wantLeaf: "Android Photos New", managed: true},
		{name: "Yike Pull", kind: yikeSourceKind, direction: meta.SourceDirectionPull,
			namespace: "Pull", connector: "Yike Photos", leaf: "uid_12345_old", nextName: "Yike New", wantLeaf: "uid_12345_Yike New", managed: true},
		{name: "legacy Yike Pull", kind: yikeSourceKind, direction: meta.SourceDirectionPull,
			namespace: yikeTargetRootName, connector: yikeTargetConnectorName, leaf: "uid_12345_old", nextName: "Yike Legacy New", wantLeaf: "uid_12345_Yike Legacy New", managed: false},
		{name: "Synology Photos Pull", kind: synologySourceKind, direction: meta.SourceDirectionPull,
			namespace: "Pull", connector: "Synology Photos", leaf: "Synology", nextName: "Synology New", wantLeaf: "Synology New", managed: true},
		{name: "legacy Synology Photos Pull", kind: synologySourceKind, direction: meta.SourceDirectionPull,
			namespace: "远程拉取", connector: "Synology Photos", leaf: "Synology Old", nextName: "Synology Old New", wantLeaf: "Synology Old New", managed: true},
		{name: "Synology Files Pull", kind: synologyFilesSourceKind, direction: meta.SourceDirectionPull,
			namespace: "Pull", connector: "Synology Files", leaf: "Files", nextName: "Files New", wantLeaf: "Files New", managed: true},
		{name: "legacy Synology Files Pull", kind: synologyFilesSourceKind, direction: meta.SourceDirectionPull,
			namespace: "远程拉取", connector: "Synology Files", leaf: "Files Old", nextName: "Files Old New", wantLeaf: "Files Old New", managed: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			namespace := syncFolder
			if tc.namespace != yikeTargetRootName {
				namespace = namespaces[tc.namespace]
			}
			parent := namespace
			if tc.connector != "" {
				parent = createFilePropertiesDir(t, db, owner.ID, namespace.ID, tc.connector)
			}
			target := createFilePropertiesDir(t, db, owner.ID, parent.ID, tc.leaf)
			targetID := target.ID
			source := meta.Source{
				OwnerID: owner.ID, Name: "Source " + tc.name, Kind: tc.kind,
				Direction: tc.direction, SyncMode: meta.SourceSyncModeBackup,
				RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusPaused,
				Revision: 1, TargetNodeID: &targetID, TargetManaged: tc.managed,
			}
			if err := db.Create(&source).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Transaction(func(tx *gorm.DB) error {
				return renameManagedSourceTargetTx(tx, source, tc.nextName)
			}); err != nil {
				t.Fatalf("valid managed target hierarchy was rejected: %v", err)
			}
			var after meta.Node
			if err := db.First(&after, target.ID).Error; err != nil {
				t.Fatal(err)
			}
			if after.Name != tc.wantLeaf || after.ParentID == nil || *after.ParentID != parent.ID {
				t.Fatalf("rename changed target identity/path: got=%+v wantLeaf=%q parent=%d",
					after, tc.wantLeaf, parent.ID)
			}
		})
	}
}
