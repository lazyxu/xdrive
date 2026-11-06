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
	if err := db.AutoMigrate(&meta.AuditEvent{}, &meta.LocalPushCommonUploadOperation{}); err != nil {
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
		SourceRootID:          uuid.NewString(), ResumeKey: "secret_resume_1234",
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
	op := meta.LocalPushCommonUploadOperation{
		OperationID: uuid.NewString(), OwnerID: owner.ID, OwnerSession: 1,
		DeviceID: uuid.NewString(), RootID: uuid.NewString(),
		RootFingerprint: strings.Repeat("a", 64), SourceID: 42,
		SourceRevision: 3, SourceTargetID: 12, ResumeKey: "lp2_" + strings.Repeat("b", 64),
		ContentSHA256: strings.Repeat("c", 64), TotalSize: 1024,
		State: meta.LocalPushCommonUploadReserved,
	}
	if err := db.Transaction(func(tx *gorm.DB) error {
		return recordUploadAuthorizationOperationSuccessTx(tx, c, "local_push.operation.admit", op)
	}); err != nil {
		t.Fatal(err)
	}
	server := &Server{DB: db}
	server.recordUploadAuthorizationFailure(c, "finalize.commit", session, errManagedSourceWriteDenied)
	server.recordUploadAuthorizationOperationFailure(c, "local_push.operation.admit", op.SourceID,
		op.SourceRevision, localSourceExecutorProof{DeviceID: op.DeviceID}, errLocalPushCommonUploadUnavailable)
	var rows []meta.AuditEvent
	if err := db.Order("id ASC").Find(&rows).Error; err != nil || len(rows) != 4 {
		t.Fatalf("missing committed/denied authorization audits: count=%d err=%v", len(rows), err)
	}
	if rows[0].Action != uploadAuthorizationAuditAction || rows[0].Result != "success" ||
		rows[1].Action != uploadAuthorizationAuditAction || rows[1].Result != "success" ||
		rows[2].Action != uploadAuthorizationAuditAction || rows[2].Result != "failure" ||
		rows[3].Action != uploadAuthorizationAuditAction || rows[3].Result != "failure" {
		t.Fatalf("wrong audit outcomes: %+v", rows)
	}
	for i, row := range rows {
		for _, secret := range []string{
			session.ResumeKey, session.SourceRootFingerprint, session.SourceRootID,
			op.ResumeKey, op.RootID, op.RootFingerprint, op.ContentSHA256,
		} {
			if secret != "" && strings.Contains(row.Metadata, secret) {
				t.Fatalf("secret or Root proof leaked in upload authorization audit: %s", row.Metadata)
			}
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(row.Metadata), &m); err != nil {
			t.Fatal(err)
		}
		if i == 0 && (m["source_id"] != float64(session.SourceID) ||
			m["device_id"] != session.SourceDeviceID ||
			m["target_node_id"] != float64(session.SourceTargetID)) {
			t.Fatalf("session audit lost owning Device/Source/Target: %v", m)
		}
		if i == 1 && (m["source_id"] != float64(op.SourceID) ||
			m["device_id"] != op.DeviceID ||
			m["target_node_id"] != float64(op.SourceTargetID) ||
			m["phase"] != "local_push.operation.admit") {
			t.Fatalf("Local Push operation audit lost Device/Source/Target: %v", m)
		}
	}
}
