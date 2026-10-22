package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// This administrator-only reveal is deliberately separate from normal
// configuration GET and from the runtime JSAPI resource/session endpoints.
// Audit must commit before any plaintext is returned to the caller.
func (s *Server) adminRevealBaiduJSAPIAK(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("X-Content-Type-Options", "nosniff")
	if s == nil || s.DB == nil || s.ConnectorSecrets == nil {
		fail(c, http.StatusServiceUnavailable, "Browser AK encryption unavailable")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256)
	var input struct {
		Revision *uint64 `json:"revision"`
	}
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var trailing any
	if decoder.Decode(&input) != nil || decoder.Decode(&trailing) != io.EOF ||
		input.Revision == nil || *input.Revision == 0 || *input.Revision > 1<<60 {
		fail(c, http.StatusBadRequest, "valid Browser AK revision required")
		return
	}
	var ak string
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var row meta.AdminServiceSecret
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", baiduJSAPISecretName).Take(&row).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errBaiduJSAPIConflict
		}
		if err != nil {
			return err
		}
		if row.Revision != *input.Revision || row.KeyVersion == 0 || len(row.Ciphertext) == 0 {
			return errBaiduJSAPIConflict
		}
		plaintext, err := s.ConnectorSecrets.Open(
			baiduJSAPISecretAADID, baiduJSAPISecretKind, row.KeyVersion, row.Ciphertext)
		if err != nil {
			return err
		}
		ak = string(plaintext)
		clear(plaintext)
		if !validBaiduMapAK(ak) {
			return errors.New("stored Browser AK invalid")
		}
		return recordAuditTx(tx, auditEventFromContext(c,
			"admin.service.baidu_jsapi.reveal", "service", baiduJSAPISecretName,
			"Browser AK revealed to administrator", auditpkg.ResultSuccess,
			map[string]any{"revision": row.Revision, "field": "browser_ak"},
		))
	})
	if errors.Is(err, errBaiduJSAPIConflict) {
		fail(c, http.StatusConflict, "Browser AK changed or not configured")
		return
	}
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Browser AK reveal or audit unavailable")
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"field": "browser_ak", "value": ak, "revision": *input.Revision,
		"expires_in_seconds": 30,
	})
}
