package api

import (
	"errors"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

func TestUploadAuthorizationAuditCommitsWithProtectedTransaction(t *testing.T) {
	db, _, owner, _, root := setupFilePropertiesTestDB(t)
	parent := createFilePropertiesDir(t, db, owner.ID, root.ID, "upload-audit")
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("PUT", "/api/v1/uploads/audit/chunks/0", nil)
	session := meta.UploadSession{
		ID: uuid.NewString(), OwnerID: owner.ID, ParentID: &parent.ID,
		Status: meta.UploadStatusActive,
	}
	if err := db.Transaction(func(tx *gorm.DB) error {
		if err := authorizeUploadSessionWriteTx(c.Request.Context(), tx, c, session); err != nil {
			return err
		}
		return recordUploadAuthorizationTx(tx, c, session, "chunk", parent.ID)
	}); err != nil {
		t.Fatalf("authorized upload transaction failed: %v", err)
	}
	var count int64
	if err := db.Model(&meta.AuditEvent{}).Where("action = ? AND target_id = ?", "upload.authorization", session.ID).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("expected one committed upload authorization event, got %d", count)
	}
	rollbackID := uuid.NewString()
	err := db.Transaction(func(tx *gorm.DB) error {
		rolledBack := session
		rolledBack.ID = rollbackID
		if err := recordUploadAuthorizationTx(tx, c, rolledBack, "finalize", parent.ID); err != nil {
			return err
		}
		return errors.New("force protected write rollback")
	})
	if err == nil {
		t.Fatal("expected rollback sentinel")
	}
	if err := db.Model(&meta.AuditEvent{}).Where("action = ? AND target_id = ?", "upload.authorization", rollbackID).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("audit event survived rollback of protected transaction: %d", count)
	}
}
