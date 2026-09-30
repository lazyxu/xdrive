package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourcecredential"
	"github.com/lazyxu/xdrive/internal/synology"
	"github.com/lazyxu/xdrive/internal/yike"
	"gorm.io/gorm"
)

const (
	maxSourceCredentialPayloadBytes = 64 << 10
	sourceCredentialTestTimeout     = 15 * time.Second
)

var (
	errUnsupportedSourceCredentialTest = errors.New("unsupported source credential kind")
	errInvalidSourceCredentialTest     = errors.New("invalid source credential payload")
)

type sourceCredentialTestDTO struct {
	Valid             bool   `json:"valid"`
	Kind              string `json:"kind"`
	AccountExternalID string `json:"account_external_id,omitempty"`
	AccountName       string `json:"account_name,omitempty"`
}

type sourceCredentialTester func(context.Context, string, json.RawMessage) (sourceCredentialTestDTO, error)

type sourceCredentialStatusDTO struct {
	Configured bool       `json:"configured"`
	KeyVersion uint32     `json:"key_version,omitempty"`
	UpdatedAt  *time.Time `json:"updated_at,omitempty"`
}

func (s *Server) testSourceCredentialPayload(ctx context.Context, kind string, payload json.RawMessage) (sourceCredentialTestDTO, error) {
	tester := s.credentialTest
	if tester == nil {
		tester = defaultSourceCredentialTester
	}
	testCtx, cancel := context.WithTimeout(ctx, sourceCredentialTestTimeout)
	defer cancel()
	return tester(testCtx, kind, append(json.RawMessage(nil), payload...))
}

func (s *Server) testSourceCredential(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxSourceCredentialPayloadBytes+4096)
	var req struct {
		Kind    string          `json:"kind"`
		Payload json.RawMessage `json:"payload"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	req.Kind = strings.TrimSpace(req.Kind)
	if !meta.ValidSourceKind(req.Kind) {
		fail(c, http.StatusBadRequest, "invalid source kind")
		return
	}
	if len(req.Payload) == 0 || len(req.Payload) > maxSourceCredentialPayloadBytes {
		fail(c, http.StatusBadRequest, "credential payload must be between 1 byte and 64 KiB")
		return
	}
	var object map[string]any
	if err := json.Unmarshal(req.Payload, &object); err != nil || object == nil {
		fail(c, http.StatusBadRequest, "credential payload must be a JSON object")
		return
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, req.Payload); err != nil {
		fail(c, http.StatusBadRequest, "invalid credential payload")
		return
	}
	if compact.Len() > maxSourceCredentialPayloadBytes {
		fail(c, http.StatusBadRequest, "credential payload exceeds 64 KiB")
		return
	}

	result, err := s.testSourceCredentialPayload(c.Request.Context(), req.Kind, compact.Bytes())
	if err != nil {
		writeSourceCredentialTestError(c, req.Kind, err)
		return
	}
	result.Valid = true
	result.Kind = req.Kind
	c.JSON(http.StatusOK, result)
}

func writeSourceCredentialTestError(c *gin.Context, kind string, err error) {
	switch {
	case errors.Is(err, errUnsupportedSourceCredentialTest):
		fail(c, http.StatusBadRequest, "unsupported_source_credential_kind")
	case errors.Is(err, errInvalidSourceCredentialTest):
		fail(c, http.StatusBadRequest, "invalid_source_credential")
	case errors.Is(err, yike.ErrAuthentication):
		fail(c, http.StatusUnprocessableEntity, "yike_auth_failed")
	case errors.Is(err, yike.ErrRateLimited):
		fail(c, http.StatusTooManyRequests, "yike_rate_limited")
	case errors.Is(err, context.DeadlineExceeded):
		switch strings.TrimSpace(kind) {
		case yikeSourceKind:
			fail(c, http.StatusGatewayTimeout, "yike_timeout")
		case synologySourceKind:
			fail(c, http.StatusGatewayTimeout, "synology_timeout")
		default:
			fail(c, http.StatusGatewayTimeout, "source_timeout")
		}
	case errors.Is(err, yike.ErrUnavailable):
		fail(c, http.StatusBadGateway, "yike_unavailable")
	default:
		if strings.TrimSpace(kind) == synologySourceKind {
			diagnostic := synology.DiagnoseConnectionError(err)
			status := http.StatusBadGateway
			switch diagnostic.Code {
			case "synology_auth_failed", "synology_photos_unavailable":
				status = http.StatusUnprocessableEntity
			case "synology_timeout":
				status = http.StatusGatewayTimeout
			}
			slog.Warn(
				"source_credential_test_failed",
				"kind", synologySourceKind,
				"code", diagnostic.Code,
				"detail", diagnostic.Detail,
				"error", err,
			)
			failWithDetail(c, status, diagnostic.Code, diagnostic.Detail)
			return
		}
		fail(c, http.StatusBadGateway, "source_connection_failed")
	}
}

func failWithDetail(c *gin.Context, status int, code, detail string) {
	payload := gin.H{"error": strings.TrimSpace(code)}
	if detail = strings.TrimSpace(detail); detail != "" {
		payload["detail"] = detail
	}
	c.AbortWithStatusJSON(status, payload)
}

func defaultSourceCredentialTester(ctx context.Context, kind string, payload json.RawMessage) (sourceCredentialTestDTO, error) {
	switch kind {
	case yikeSourceKind:
		var credential struct {
			Cookie string `json:"cookie"`
		}
		if err := json.Unmarshal(payload, &credential); err != nil {
			return sourceCredentialTestDTO{}, fmt.Errorf("%w: decode Yike credential: %v", errInvalidSourceCredentialTest, err)
		}
		credential.Cookie = strings.TrimSpace(credential.Cookie)
		if credential.Cookie == "" {
			return sourceCredentialTestDTO{}, fmt.Errorf("%w: Yike cookie is empty", errInvalidSourceCredentialTest)
		}
		client, err := yike.New(credential.Cookie)
		credential.Cookie = ""
		if err != nil {
			return sourceCredentialTestDTO{}, fmt.Errorf("%w: %v", errInvalidSourceCredentialTest, err)
		}
		info, err := client.UserInfo(ctx)
		if err != nil {
			return sourceCredentialTestDTO{}, err
		}
		return sourceCredentialTestDTO{
			Valid: true, Kind: kind,
			AccountExternalID: strings.TrimSpace(info.YouaID),
			AccountName:       strings.TrimSpace(info.Nickname),
		}, nil
	case synologySourceKind:
		var credential synology.Credential
		if err := json.Unmarshal(payload, &credential); err != nil {
			return sourceCredentialTestDTO{}, fmt.Errorf("%w: decode Synology credential: %v", errInvalidSourceCredentialTest, err)
		}
		client, err := synology.New(credential)
		credential.Password = ""
		if err != nil {
			return sourceCredentialTestDTO{}, fmt.Errorf("%w: %v", errInvalidSourceCredentialTest, err)
		}
		info, err := client.Test(ctx)
		if err != nil {
			return sourceCredentialTestDTO{}, err
		}
		return sourceCredentialTestDTO{
			Valid:       true,
			Kind:        kind,
			AccountName: strings.TrimSpace(info.Username),
		}, nil
	default:
		return sourceCredentialTestDTO{}, errUnsupportedSourceCredentialTest
	}
}

func (s *Server) testStoredSourceCredential(c *gin.Context) {
	if s.ConnectorSecrets == nil {
		fail(c, http.StatusServiceUnavailable, "source credential encryption is not configured")
		return
	}
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	source, err := s.ownedSource(userID(c), sourceID)
	if err != nil {
		fail(c, statusForLookup(err), "source not found")
		return
	}
	if !sourceUsesStoredCredential(source) {
		fail(c, http.StatusBadRequest, "unsupported_source_credential_kind")
		return
	}
	plaintext, err := sourcecredential.Get(c.Request.Context(), s.DB, s.ConnectorSecrets, source)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusConflict, "source_credential_not_configured")
			return
		}
		fail(c, http.StatusInternalServerError, "load source credential failed")
		return
	}
	defer clear(plaintext)

	result, err := s.testSourceCredentialPayload(c.Request.Context(), source.Kind, json.RawMessage(plaintext))
	if err != nil {
		writeSourceCredentialTestError(c, source.Kind, err)
		return
	}
	result.Valid = true
	result.Kind = source.Kind
	c.JSON(http.StatusOK, result)
}

func (s *Server) getSourceCredentialStatus(c *gin.Context) {
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	source, err := s.ownedSource(userID(c), sourceID)
	if err != nil {
		fail(c, statusForLookup(err), "source not found")
		return
	}
	if !sourceUsesStoredCredential(source) {
		fail(c, http.StatusBadRequest, "unsupported_source_credential_kind")
		return
	}

	var row meta.SourceCredential
	if err := s.DB.Where("source_id = ?", sourceID).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusOK, sourceCredentialStatusDTO{})
			return
		}
		fail(c, http.StatusInternalServerError, "read source credential status failed")
		return
	}
	updated := row.UpdatedAt
	c.JSON(http.StatusOK, sourceCredentialStatusDTO{
		Configured: true, KeyVersion: row.KeyVersion, UpdatedAt: &updated,
	})
}

func (s *Server) putSourceCredential(c *gin.Context) {
	if s.ConnectorSecrets == nil {
		fail(c, http.StatusServiceUnavailable, "source credential encryption is not configured")
		return
	}
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	source, err := s.ownedSource(userID(c), sourceID)
	if err != nil {
		fail(c, statusForLookup(err), "source not found")
		return
	}
	if !sourceUsesStoredCredential(source) {
		fail(c, http.StatusBadRequest, "unsupported_source_credential_kind")
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxSourceCredentialPayloadBytes+4096)
	var req struct {
		Payload json.RawMessage `json:"payload"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	if len(req.Payload) == 0 || len(req.Payload) > maxSourceCredentialPayloadBytes {
		fail(c, http.StatusBadRequest, "credential payload must be between 1 byte and 64 KiB")
		return
	}
	var object map[string]any
	if err := json.Unmarshal(req.Payload, &object); err != nil || object == nil {
		fail(c, http.StatusBadRequest, "credential payload must be a JSON object")
		return
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, req.Payload); err != nil {
		fail(c, http.StatusBadRequest, "invalid credential payload")
		return
	}
	if compact.Len() > maxSourceCredentialPayloadBytes {
		fail(c, http.StatusBadRequest, "credential payload exceeds 64 KiB")
		return
	}

	// Pull credentials grant the server worker remote access. Validate them
	// again at the persistence boundary so non-UI/API callers cannot store an
	// already invalid secret and leave a Source looking configured but unusable.
	identity, err := s.testSourceCredentialPayload(c.Request.Context(), source.Kind, compact.Bytes())
	if err != nil {
		writeSourceCredentialTestError(c, source.Kind, err)
		return
	}

	var row meta.SourceCredential
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if source.Kind == yikeSourceKind {
			if err := bindYikeManagedTargetTx(c.Request.Context(), tx, &source, identity); err != nil {
				return fmt.Errorf("bind Yike managed target: %w", err)
			}
		}
		if err := sourcecredential.Put(c.Request.Context(), tx, s.ConnectorSecrets, source, compact.Bytes()); err != nil {
			return err
		}
		if source.Kind == synologySourceKind && source.Direction == meta.SourceDirectionPull &&
			source.Status != meta.SourceStatusActive {
			now := time.Now().UTC()
			if err := tx.Model(&meta.Source{}).Where("id = ? AND owner_id = ?", source.ID, source.OwnerID).
				Updates(map[string]any{
					"status":     meta.SourceStatusActive,
					"revision":   gorm.Expr("revision + 1"),
					"last_error": "",
					"updated_at": now,
				}).Error; err != nil {
				return err
			}
		}
		return tx.Where("source_id = ?", source.ID).First(&row).Error
	})
	if err != nil {
		if errors.Is(err, errYikeAccountAlreadyConfigured) {
			fail(c, http.StatusConflict, "yike_account_already_configured")
			return
		}
		if errors.Is(err, errYikeAccountMismatch) {
			fail(c, http.StatusConflict, "yike_account_mismatch")
			return
		}
		if errors.Is(err, errYikeTargetContainsData) {
			fail(c, http.StatusConflict, "yike_target_contains_unmanaged_data")
			return
		}
		if errors.Is(err, errYikeTargetPathConflict) {
			fail(c, http.StatusConflict, "yike_target_path_conflict")
			return
		}
		fail(c, http.StatusInternalServerError, "store source credential failed")
		return
	}
	recordSourceCredentialAudit(c, s.DB, auditpkg.ActionSourceCredentialUpdate, source, row.KeyVersion)
	updated := row.UpdatedAt
	c.JSON(http.StatusOK, sourceCredentialStatusDTO{
		Configured: true, KeyVersion: row.KeyVersion, UpdatedAt: &updated,
	})
}

func (s *Server) deleteSourceCredential(c *gin.Context) {
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	source, err := s.ownedSource(userID(c), sourceID)
	if err != nil {
		fail(c, statusForLookup(err), "source not found")
		return
	}
	if !sourceUsesStoredCredential(source) {
		fail(c, http.StatusBadRequest, "unsupported_source_credential_kind")
		return
	}
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if err := sourcecredential.Delete(c.Request.Context(), tx, source.ID); err != nil {
			return err
		}
		now := time.Now().UTC()
		return tx.Model(&meta.Source{}).Where("id = ? AND owner_id = ?", source.ID, source.OwnerID).
			Updates(map[string]any{
				"status":           meta.SourceStatusPaused,
				"revision":         gorm.Expr("revision + 1"),
				"run_requested_at": nil,
				"updated_at":       now,
			}).Error
	})
	if err != nil {
		fail(c, http.StatusInternalServerError, "delete source credential failed")
		return
	}
	recordSourceCredentialAudit(c, s.DB, auditpkg.ActionSourceCredentialDelete, source, 0)
	c.Status(http.StatusNoContent)
}

func recordSourceCredentialAudit(c *gin.Context, db *gorm.DB, action string, source meta.Source, keyVersion uint32) {
	user, ok := currentUser(c)
	if !ok {
		return
	}
	uid := user.ID
	metadata := map[string]any{"source_kind": source.Kind}
	if keyVersion != 0 {
		metadata["key_version"] = keyVersion
	}
	if err := auditpkg.Record(db, auditpkg.Event{
		ActorUserID:   &uid,
		ActorUsername: user.Username,
		ActorRole:     user.Role,
		Action:        action,
		TargetType:    "source",
		TargetID:      strconv.FormatUint(source.ID, 10),
		TargetLabel:   source.Name,
		Result:        auditpkg.ResultSuccess,
		RequestID:     c.GetString("requestID"),
		IPAddress:     c.ClientIP(),
		Metadata:      metadata,
	}); err != nil {
		slog.Warn("source_credential_audit_failed", "source_id", source.ID, "action", action, "error", err)
	}
}
