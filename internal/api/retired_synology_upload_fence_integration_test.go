package api

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
)

// A historical source ID and even a matching Owner/Device token are not a
// capability after standalone DSM Photos Push retirement. This regression
// protects the canonical shared UploadSession preflight and Finalize gates.
func TestRetiredDSMPhotosSourceIDNeverGrantsGenericUpload(t *testing.T) {
	db, _, owner, _, root := setupFilePropertiesTestDB(t)
	target := createFilePropertiesDir(t, db, owner.ID, root.ID, "old DSM Photos")
	source := meta.Source{
		OwnerID: owner.ID, Name: "legacy DSM Photos",
		Kind: synologySourceKind, Direction: meta.SourceDirectionPush,
		Status: meta.SourceStatusActive, SyncMode: meta.SourceSyncModeBackup,
		Revision: 7, TargetNodeID: &target.ID, TargetManaged: true,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/uploads", nil)
	c.Set("userID", owner.ID)
	c.Request.Header.Set("X-XDrive-Synology-Source-ID", "1")
	c.Request.Header.Set("X-XDrive-Device-Token", "legacy-device-secret")
	request := uploadInitRequest{
		ParentID: &target.ID, Name: "new.jpg",
		SourceID: source.ID, SourceRevision: source.Revision,
	}
	if err := requireSourceRunOrLocalPushTargetTx(
		context.Background(), db, c, owner.ID, target.ID, request,
	); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("retired DSM SourceID gained upload-init authority: %v", err)
	}
	session := meta.UploadSession{
		ID:      "f3bd2c81-8e6b-4b3c-b891-c6caeb5dd941",
		OwnerID: owner.ID, ParentID: &target.ID,
		Name: "new.jpg", RequestedName: "new.jpg",
		SourceID: source.ID, SourceRevision: source.Revision,
		SourceTargetID: target.ID, Status: meta.UploadStatusActive,
		ExpiresAt: time.Now().Add(time.Hour),
	}
	if err := requireSourceRunOrLocalPushFinalizeTx(
		context.Background(), db, c, session, target.ID,
	); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("retired DSM SourceID gained finalize authority: %v", err)
	}
}
