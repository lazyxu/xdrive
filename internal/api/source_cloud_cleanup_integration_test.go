package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

func sourceCleanupFixture(t *testing.T) (*Server, meta.User, meta.User, meta.Source, meta.Node, meta.Node, string, string) {
	t.Helper()
	db, server, owner, other, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.SyncRun{}, &meta.UploadSession{}, &meta.Share{},
		&meta.FileVersion{}, &meta.FileOperation{}); err != nil {
		t.Fatal(err)
	}
	// Source cloud cleanup is exclusively for a verified managed leaf, not
	// an arbitrary legacy directory or an owner-chosen Files folder.
	syncRoot := createFilePropertiesDir(t, db, owner.ID, root.ID, "同步文件夹")
	pullRoot := createFilePropertiesDir(t, db, owner.ID, syncRoot.ID, "Pull")
	connector := createFilePropertiesDir(t, db, owner.ID, pullRoot.ID, "Yike Photos")
	target := createFilePropertiesDir(t, db, owner.ID, connector.ID, "归档相册")
	photo := createFilePropertiesFile(t, db, owner.ID, target.ID, "original.jpg", 12)
	src := meta.Source{
		OwnerID: owner.ID, Name: target.Name, Kind: "yike_photos",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusArchived,
		Revision: 2, TargetManaged: true, TargetNodeID: &target.ID,
	}
	if err := db.Create(&src).Error; err != nil {
		t.Fatal(err)
	}
	item := meta.SourceItem{
		SourceID: src.ID, ExternalID: "remote/original.jpg", NodeID: &photo.ID,
		Kind: meta.SourceItemKindFile, Path: "original.jpg",
		State: meta.SourceItemStateSynced, NodeRevision: photo.Revision,
		LastSeenAt: time.Now().UTC(),
	}
	finished := time.Now().UTC()
	run := meta.SyncRun{ID: uuid.NewString(), SourceID: src.ID, SourceRevision: 1,
		Mode: meta.SourceRunModeSync, Trigger: meta.SyncRunTriggerManual,
		Status: meta.SyncRunStatusCompleted, StartedAt: finished.Add(-time.Minute),
		FinishedAt: &finished}
	version := meta.FileVersion{NodeID: photo.ID, Revision: 1, Size: 12,
		SHA256: strings.Repeat("b", 64), StorageKey: "cloud-cleanup-original"}
	for _, err := range []error{
		db.Create(&item).Error, db.Create(&run).Error, db.Create(&version).Error,
	} {
		if err != nil {
			t.Fatal(err)
		}
	}
	server.Auth = auth.New("cloud-only-cleanup-test", time.Hour)
	ownerToken, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	otherToken, err := server.Auth.Issue(other.ID, other.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	return server, owner, other, src, target, photo, ownerToken, otherToken
}

func TestSourceCloudOnlyCleanupPreviewConfirmTrashAndRestore(t *testing.T) {
	server, owner, _, src, target, photo, token, foreignToken := sourceCleanupFixture(t)
	db := server.DB
	gin.SetMode(gin.TestMode)
	router := server.Router()
	path := fmt.Sprintf("/api/v1/sources/%d/cloud-cleanup", src.ID)
	requestWithHeaders(t, router, http.MethodGet, path+"/preview",
		foreignToken, nil, http.StatusNotFound, nil)
	requestWithHeaders(t, router, http.MethodPost, path+"/trash",
		token, strings.NewReader(`{}`), http.StatusBadRequest, map[string]string{"If-Match": `"2"`})
	resp := requestWithHeaders(t, router, http.MethodGet, path+"/preview",
		token, nil, http.StatusOK, nil)
	var preview sourceCloudCleanupPreviewDTO
	if err := json.Unmarshal(resp.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	if preview.SourceID != src.ID || preview.TargetNodeID != target.ID ||
		preview.SourceRevision != 2 || preview.TargetRevision != 1 ||
		preview.NodeCount != 2 || preview.FileCount != 1 ||
		len(preview.PreviewDigest) != 64 || !preview.Reversible {
		t.Fatalf("cleanup preview must be exact and reversible: %+v", preview)
	}
	post := func(digest, name string, revision string, status int) {
		t.Helper()
		body := fmt.Sprintf(`{"preview_digest":%q,"confirm_name":%q,"target_node_id":%d,"target_revision":%d}`,
			digest, name, preview.TargetNodeID, preview.TargetRevision)
		requestWithHeaders(t, router, http.MethodPost, path+"/trash",
			token, strings.NewReader(body), status, map[string]string{"If-Match": revision})
	}
	post(preview.PreviewDigest, "wrong confirmation", `"2"`, http.StatusConflict)
	post(preview.PreviewDigest, src.Name, `"1"`, http.StatusConflict)

	// A changed target revision invalidates a real preview; rollback the
	// revision to show the exact original report can still be used.
	if err := db.Model(&meta.Node{}).Where("id = ?", target.ID).
		Update("revision", 2).Error; err != nil {
		t.Fatal(err)
	}
	post(preview.PreviewDigest, src.Name, `"2"`, http.StatusConflict)
	if err := db.Model(&meta.Node{}).Where("id = ?", target.ID).
		Update("revision", 1).Error; err != nil {
		t.Fatal(err)
	}
	post(preview.PreviewDigest, src.Name, `"2"`, http.StatusOK)

	var savedSource meta.Source
	var savedTarget, savedFile meta.Node
	var savedRun meta.SyncRun
	var savedItem meta.SourceItem
	var savedVersion meta.FileVersion
	for _, err := range []error{
		db.First(&savedSource, src.ID).Error,
		db.First(&savedTarget, target.ID).Error,
		db.First(&savedFile, photo.ID).Error,
		db.Where("source_id = ?", src.ID).First(&savedRun).Error,
		db.Where("source_id = ?", src.ID).First(&savedItem).Error,
		db.Where("node_id = ?", photo.ID).First(&savedVersion).Error,
	} {
		if err != nil {
			t.Fatal(err)
		}
	}
	if savedSource.Status != meta.SourceStatusArchived || savedSource.Revision != 2 ||
		savedSource.TargetNodeID == nil || *savedSource.TargetNodeID != target.ID ||
		savedTarget.DeletedAt == nil || savedFile.DeletedAt == nil ||
		savedTarget.TrashRootID == nil || *savedTarget.TrashRootID != target.ID ||
		savedFile.TrashRootID == nil || *savedFile.TrashRootID != target.ID ||
		savedItem.NodeID == nil || *savedItem.NodeID != photo.ID ||
		savedRun.Status != meta.SyncRunStatusCompleted ||
		savedVersion.StorageKey != "cloud-cleanup-original" {
		t.Fatalf("cleanup must only tombstone the cloud subtree: src=%+v target=%+v file=%+v", savedSource, savedTarget, savedFile)
	}
	requestWithHeaders(t, router, http.MethodGet, path+"/preview",
		token, nil, http.StatusNotFound, nil)
	post(preview.PreviewDigest, src.Name, `"2"`, http.StatusNotFound)
	// Historical SourceItem/Run/CAS references make ordinary permanent Trash
	// deletion unsafe. It must fail, leaving the reversible target intact.
	permanentPath := fmt.Sprintf("/api/v1/trash/%d", target.ID)
	requestWithHeaders(t, router, http.MethodDelete, permanentPath,
		token, nil, http.StatusConflict, map[string]string{"If-Match": `"2"`})

	// Existing reversible Trash route restores both cloud Nodes. The Source
	// itself remains archived (no automatic remote import or local scan).
	trashPath := fmt.Sprintf("/api/v1/trash/%d/restore", target.ID)
	requestWithHeaders(t, router, http.MethodPost, trashPath,
		token, strings.NewReader(`{}`), http.StatusOK,
		map[string]string{"If-Match": `"2"`})
	savedTarget = meta.Node{}
	savedFile = meta.Node{}
	if err := db.First(&savedTarget, target.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&savedFile, photo.ID).Error; err != nil {
		t.Fatal(err)
	}
	if savedTarget.DeletedAt != nil || savedFile.DeletedAt != nil ||
		savedTarget.TrashRootID != nil || savedFile.TrashRootID != nil {
		t.Fatalf("Trash undo did not restore cloud subtree: target=%+v file=%+v", savedTarget, savedFile)
	}
	if err := db.First(&savedSource, src.ID).Error; err != nil {
		t.Fatal(err)
	}
	if savedSource.Status != meta.SourceStatusArchived {
		t.Fatal("Trash restore must not silently restart archived provider")
	}
	_ = owner
}

func TestSourceCloudCleanupRejectsUnsafeSharesWritersAndCrossSourceHistory(t *testing.T) {
	server, owner, _, src, target, photo, token, _ := sourceCleanupFixture(t)
	db := server.DB
	gin.SetMode(gin.TestMode)
	router := server.Router()
	preview := fmt.Sprintf("/api/v1/sources/%d/cloud-cleanup/preview", src.ID)
	wantBlocked := func() {
		t.Helper()
		requestWithHeaders(t, router, http.MethodGet, preview,
			token, nil, http.StatusConflict, nil)
		var node meta.Node
		if err := db.First(&node, target.ID).Error; err != nil {
			t.Fatal(err)
		}
		if node.DeletedAt != nil {
			t.Fatal("blocked preview deleted managed target")
		}
	}
	share := meta.Share{OwnerID: owner.ID, NodeID: photo.ID,
		TokenHash: strings.Repeat("a", 64), Access: "read_only"}
	if err := db.Create(&share).Error; err != nil {
		t.Fatal(err)
	}
	wantBlocked()
	now := time.Now().UTC()
	if err := db.Model(&meta.Share{}).Where("id = ?", share.ID).
		Update("revoked_at", &now).Error; err != nil {
		t.Fatal(err)
	}
	session := meta.UploadSession{
		ID: uuid.NewString(), OwnerID: owner.ID, SourceID: src.ID,
		SourceRevision: src.Revision, SourceTargetID: target.ID,
		ParentID: &target.ID, Name: "still-pending.jpg",
		ConflictPolicy: meta.UploadConflictPolicyFail,
		TotalSize:      10, ChunkSize: 4096, ChunkCount: 1,
		Status: meta.UploadStatusActive, ExpiresAt: now.Add(time.Hour),
	}
	if err := db.Create(&session).Error; err != nil {
		t.Fatal(err)
	}
	wantBlocked()
	if err := db.Model(&meta.UploadSession{}).Where("id = ?", session.ID).
		Update("status", meta.UploadStatusFinalized).Error; err != nil {
		t.Fatal(err)
	}
	run := meta.SyncRun{ID: uuid.NewString(), SourceID: src.ID, SourceRevision: src.Revision,
		Mode: meta.SourceRunModeSync, Trigger: meta.SyncRunTriggerManual,
		Status: meta.SyncRunStatusRunning, StartedAt: now}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	wantBlocked()
	if err := db.Model(&meta.SyncRun{}).Where("id = ?", run.ID).
		Update("status", meta.SyncRunStatusCancelled).Error; err != nil {
		t.Fatal(err)
	}
	otherSource := meta.Source{OwnerID: owner.ID, Name: "Other archived",
		Kind: "yike_photos", Direction: meta.SourceDirectionPull,
		SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeSync,
		Status: meta.SourceStatusArchived, Revision: 1}
	if err := db.Create(&otherSource).Error; err != nil {
		t.Fatal(err)
	}
	foreignItem := meta.SourceItem{
		SourceID: otherSource.ID, ExternalID: "cross-tree",
		NodeID: &photo.ID, Kind: meta.SourceItemKindFile,
		Path: "cross-tree", State: meta.SourceItemStateSynced, LastSeenAt: now,
	}
	if err := db.Create(&foreignItem).Error; err != nil {
		t.Fatal(err)
	}
	wantBlocked()
	if err := db.Delete(&foreignItem).Error; err != nil {
		t.Fatal(err)
	}
	queued := meta.FileOperation{ID: uuid.NewString(), OwnerID: owner.ID,
		Type: meta.FileOperationTypeDelete, Status: meta.FileOperationStatusQueued,
		ItemsJSON: `[]`}
	if err := db.Create(&queued).Error; err != nil {
		t.Fatal(err)
	}
	wantBlocked()
	if err := db.Model(&meta.FileOperation{}).Where("id = ?", queued.ID).
		Update("status", meta.FileOperationStatusCancelled).Error; err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodGet, preview,
		token, nil, http.StatusOK, nil)
}

// A historical cross-Owner parent edge may survive a NOT VALID composite FK.
// An Owner-scoped recursive inventory must not silently omit that node and
// move its parent to Trash. This also protects an already issued preview.
func TestSourceCloudCleanupRejectsCrossOwnerDescendants(t *testing.T) {
	for _, tc := range []struct {
		name, nodeType string
		nested         bool
	}{
		{name: "foreign direct file", nodeType: meta.NodeTypeFile},
		{name: "foreign nested directory", nodeType: meta.NodeTypeDir, nested: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server, owner, other, source, target, photo, token, _ := sourceCleanupFixture(t)
			db := server.DB
			gin.SetMode(gin.TestMode)
			router := server.Router()
			path := fmt.Sprintf("/api/v1/sources/%d/cloud-cleanup", source.ID)

			parentID := target.ID
			if tc.nested {
				parent := createFilePropertiesDir(t, db, owner.ID, target.ID, "nested-album")
				parentID = parent.ID
			}
			before := requestWithHeaders(t, router, http.MethodGet,
				path+"/preview", token, nil, http.StatusOK, nil)
			var preview sourceCloudCleanupPreviewDTO
			if err := json.Unmarshal(before.Body.Bytes(), &preview); err != nil {
				t.Fatal(err)
			}
			foreign := meta.Node{
				OwnerID: other.ID, ParentID: &parentID, Name: "foreign-descendant",
				Type: tc.nodeType, Revision: 1,
			}
			if err := db.Create(&foreign).Error; err != nil {
				t.Fatal(err)
			}
			requestWithHeaders(t, router, http.MethodGet,
				path+"/preview", token, nil, http.StatusConflict, nil)
			body := fmt.Sprintf(`{"preview_digest":%q,"confirm_name":%q,"target_node_id":%d,"target_revision":%d}`,
				preview.PreviewDigest, source.Name, preview.TargetNodeID, preview.TargetRevision)
			requestWithHeaders(t, router, http.MethodPost, path+"/trash",
				token, strings.NewReader(body), http.StatusConflict,
				map[string]string{"If-Match": fmt.Sprintf("%q", fmt.Sprint(source.Revision))})

			for _, id := range []uint64{target.ID, photo.ID, foreign.ID, parentID} {
				var current meta.Node
				if err := db.First(&current, id).Error; err != nil {
					t.Fatal(err)
				}
				if current.DeletedAt != nil || current.TrashRootID != nil {
					t.Fatalf("blocked cleanup must retain all live nodes, id=%d node=%+v", id, current)
				}
			}
			var retained meta.Source
			if err := db.First(&retained, source.ID).Error; err != nil {
				t.Fatal(err)
			}
			if retained.TargetNodeID == nil || *retained.TargetNodeID != target.ID ||
				retained.Revision != source.Revision || retained.Status != meta.SourceStatusArchived {
				t.Fatalf("foreign child changed the Source binding: %+v", retained)
			}
		})
	}
}

// Cross-Owner Source and Share rows can also survive historical upgrades.
// Those references remain authoritative safety blockers even if their claimed
// Owner differs from the actual Node Owner.
func TestSourceCloudCleanupRejectsForeignOwnerSourceAndShareClaims(t *testing.T) {
	for _, claim := range []string{"source target", "active share"} {
		t.Run(claim, func(t *testing.T) {
			server, _, other, source, target, photo, token, _ := sourceCleanupFixture(t)
			db := server.DB
			gin.SetMode(gin.TestMode)
			router := server.Router()
			path := fmt.Sprintf("/api/v1/sources/%d/cloud-cleanup", source.ID)
			before := requestWithHeaders(t, router, http.MethodGet,
				path+"/preview", token, nil, http.StatusOK, nil)
			var preview sourceCloudCleanupPreviewDTO
			if err := json.Unmarshal(before.Body.Bytes(), &preview); err != nil {
				t.Fatal(err)
			}
			if claim == "source target" {
				otherSource := meta.Source{
					OwnerID: other.ID, Name: "historical foreign claim",
					Kind: "yike_photos", Direction: meta.SourceDirectionPull,
					SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeSync,
					Status: meta.SourceStatusArchived, Revision: 1,
					TargetNodeID: &photo.ID,
				}
				if err := db.Create(&otherSource).Error; err != nil {
					t.Fatal(err)
				}
			} else {
				share := meta.Share{
					OwnerID: other.ID, NodeID: photo.ID,
					TokenHash: strings.Repeat("c", 64), Access: "read_only",
				}
				if err := db.Create(&share).Error; err != nil {
					t.Fatal(err)
				}
			}
			requestWithHeaders(t, router, http.MethodGet,
				path+"/preview", token, nil, http.StatusConflict, nil)
			body := fmt.Sprintf(`{"preview_digest":%q,"confirm_name":%q,"target_node_id":%d,"target_revision":%d}`,
				preview.PreviewDigest, source.Name, preview.TargetNodeID, preview.TargetRevision)
			requestWithHeaders(t, router, http.MethodPost, path+"/trash",
				token, strings.NewReader(body), http.StatusConflict,
				map[string]string{"If-Match": fmt.Sprintf("%q", fmt.Sprint(source.Revision))})
			for _, id := range []uint64{target.ID, photo.ID} {
				var current meta.Node
				if err := db.First(&current, id).Error; err != nil {
					t.Fatal(err)
				}
				if current.DeletedAt != nil || current.TrashRootID != nil {
					t.Fatalf("foreign claim mutated a live node: %+v", current)
				}
			}
		})
	}
}

// Cleanup is a deliberately narrow archived Yike Pull option, not an Owner
// back door for device Push backups or dormant Synology connectors. Each case
// uses a valid, matching canonical managed hierarchy so a path mismatch alone
// cannot make this assertion pass.
func TestSourceCloudCleanupRejectsOtherManagedSourceKinds(t *testing.T) {
	for _, tc := range []struct {
		name, kind, direction, connector string
	}{
		{name: "local folder Push", kind: meta.SourceKindLocalFolder, direction: meta.SourceDirectionPush},
		{name: "iOS Photos Push", kind: meta.SourceKindIOSPhotos, direction: meta.SourceDirectionPush},
		{name: "Android Photos Push", kind: meta.SourceKindAndroidPhotos, direction: meta.SourceDirectionPush},
		{name: "retired Synology Photos Push", kind: synologySourceKind, direction: meta.SourceDirectionPush},
		{name: "dormant Synology Photos Pull", kind: synologySourceKind, direction: meta.SourceDirectionPull, connector: "Synology Photos"},
		{name: "dormant Synology Files Pull", kind: synologyFilesSourceKind, direction: meta.SourceDirectionPull, connector: "Synology Files"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server, _, _, source, target, photo, token, _ := sourceCleanupFixture(t)
			db := server.DB
			var connector meta.Node
			if err := db.First(&connector, *target.ParentID).Error; err != nil {
				t.Fatal(err)
			}
			if connector.ParentID == nil {
				t.Fatal("fixture connector lacks Pull parent")
			}
			if tc.direction == meta.SourceDirectionPush {
				// Convert the Yike fixture into a canonical flat Push target:
				// 同步文件夹/Push/<SourceName>.
				if err := db.Model(&meta.Node{}).Where("id = ?", *connector.ParentID).
					Update("name", "Push").Error; err != nil {
					t.Fatal(err)
				}
				if err := db.Model(&meta.Node{}).Where("id = ?", target.ID).
					Update("parent_id", *connector.ParentID).Error; err != nil {
					t.Fatal(err)
				}
			} else if err := db.Model(&meta.Node{}).Where("id = ?", connector.ID).
				Update("name", tc.connector).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&meta.Source{}).Where("id = ?", source.ID).
				Updates(map[string]any{
					"kind": tc.kind, "direction": tc.direction,
				}).Error; err != nil {
				t.Fatal(err)
			}
			gin.SetMode(gin.TestMode)
			router := server.Router()
			path := fmt.Sprintf("/api/v1/sources/%d/cloud-cleanup", source.ID)
			requestWithHeaders(t, router, http.MethodGet, path+"/preview",
				token, nil, http.StatusConflict, nil)
			for _, id := range []uint64{target.ID, photo.ID} {
				var node meta.Node
				if err := db.First(&node, id).Error; err != nil {
					t.Fatal(err)
				}
				if node.DeletedAt != nil || node.TrashRootID != nil {
					t.Fatalf("ineligible Source mutated live cloud nodes: %+v", node)
				}
			}
		})
	}
}
