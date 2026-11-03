package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

// The target marker must be earned by server provisioning/migration, never
// inferred from a directory name. Existing Yike targets predate that marker.
func TestManagedSourceGuardUsesIdentityNotPathString(t *testing.T) {
	db, _, owner, _, root := setupFilePropertiesTestDB(t)
	umbrella := createFilePropertiesDir(t, db, owner.ID, root.ID, "同步文件夹")
	pull := createFilePropertiesDir(t, db, owner.ID, umbrella.ID, "远程拉取")
	connector := createFilePropertiesDir(t, db, owner.ID, pull.ID, "Synology Photos")
	managed := createFilePropertiesDir(t, db, owner.ID, connector.ID, "受管")
	child := createFilePropertiesDir(t, db, owner.ID, managed.ID, "2026")
	photo := createFilePropertiesFile(t, db, owner.ID, child.ID, "a.jpg", 6)
	ordinary := createFilePropertiesDir(t, db, owner.ID, connector.ID, "普通")
	legacy := createFilePropertiesDir(t, db, owner.ID, root.ID, "旧同步根")
	yike := createFilePropertiesDir(t, db, owner.ID, root.ID, "uid_888_Yike")
	for _, source := range []meta.Source{
		{
			OwnerID: owner.ID, Name: "受管", Kind: synologySourceKind, Direction: meta.SourceDirectionPull,
			SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeSync,
			Status: meta.SourceStatusPaused, Revision: 1, TargetNodeID: &managed.ID, TargetManaged: true,
		},
		{
			OwnerID: owner.ID, Name: "旧来源", Kind: synologySourceKind, Direction: meta.SourceDirectionPull,
			SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeSync,
			Status: meta.SourceStatusPaused, Revision: 1, TargetNodeID: &legacy.ID,
		},
		{
			OwnerID: owner.ID, Name: "Yike 旧记录", Kind: yikeSourceKind, Direction: meta.SourceDirectionPull,
			SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeSync,
			Status: meta.SourceStatusPaused, Revision: 1, TargetNodeID: &yike.ID,
		},
	} {
		if err := db.Create(&source).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct {
		node            uint64
		inside, touches bool
	}{
		{root.ID, false, true},
		{umbrella.ID, false, true},
		{pull.ID, false, true},
		{connector.ID, false, true},
		{managed.ID, true, true},
		{child.ID, true, true},
		{photo.ID, true, true},
		{ordinary.ID, false, false},
		{legacy.ID, false, false},
		{yike.ID, true, true},
	} {
		inside, err := managedSourceNodeInTargetDB(context.Background(), db, owner.ID, tc.node)
		if err != nil {
			t.Fatal(err)
		}
		touches, err := managedSourceMutationTouchesDB(context.Background(), db, owner.ID, tc.node)
		if err != nil {
			t.Fatal(err)
		}
		if inside != tc.inside || touches != tc.touches {
			t.Fatalf("node=%d inside=%v touches=%v want=%v/%v",
				tc.node, inside, touches, tc.inside, tc.touches)
		}
	}
	if err := requireOrdinarySourceTargetTx(context.Background(), db, owner.ID, photo.ID); err != errManagedSourceWriteDenied {
		t.Fatalf("managed file writable: %v", err)
	}
	if err := requireOrdinarySourceTargetTx(context.Background(), db, owner.ID, ordinary.ID); err != nil {
		t.Fatalf("normal folder protected by sibling Source: %v", err)
	}
}

func TestManagedSourceGuardBlocksFilesWritesAndAllowsOrdinaryNeighbor(t *testing.T) {
	db, srv, owner, _, root := setupFilePropertiesTestDB(t)
	gin.SetMode(gin.TestMode)
	srv.Auth = auth.New("managed-target-write-guard", time.Hour)
	router := srv.Router()
	token, err := srv.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	umbrella := createFilePropertiesDir(t, db, owner.ID, root.ID, "同步文件夹")
	pull := createFilePropertiesDir(t, db, owner.ID, umbrella.ID, "远程拉取")
	connector := createFilePropertiesDir(t, db, owner.ID, pull.ID, "Synology Photos")
	target := createFilePropertiesDir(t, db, owner.ID, connector.ID, "远端照片")
	sub := createFilePropertiesDir(t, db, owner.ID, target.ID, "2026")
	file := createFilePropertiesFile(t, db, owner.ID, sub.ID, "photo.jpg", 1)
	ordinary := createFilePropertiesDir(t, db, owner.ID, connector.ID, "普通")
	src := meta.Source{
		OwnerID: owner.ID, Name: target.Name, Kind: synologySourceKind,
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusPaused,
		Revision: 1, TargetNodeID: &target.ID, TargetManaged: true,
	}
	if err := db.Create(&src).Error; err != nil {
		t.Fatal(err)
	}
	request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", sub.ID),
		token, strings.NewReader(`{"name":"evil"}`), http.StatusConflict)
	request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID),
		token, strings.NewReader(`{"name":"正常目录"}`), http.StatusCreated)
	requestWithHeaders(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/nodes/%d", file.ID),
		token, strings.NewReader(`{"name":"evil.jpg"}`), http.StatusConflict,
		map[string]string{"If-Match": `"1"`})
	requestWithHeaders(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/nodes/%d", file.ID),
		token, nil, http.StatusConflict, map[string]string{"If-Match": `"1"`})
	requestWithHeaders(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/nodes/%d", connector.ID),
		token, strings.NewReader(`{"name":"evilParent"}`), http.StatusConflict,
		map[string]string{"If-Match": `"1"`})
	request(t, router, http.MethodPost, "/api/v1/uploads", token,
		strings.NewReader(fmt.Sprintf(`{"parent_id":%d,"name":"bad.jpg","size":0}`, sub.ID)), http.StatusConflict)
	request(t, router, http.MethodPost, "/api/v1/uploads", token,
		strings.NewReader(fmt.Sprintf(`{"node_id":%d,"size":0}`, file.ID)), http.StatusConflict)
	request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", ordinary.ID),
		token, strings.NewReader(`{"name":"safe"}`), http.StatusCreated)
	var reloaded meta.Node
	if err := db.First(&reloaded, file.ID).Error; err != nil {
		t.Fatal(err)
	}
	if reloaded.Name != "photo.jpg" || reloaded.DeletedAt != nil ||
		reloaded.ParentID == nil || *reloaded.ParentID != sub.ID {
		t.Fatalf("managed photo modified by Files: %+v", reloaded)
	}
}

func TestManagedSourceGuardLargeSubtreeIDsBoundedSQL(t *testing.T) {
	db, _, owner, _, root := setupFilePropertiesTestDB(t)
	id := root.ID
	source := meta.Source{
		OwnerID: owner.ID, Name: "Large test", Kind: synologySourceKind,
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusPaused,
		Revision: 1, TargetNodeID: &id, TargetManaged: true,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	// 70k IDs intentionally exceed PostgreSQL's maximum expanded bind
	// arguments, but checking Source roots should remain O(Source count).
	many := make([]uint64, 70000)
	for i := range many {
		many[i] = uint64(i) + 100000
	}
	many[len(many)-1] = root.ID
	found, err := managedSourceTargetInIDsDB(context.Background(), db, owner.ID, many)
	if err != nil || !found {
		t.Fatalf("large Source subtree lost a managed root: found=%v err=%v", found, err)
	}
	many[len(many)-1] = 99999999
	found, err = managedSourceTargetInIDsDB(context.Background(), db, owner.ID, many)
	if err != nil || found {
		t.Fatalf("large ordinary subtree was misclassified: found=%v err=%v", found, err)
	}
}
