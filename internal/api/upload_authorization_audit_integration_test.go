package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

func TestUploadAuthorizationAuditFollowsWriteTransactionAndRedactsSecrets(t *testing.T) {
	db, _, owner, _, _ := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPut, "/api/v1/uploads/example/chunks/0", nil)
	c.Request.Header.Set("X-Request-ID", "upload-auth-transaction-test")
	session := meta.UploadSession{
		ID: uuid.NewString(), OwnerID: owner.ID, SourceID: 42,
		SourceRevision: 3, SourceDeviceID: uuid.NewString(), SourceTargetID: 12,
		SourceRootFingerprint: strings.Repeat("f", 64),
		SourceRootID: uuid.NewString(), ResumeKey: "secret_resume_1234",
		Status: meta.UploadStatusActive,
	}
	rollback := errors.New("force transaction rollback")
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := recordUploadAuthorizationSuccessTx(tx, c, "chunk.commit", session); err != nil {
			return err
		}
		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatalf("rollback simulation failed: %v", err)
	}
	var count int64
	if err := db.Model(&meta.AuditEvent{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("audit escaped rolled-back upload transaction: count=%d err=%v", count, err)
	}
	if err := db.Transaction(func(tx *gorm.DB) error {
		return recordUploadAuthorizationSuccessTx(tx, c, "chunk.commit", session)
	}); err != nil {
		t.Fatal(err)
	}
	server := &Server{DB: db}
	server.recordUploadAuthorizationFailure(c, "finalize.commit", session, errManagedSourceWriteDenied)
	var rows []meta.AuditEvent
	if err := db.Order("id ASC").Find(&rows).Error; err != nil || len(rows) != 2 {
		t.Fatalf("missing committed/denied authorization audits: count=%d err=%v", len(rows), err)
	}
	if rows[0].Action != uploadAuthorizationAuditAction || rows[0].Result != "success" ||
		rows[1].Action != uploadAuthorizationAuditAction || rows[1].Result != "failure" {
		t.Fatalf("wrong audit outcomes: %+v", rows)
	}
	for _, row := range rows {
		if strings.Contains(row.Metadata, session.ResumeKey) ||
			strings.Contains(row.Metadata, session.SourceRootFingerprint) ||
			strings.Contains(row.Metadata, session.SourceRootID) {
			t.Fatalf("secret or Root proof leaked in upload authorization audit: %s", row.Metadata)
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(row.Metadata), &m); err != nil {
			t.Fatal(err)
		}
		if m["source_id"] != float64(session.SourceID) || m["device_id"] != session.SourceDeviceID ||
			m["target_node_id"] != float64(session.SourceTargetID) {
			t.Fatalf("audit lost owning Device/Source/Target: %v", m)
		}
	}
}
