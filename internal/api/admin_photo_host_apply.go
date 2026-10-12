package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const photoHostApplyRequestName = "photo-host-control-request.json"

var (
	errPhotoHostApplyBusy     = errors.New("photo host apply request still pending")
	errPhotoHostApplyRevision = errors.New("photo host desired revision changed")
)

type photoHostApplyRequest struct {
	RequestID string `json:"request_id"`
	Revision  uint64 `json:"revision"`
	Enabled   bool   `json:"enabled"`
	CreatedAt string `json:"created_at"`
}

type photoHostApplyResult struct {
	State     string `json:"state"`
	Revision  uint64 `json:"revision"`
	RequestID string `json:"request_id"`
}

// For every Server replica, the saved desired setting row is the shared
// transaction lock, and this durable gate is the only active request slot.
// A lost/ambiguous host execution must remain fenced, not timed out into a
// second request that could outlive the latest audited desired revision.
func photoHostApplyBusyTx(tx *gorm.DB) error {
	var gate meta.AdminPhotoHostApply
	err := tx.Where("name = ?", photoHostSettingName).Take(&gate).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if gate.State == "reserved" || gate.State == "queued" {
		return errPhotoHostApplyBusy
	}
	if gate.State != "host-verified" && gate.State != "failed" {
		return errPhotoHostApplyBusy
	}
	return nil
}

func (s *Server) readPhotoHostApply(ctx context.Context) (meta.AdminPhotoHostApply, bool, error) {
	if s == nil || s.DB == nil {
		return meta.AdminPhotoHostApply{}, false, errors.New("photo host apply store unavailable")
	}
	var gate meta.AdminPhotoHostApply
	err := s.DB.WithContext(ctx).Where("name = ?", photoHostSettingName).Take(&gate).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return meta.AdminPhotoHostApply{}, false, nil
	}
	if err != nil {
		return meta.AdminPhotoHostApply{}, false, err
	}
	if gate.Revision == 0 || gate.Revision >= 1<<60 ||
		!photoHostControlRequestID.MatchString(gate.RequestID) {
		return meta.AdminPhotoHostApply{}, false, errors.New("invalid photo host dispatch record")
	}
	switch gate.State {
	case "reserved", "queued", "host-verified", "failed":
		return gate, true, nil
	default:
		return meta.AdminPhotoHostApply{}, false, errors.New("invalid photo host dispatch state")
	}
}

// Trust only a *fresh*, exactly request-token-bound fixed Host Manager report,
// independent fixed-container health and a clear local transaction journal.
// Never infer success from matching revision numbers or a healthy container.
func (s *Server) photoHostApplyReceipt(gate meta.AdminPhotoHostApply) string {
	control, valid := s.readPhotoHostControlStatus()
	if !valid || control.Revision != gate.Revision ||
		control.RequestID != gate.RequestID || !s.photoHostLocalQueueClear() {
		return ""
	}
	host, observed := s.readPhotoIntelligenceHostStatus()
	if !observed {
		return ""
	}
	if control.State == "success" && control.AppliedRevision == gate.Revision &&
		control.Enabled && control.ProfileVerified &&
		control.ObservedHostState == "healthy" &&
		host.State == "healthy" && host.ProfileConfigured {
		return "host-verified"
	}
	if control.State == "failed" && (host.State == "healthy" || host.State == "stopped") {
		return "failed"
	}
	return ""
}

// Exact host proof closes the durable cross-replica pending gate. A missing,
// stale or mismatching report never clears it. No model Info probe is claimed.
func (s *Server) reconcilePhotoHostApply(ctx context.Context) (meta.AdminPhotoHostApply, bool, error) {
	gate, present, err := s.readPhotoHostApply(ctx)
	if err != nil || !present || (gate.State != "reserved" && gate.State != "queued") {
		return gate, present, err
	}
	final := s.photoHostApplyReceipt(gate)
	if final == "" {
		return gate, true, nil
	}
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var desired meta.AdminPhotoHostSetting
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", photoHostSettingName).Take(&desired).Error; err != nil {
			return err
		}
		if desired.Revision != gate.Revision || !desired.Enabled {
			return errPhotoHostApplyRevision
		}
		var current meta.AdminPhotoHostApply
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", photoHostSettingName).Take(&current).Error; err != nil {
			return err
		}
		if current.RequestID != gate.RequestID || current.Revision != gate.Revision ||
			(current.State != "reserved" && current.State != "queued") {
			return errPhotoHostApplyBusy
		}
		return tx.Model(&meta.AdminPhotoHostApply{}).Where("name = ? AND request_id = ?",
			photoHostSettingName, current.RequestID).
			Updates(map[string]any{"state": final, "updated_at": time.Now().UTC()}).Error
	})
	if errors.Is(err, errPhotoHostApplyBusy) || errors.Is(err, errPhotoHostApplyRevision) {
		// Another Server may already have safely reconciled this receipt or
		// moved the desired revision. Read the new gate, never invent a local
		// success or fail the otherwise read-only status request.
		return s.readPhotoHostApply(ctx)
	}
	if err != nil {
		return gate, true, err
	}
	gate.State = final
	return gate, true, nil
}

func (s *Server) photoHostCanSubmit(desired photoHostDesired, gate meta.AdminPhotoHostApply, hasGate bool) bool {
	if desired.Revision == 0 || !desired.Enabled ||
		(hasGate && (gate.State == "reserved" || gate.State == "queued" ||
			(gate.State == "host-verified" && gate.Revision == desired.Revision))) ||
		!s.photoHostLocalQueueClear() {
		return false
	}
	control, valid := s.readPhotoHostControlStatus()
	host, observed := s.readPhotoIntelligenceHostStatus()
	if !valid || !observed || (host.State != "healthy" && host.State != "stopped") ||
		control.State == "queued" || control.State == "running" {
		return false
	}
	// Never replay an already acknowledged desired revision except when the
	// restricted runner has explicitly reported failed recovery.
	return control.AppliedRevision < desired.Revision || control.State == "failed"
}

// Publish only one fixed, audited allowlisted enable request. Atomic hard-link
// prevents a competing Server from overwriting an already queued request.
// The operator-provisioned bridge directory must never be supplied by a user.
func writePhotoHostApplyRequest(dir string, request photoHostApplyRequest) error {
	if strings.TrimSpace(dir) == "" || !request.Enabled ||
		request.Revision == 0 || request.Revision >= 1<<60 ||
		!photoHostControlRequestID.MatchString(request.RequestID) {
		return errors.New("invalid fixed photo host apply request")
	}
	if info, err := os.Lstat(dir); err != nil || !info.IsDir() {
		return errors.New("fixed host control directory unavailable")
	}
	data, err := json.Marshal(request)
	if err != nil || len(data) > 512 {
		return errors.New("fixed host request encoding unavailable")
	}
	temp, err := os.CreateTemp(dir, ".photo-host-request-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(temp.Name())
	if err := temp.Chmod(0660); err != nil {
		_ = temp.Close()
		return err
	}
	if _, err := temp.Write(append(data, '\n')); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Link(temp.Name(), filepath.Join(dir, photoHostApplyRequestName))
}

// This action authorizes *only* enable of the single fixed photo-face target.
// It does not permit disable, restart, arbitrary Docker arguments or any user
// Source operation. Host control executes only after a committed audit record.
func (s *Server) adminPhotoHostApply(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s == nil || s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "photo host activation unavailable")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 512)
	var input struct {
		Revision *uint64 `json:"revision"`
	}
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || input.Revision == nil ||
		*input.Revision == 0 || *input.Revision >= 1<<60 ||
		decoder.Decode(&struct{}{}) != io.EOF {
		fail(c, http.StatusBadRequest, "saved positive photo host revision required")
		return
	}
	// A previous token may be reconciled only against the exact host receipt.
	// Any uncertainty preserves the durable pending gate.
	if _, _, err := s.reconcilePhotoHostApply(c.Request.Context()); err != nil {
		fail(c, http.StatusServiceUnavailable, "photo host request recovery unavailable")
		return
	}
	desired, err := s.readPhotoHostDesired(c.Request.Context())
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "photo host desired configuration unavailable")
		return
	}
	gate, present, err := s.readPhotoHostApply(c.Request.Context())
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "photo host dispatch gate unavailable")
		return
	}
	if desired.Revision != *input.Revision || !desired.Enabled {
		fail(c, http.StatusConflict, "photo host enabled desired revision required")
		return
	}
	if !s.photoHostCanSubmit(desired, gate, present) {
		fail(c, http.StatusConflict, "fixed host or durable dispatch gate not ready")
		return
	}
	requestID, err := randomServerUpdateRequestID()
	if err != nil || !photoHostControlRequestID.MatchString(requestID) {
		fail(c, http.StatusServiceUnavailable, "photo host token unavailable")
		return
	}
	request := photoHostApplyRequest{
		RequestID: requestID, Revision: desired.Revision,
		Enabled: true, CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	// Serialize on the globally persistent desired row (FOR UPDATE), also
	// used by edit/rollback handlers. Reserve the only global execution slot
	// and commit metadata-only authorization audit before queue publication.
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var saved meta.AdminPhotoHostSetting
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", photoHostSettingName).Take(&saved).Error; err != nil {
			return err
		}
		if saved.Revision != request.Revision || !saved.Enabled {
			return errPhotoHostApplyRevision
		}
		var previous meta.AdminPhotoHostApply
		found := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", photoHostSettingName).Take(&previous).Error
		if found != nil && !errors.Is(found, gorm.ErrRecordNotFound) {
			return found
		}
		if found == nil {
			if previous.State == "reserved" || previous.State == "queued" ||
				previous.Revision > request.Revision ||
				(previous.Revision == request.Revision && previous.State == "host-verified") {
				return errPhotoHostApplyBusy
			}
			if previous.State != "failed" && previous.State != "host-verified" {
				return errPhotoHostApplyBusy
			}
		}
		// Re-check the fixed host bridge after the DB fence; a queue may have
		// appeared since the initial read, and hard-link publication is still
		// an independent final no-clobber guard.
		if !s.photoHostCanSubmit(desired, previous, found == nil) {
			return errPhotoHostApplyBusy
		}
		now := time.Now().UTC()
		if found == nil {
			updated := tx.Model(&meta.AdminPhotoHostApply{}).
				Where("name = ?", photoHostSettingName).
				Updates(map[string]any{"revision": request.Revision, "request_id": requestID,
					"state": "reserved", "updated_at": now})
			if updated.Error != nil || updated.RowsAffected != 1 {
				return errPhotoHostApplyBusy
			}
		} else {
			if err := tx.Create(&meta.AdminPhotoHostApply{
				Name: photoHostSettingName, Revision: request.Revision,
				RequestID: requestID, State: "reserved",
				CreatedAt: now, UpdatedAt: now,
			}).Error; err != nil {
				return err
			}
		}
		return recordAuditTx(tx, auditEventFromContext(c,
			"admin.service.photo-host.apply.authorize", "service", "photo-intelligence",
			"Photo Intelligence fixed host safe enable", auditpkg.ResultSuccess,
			map[string]any{"revision": request.Revision, "request_id": requestID,
				"enabled": true, "host_applied": false},
		))
	})
	if errors.Is(err, errPhotoHostApplyBusy) || errors.Is(err, errPhotoHostApplyRevision) {
		fail(c, http.StatusConflict, "photo host revision changed or request in progress")
		return
	}
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "photo host enable was not durably authorized and audited")
		return
	}
	if err := writePhotoHostApplyRequest(s.HostControlDir, request); err != nil {
		// The committed 'reserved' gate intentionally remains active. There
		// may be an existing request or an ambiguous disk/runner failure:
		// never automatically retry with a fresh, unaudited request token.
		fail(c, http.StatusServiceUnavailable, "host request publication uncertain; manual recovery required")
		return
	}
	updated := s.DB.WithContext(c.Request.Context()).Model(&meta.AdminPhotoHostApply{}).
		Where("name = ? AND request_id = ? AND state = ?",
			photoHostSettingName, requestID, "reserved").
		Updates(map[string]any{"state": "queued", "updated_at": time.Now().UTC()})
	if updated.Error != nil || updated.RowsAffected != 1 {
		// The Host Manager may already be executing or another Server may
		// have reconciled a real receipt. Never claim a mere queue status.
		fail(c, http.StatusServiceUnavailable, "host request queued; state reconciliation required")
		return
	}
	c.JSON(http.StatusAccepted, photoHostApplyResult{
		State: "queued", Revision: request.Revision, RequestID: requestID,
	})
}
