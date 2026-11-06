package api

import (
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

// The retired DSM Photos Push writer is gone. An abandoned historical
// UploadSession cannot be resumed, but it must not prevent its Owner from
// archiving the Source and retaining the original Node/SourceItem/CAS history.
func TestRetiredSynologyPushArchiveDoesNotWaitForUnresumableSession(t *testing.T) {
	db, server, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.SyncRun{}, &meta.UploadSession{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("retired-synology-unsettled-session", time.Hour)
	router := server.Router()
	token, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	target := createFilePropertiesDir(t, db, owner.ID, root.ID, "retired managed push")
	original := createFilePropertiesFile(t, db, owner.ID, target.ID, "existing.jpg", 7)
	source := meta.Source{
		OwnerID: owner.ID, Name: "Retired DSM Photos", Kind: synologySourceKind,
		Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusActive,
		Revision: 1, TargetNodeID: &target.ID, TargetManaged: true,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	session := meta.UploadSession{
		ID: uuid.NewString(), OwnerID: owner.ID, SourceID: source.ID,
		SourceRevision: source.Revision, SourceTargetID: target.ID,
		ParentID: &target.ID, Name: "abandoned.jpg",
		ConflictPolicy: meta.UploadConflictPolicyFail,
		TotalSize:      8, ChunkSize: 4 << 20, ChunkCount: 1,
		Status: meta.UploadStatusActive, ExpiresAt: time.Now().UTC().Add(time.Hour),
	}
	if err := db.Create(&session).Error; err != nil {
		t.Fatal(err)
	}
	// A valid Owner token is not permission to resume the retired writer.
	uploadPath := "/api/v1/uploads/" + session.ID
	request(t, router, http.MethodGet, uploadPath, token, nil, http.StatusForbidden)

	sourcePath := fmt.Sprintf("/api/v1/sources/%d/archive", source.ID)
	requestWithHeaders(t, router, http.MethodPost, sourcePath, token,
		strings.NewReader(""), http.StatusOK, map[string]string{"If-Match": `"1"`})
	var after meta.Source
	var kept meta.Node
	var oldSession meta.UploadSession
	if err := db.First(&after, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&kept, original.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&oldSession, session.ID).Error; err != nil {
		t.Fatal(err)
	}
	if after.Status != meta.SourceStatusArchived || after.Revision != 2 ||
		after.TargetNodeID == nil || *after.TargetNodeID != target.ID ||
		kept.ParentID == nil || *kept.ParentID != target.ID ||
		oldSession.SourceID != source.ID {
		t.Fatalf("retirement archive lost original Source/Node/session identity: source=%+v node=%+v session=%+v",
			after, kept, oldSession)
	}
	request(t, router, http.MethodGet, uploadPath, token, nil, http.StatusForbidden)
}
