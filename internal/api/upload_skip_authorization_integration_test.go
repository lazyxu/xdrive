package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
)

// Skip conflicts mutate UploadSession metadata even though no bytes are
// transferred; they must recheck Source ACL in that SQL transaction.
func TestSkippedUploadSessionRequiresLiveTargetAndAudit(t *testing.T) {
	db, s, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.UploadSession{}, &meta.UploadPart{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	ctx := func() (*gin.Context, *httptest.ResponseRecorder) {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/uploads", nil)
		c.Set("userID", owner.ID)
		return c, recorder
	}
	ordinary := createFilePropertiesDir(t, db, owner.ID, root.ID, "Ordinary")
	existing := createFilePropertiesFile(t, db, owner.ID, ordinary.ID, "existing.txt", 4)
	req := uploadInitRequest{
		ParentID:       &ordinary.ID,
		Name:           existing.Name,
		RequestedName:  existing.Name,
		ConflictPolicy: meta.UploadConflictPolicySkip,
		Size:           4,
		ChunkSize:      defaultUploadChunkSize,
	}
	c, response := ctx()
	s.createSkippedUploadSession(c, owner.ID, req, 1, existing)
	if response.Code != http.StatusOK {
		t.Fatalf("ordinary skip failed: %d %s", response.Code, response.Body.String())
	}
	var row meta.UploadSession
	if err := db.Where("owner_id = ? AND parent_id = ? AND status = ?",
		owner.ID, ordinary.ID, meta.UploadStatusSkipped).Take(&row).Error; err != nil {
		t.Fatal(err)
	}
	var succeeded meta.AuditEvent
	if err := db.Where("action = ? AND result = ?", uploadAuthorizationAuditAction, "success").
		Take(&succeeded).Error; err != nil || succeeded.TargetID != row.ID ||
		!strings.Contains(succeeded.Metadata, `"phase":"session.skip"`) {
		t.Fatalf("skipped upload not audited: %+v %v", succeeded, err)
	}

	protected := createFilePropertiesDir(t, db, owner.ID, root.ID, "Managed")
	private := createFilePropertiesFile(t, db, owner.ID, protected.ID, "private.txt", 4)
	source := meta.Source{
		OwnerID:       owner.ID,
		Name:          "Protected Source",
		Kind:          meta.SourceKindLocalFolder,
		Direction:     meta.SourceDirectionPush,
		SyncMode:      meta.SourceSyncModeBackup,
		RunMode:       meta.SourceRunModeSync,
		Status:        meta.SourceStatusPaused,
		Revision:      1,
		TargetNodeID:  &protected.ID,
		TargetManaged: true,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	forged := req
	forged.ParentID = &protected.ID
	forged.Name, forged.RequestedName = private.Name, private.Name
	c, response = ctx()
	s.createSkippedUploadSession(c, owner.ID, forged, 1, private)
	if response.Code != http.StatusForbidden {
		t.Fatalf("managed skip accepted: %d %s", response.Code, response.Body.String())
	}
	var count int64
	if err := db.Model(&meta.UploadSession{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("denied skip persisted: count=%d err=%v", count, err)
	}
	var denied meta.AuditEvent
	if err := db.Where("action = ? AND result = ?", uploadAuthorizationAuditAction, "failure").
		Take(&denied).Error; err != nil ||
		!strings.Contains(denied.Metadata, `"phase":"session.skip"`) {
		t.Fatalf("managed skip denial not audited: %+v %v", denied, err)
	}
}
