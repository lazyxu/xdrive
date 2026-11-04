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

func TestLegacyMigrationPreviewReportsMixedOwnerWritesAndSharesReadOnly(t *testing.T) {
	db, server, owner, stranger, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.Share{}, &meta.SyncRun{}, &meta.UploadSession{},
		&meta.FileOperation{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("source-migration-preview-test", time.Hour)
	router := server.Router()
	ownerJWT, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	strangerJWT, err := server.Auth.Issue(stranger.ID, stranger.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	target := createFilePropertiesDir(t, db, owner.ID, root.ID, "legacy-target")
	verified := createFilePropertiesFile(t, db, owner.ID, target.ID, "photo.jpg", 8)
	ordinary := createFilePropertiesFile(t, db, owner.ID, target.ID, "ordinary.pdf", 12)
	targetID := target.ID
	source := meta.Source{OwnerID: owner.ID, Name: "Legacy",
		Kind: "yike_photos", Direction: meta.SourceDirectionPull,
		SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeScan,
		Status: meta.SourceStatusPaused, Revision: 1, TargetNodeID: &targetID}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	item := meta.SourceItem{SourceID: source.ID, ExternalID: "remote:photo",
		NodeID: &verified.ID, NodeRevision: verified.Revision,
		Kind: meta.SourceItemKindFile, Path: verified.Name,
		State: meta.SourceItemStateSynced, LastSeenAt: time.Now().UTC()}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}
	foreign := meta.Node{ParentID: &target.ID, OwnerID: stranger.ID,
		Name: "foreign-node", Type: meta.NodeTypeFile, Revision: 1}
	if err := db.Create(&foreign).Error; err != nil {
		t.Fatal(err)
	}
	directShare := meta.Share{OwnerID: owner.ID, NodeID: target.ID,
		TokenHash: strings.Repeat("e", 64), Access: "read_only"}
	if err := db.Create(&directShare).Error; err != nil {
		t.Fatal(err)
	}
	upload := meta.UploadSession{ID: uuid.NewString(), OwnerID: owner.ID,
		ParentID: &target.ID, Status: meta.UploadStatusActive, TotalSize: 8,
		ChunkSize: 8, ChunkCount: 1, ExpiresAt: time.Now().Add(time.Hour)}
	if err := db.Create(&upload).Error; err != nil {
		t.Fatal(err)
	}
	op := meta.FileOperation{ID: uuid.NewString(), OwnerID: owner.ID,
		Type: meta.FileOperationTypeMove, Status: meta.FileOperationStatusQueued,
		ItemsJSON: "[]"}
	if err := db.Create(&op).Error; err != nil {
		t.Fatal(err)
	}
	path := fmt.Sprintf("/api/v1/sources/%d/migration-preview", source.ID)
	request(t, router, http.MethodGet, path, strangerJWT, nil, http.StatusNotFound)
	res := request(t, router, http.MethodGet, path, ownerJWT, nil, http.StatusOK)
	var preview sourceLegacyMigrationPreview
	if err := json.Unmarshal(res.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	contains := func(code string) bool {
		for _, blocker := range preview.Blockers {
			if blocker == code {
				return true
			}
		}
		return false
	}
	if !preview.ReadOnly || preview.Classification != "blocked" ||
		preview.SourceID != source.ID || preview.TargetNodeID == nil ||
		*preview.TargetNodeID != target.ID || preview.VerifiedNodes != 1 ||
		preview.OrdinaryNodes != 1 || preview.ForeignOwnerNodes != 1 ||
		preview.DirectRootShares != 1 || preview.ActiveUploads != 1 ||
		preview.UnfinishedFilesJobs != 1 ||
		!contains("foreign_owner_descendants") || !contains("active_upload") ||
		!contains("unfinished_files_operation") {
		t.Fatalf("legacy Source preview missed blockers: %+v", preview)
	}
	var sameSource meta.Source
	var stillVerified, stillOrdinary, stillForeign meta.Node
	var sameShare meta.Share
	for _, err := range []error{
		db.First(&sameSource, source.ID).Error,
		db.First(&stillVerified, verified.ID).Error,
		db.First(&stillOrdinary, ordinary.ID).Error,
		db.First(&stillForeign, foreign.ID).Error,
		db.First(&sameShare, directShare.ID).Error,
	} {
		if err != nil {
			t.Fatal(err)
		}
	}
	if sameSource.Revision != source.Revision || sameSource.Status != source.Status ||
		stillVerified.ParentID == nil || *stillVerified.ParentID != target.ID ||
		stillOrdinary.ParentID == nil || *stillOrdinary.ParentID != target.ID ||
		stillForeign.ParentID == nil || *stillForeign.ParentID != target.ID ||
		sameShare.NodeID != target.ID || sameShare.TokenHash != directShare.TokenHash {
		t.Fatal("read-only migration preview mutated a Source, Node or direct Share")
	}
}

func TestLegacyMigrationPreviewDoesNotExposeLocalPushRootToOwnerJWT(t *testing.T) {
	db, server, owner, _, root := setupFilePropertiesTestDB(t)
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("local-migration-preview-denial", time.Hour)
	router := server.Router()
	token, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	target := createFilePropertiesDir(t, db, owner.ID, root.ID, "local-private")
	source := meta.Source{OwnerID: owner.ID, Name: "Device backup",
		Kind: meta.SourceKindLocalFolder, Direction: meta.SourceDirectionPush,
		SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeSync,
		Status: meta.SourceStatusPaused, Revision: 1, TargetNodeID: &target.ID}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/sources/%d/migration-preview", source.ID),
		token, nil, http.StatusForbidden)
}
