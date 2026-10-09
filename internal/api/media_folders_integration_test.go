package api

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"sort"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestGallerySyncFolderBrowserUsesLocalNodeTree(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	baseSQL, err := baseDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer baseSQL.Close()
	schema := "media_folder_browser_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()

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
	dbSQL, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer dbSQL.Close()
	dbSQL.SetMaxOpenConns(2)
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.Source{},
		&meta.MediaMetadata{}, &meta.PhotoAsset{}, &meta.PhotoMetadata{},
	); err != nil {
		t.Fatal(err)
	}

	owner := meta.User{
		Username: "folder-owner", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	other := meta.User{
		Username: "folder-other", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 1}
	otherRoot := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: other.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&otherRoot).Error; err != nil {
		t.Fatal(err)
	}
	syncRoot := meta.Node{
		ParentID: &root.ID, Name: "Synology", Type: meta.NodeTypeDir,
		OwnerID: owner.ID, Revision: 1,
	}
	outside := meta.Node{
		ParentID: &root.ID, Name: "Outside", Type: meta.NodeTypeDir,
		OwnerID: owner.ID, Revision: 1,
	}
	if err := db.Create(&syncRoot).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&outside).Error; err != nil {
		t.Fatal(err)
	}
	childA := meta.Node{
		ParentID: &syncRoot.ID, Name: "2026", Type: meta.NodeTypeDir,
		OwnerID: owner.ID, Revision: 1,
	}
	childB := meta.Node{
		ParentID: &syncRoot.ID, Name: "Empty", Type: meta.NodeTypeDir,
		OwnerID: owner.ID, Revision: 1,
	}
	if err := db.Create(&childA).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&childB).Error; err != nil {
		t.Fatal(err)
	}
	grandchild := meta.Node{
		ParentID: &childA.ID, Name: "October", Type: meta.NodeTypeDir,
		OwnerID: owner.ID, Revision: 1,
	}
	if err := db.Create(&grandchild).Error; err != nil {
		t.Fatal(err)
	}
	otherTarget := meta.Node{
		ParentID: &otherRoot.ID, Name: "OtherSync", Type: meta.NodeTypeDir,
		OwnerID: other.ID, Revision: 1,
	}
	if err := db.Create(&otherTarget).Error; err != nil {
		t.Fatal(err)
	}

	files := []meta.Node{
		{ParentID: &syncRoot.ID, Name: "root.jpg", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
		{ParentID: &childA.ID, Name: "child.jpg", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
		{ParentID: &grandchild.ID, Name: "grand.mov", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
		{ParentID: &outside.ID, Name: "outside.jpg", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
	}
	if err := db.Create(&files).Error; err != nil {
		t.Fatal(err)
	}
	metadata := []meta.MediaMetadata{
		{NodeID: files[0].ID, OwnerID: owner.ID, NodeRevision: 1, SHA256: strings.Repeat("1", 64), MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg", CameraMake: "Apple", CameraModel: "iPhone 15 Pro", IndexState: meta.MediaIndexStateReady},
		{NodeID: files[1].ID, OwnerID: owner.ID, NodeRevision: 1, SHA256: strings.Repeat("2", 64), MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg", CameraMake: "Sony", CameraModel: "ILCE-7M4", IndexState: meta.MediaIndexStateReady},
		{NodeID: files[2].ID, OwnerID: owner.ID, NodeRevision: 1, SHA256: strings.Repeat("3", 64), MediaKind: meta.MediaKindVideo, MIMEType: "video/quicktime", CameraMake: "Apple", CameraModel: "iPhone 15 Pro", IndexState: meta.MediaIndexStateReady},
		{NodeID: files[3].ID, OwnerID: owner.ID, NodeRevision: 1, SHA256: strings.Repeat("4", 64), MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg", IndexState: meta.MediaIndexStateReady},
	}
	if err := db.Create(&metadata).Error; err != nil {
		t.Fatal(err)
	}
	assets := []meta.PhotoAsset{
		{OwnerID: owner.ID, PrimaryNodeID: files[0].ID, Kind: meta.PhotoAssetKindImage, EvidenceKey: "node:root"},
		{OwnerID: owner.ID, PrimaryNodeID: files[1].ID, Kind: meta.PhotoAssetKindImage, EvidenceKey: "node:child"},
		{OwnerID: owner.ID, PrimaryNodeID: files[2].ID, Kind: meta.PhotoAssetKindVideo, EvidenceKey: "node:grand"},
		{OwnerID: owner.ID, PrimaryNodeID: files[3].ID, Kind: meta.PhotoAssetKindImage, EvidenceKey: "node:outside"},
	}
	if err := db.Create(&assets).Error; err != nil {
		t.Fatal(err)
	}
	for _, asset := range assets {
		if err := db.Create(&meta.PhotoMetadata{
			AssetID: asset.ID, MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
		}).Error; err != nil {
			t.Fatal(err)
		}
	}

	source := meta.Source{
		OwnerID: owner.ID, Name: "NAS Photos", Kind: "synology_files",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusPaused,
		Revision: 1, TargetNodeID: &syncRoot.ID,
	}
	otherSource := meta.Source{
		OwnerID: other.ID, Name: "Other NAS", Kind: "synology_files",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusActive,
		Revision: 1, TargetNodeID: &otherTarget.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&otherSource).Error; err != nil {
		t.Fatal(err)
	}

	server := &Server{DB: db}
	roots, err := server.queryMediaSyncFolders(context.Background(), owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(roots) != 1 {
		t.Fatalf("sync folders=%+v", roots)
	}
	if roots[0].SourceID != source.ID ||
		roots[0].TargetNodeID != syncRoot.ID ||
		roots[0].TargetPath != "Synology" ||
		roots[0].DirectMediaCount != 1 ||
		roots[0].ChildFolderCount != 2 ||
		roots[0].CoverNodeID == nil ||
		*roots[0].CoverNodeID != files[0].ID {
		t.Fatalf("sync folder root=%+v", roots[0])
	}

	view, err := server.queryMediaFolderView(
		context.Background(),
		owner.ID,
		source.ID,
		syncRoot.ID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if view.Current.ID != syncRoot.ID ||
		view.Current.DirectMediaCount != 1 ||
		view.Current.ChildFolderCount != 2 ||
		len(view.Breadcrumbs) != 1 ||
		view.Breadcrumbs[0].Path != "Synology" ||
		len(view.Children) != 2 ||
		view.Children[0].Name != "2026" ||
		view.Children[0].DirectMediaCount != 1 ||
		view.Children[0].ChildFolderCount != 1 ||
		view.Children[1].Name != "Empty" {
		t.Fatalf("root folder view=%+v", view)
	}

	childView, err := server.queryMediaFolderView(
		context.Background(),
		owner.ID,
		source.ID,
		childA.ID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(childView.Breadcrumbs) != 2 ||
		childView.Breadcrumbs[0].ID != syncRoot.ID ||
		childView.Breadcrumbs[1].ID != childA.ID ||
		childView.Breadcrumbs[1].Path != "Synology/2026" ||
		len(childView.Children) != 1 ||
		childView.Children[0].ID != grandchild.ID ||
		childView.Children[0].Path != "Synology/2026/October" {
		t.Fatalf("child folder view=%+v", childView)
	}

	if _, err := server.queryMediaFolderView(
		context.Background(),
		owner.ID,
		source.ID,
		outside.ID,
	); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("outside folder error=%v", err)
	}
	if _, err := server.queryMediaFolderView(
		context.Background(),
		owner.ID,
		otherSource.ID,
		otherTarget.ID,
	); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("cross-owner folder error=%v", err)
	}

	folderID := childA.ID
	query, err := server.mediaItemsBaseQuery(
		context.Background(),
		owner.ID,
		mediaQueryOptions{FolderID: &folderID},
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	type nodeRow struct{ ID uint64 }
	var rows []nodeRow
	if err := query.Select("n.id AS id").Order("n.id ASC").Scan(&rows).Error; err != nil {
		t.Fatal(err)
	}
	gotIDs := make([]uint64, 0, len(rows))
	for _, row := range rows {
		gotIDs = append(gotIDs, row.ID)
	}
	sort.Slice(gotIDs, func(i, j int) bool { return gotIDs[i] < gotIDs[j] })
	if fmt.Sprint(gotIDs) != fmt.Sprint([]uint64{files[1].ID}) {
		t.Fatalf("folder scoped media=%v want=%v", gotIDs, []uint64{files[1].ID})
	}

	// Direct-only remains the default, while recursive scope is computed by
	// the Server from its owner-scoped live directory tree, not client-loaded media.
	for _, tc := range []struct {
		name      string
		ownerID   uint64
		folderID  uint64
		recursive bool
		expected  []uint64
	}{
		{name: "direct child", ownerID: owner.ID, folderID: childA.ID, expected: []uint64{files[1].ID}},
		{name: "descendants of child", ownerID: owner.ID, folderID: childA.ID, recursive: true, expected: []uint64{files[1].ID, files[2].ID}},
		{name: "descendants of source root", ownerID: owner.ID, folderID: syncRoot.ID, recursive: true, expected: []uint64{files[0].ID, files[1].ID, files[2].ID}},
		{name: "outside subtree", ownerID: owner.ID, folderID: outside.ID, recursive: true, expected: []uint64{files[3].ID}},
		{name: "other owner cannot scope source", ownerID: other.ID, folderID: syncRoot.ID, recursive: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			id := tc.folderID
			scoped, err := server.mediaItemsBaseQuery(context.Background(), tc.ownerID,
				mediaQueryOptions{FolderID: &id, IncludeDescendants: tc.recursive}, "")
			if err != nil {
				t.Fatal(err)
			}
			var matches []nodeRow
			if err := scoped.Select("n.id AS id").Order("n.id ASC").Scan(&matches).Error; err != nil {
				t.Fatal(err)
			}
			actual := make([]uint64, 0, len(matches))
			for _, row := range matches {
				actual = append(actual, row.ID)
			}
			if fmt.Sprint(actual) != fmt.Sprint(tc.expected) && !(len(actual) == 0 && len(tc.expected) == 0) {
				t.Fatalf("scope=%s actual=%v expected=%v", tc.name, actual, tc.expected)
			}
		})
	}

	recursiveID := syncRoot.ID
	recursiveFacets, err := server.queryMediaGalleryFacets(context.Background(),
		owner.ID, mediaQueryOptions{FolderID: &recursiveID, IncludeDescendants: true}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(recursiveFacets.Formats) != 2 || len(recursiveFacets.Cameras) != 2 {
		t.Fatalf("recursive scoped facets should include all descendants: %+v", recursiveFacets)
	}

	facets, err := server.queryMediaGalleryFacets(
		context.Background(),
		owner.ID,
		mediaQueryOptions{FolderID: &folderID},
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(facets.Cameras) != 1 ||
		facets.Cameras[0].Value != "sony ilce-7m4" ||
		facets.Cameras[0].ItemCount != 1 ||
		len(facets.Formats) != 1 ||
		facets.Formats[0].Value != "image/jpeg" {
		t.Fatalf("folder scoped facets=%+v", facets)
	}
}
