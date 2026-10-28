package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Server backups belong to the authenticated administrator and are executed
// solely by the existing Host Control process. The API container never gets a
// Docker socket, a backup directory mount or a generic command execution API.
const backupAdminProtocol = "xdrive-backup-admin-v1"

var backupAdminSnapshotID = regexp.MustCompile(`^(v1|v2-default|v2-configured):xdrive-backup-[0-9]{8}T[0-9]{6}Z$`)

type backupAdminSnapshot struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	Format           string `json:"format"`
	CreatedAt        string `json:"created_at"`
	State            string `json:"state"`
	Bytes            int64  `json:"bytes"`
	FileDataIncluded bool   `json:"file_data_included"`
}

type backupAdminPolicy struct {
	ScheduleFormat string `json:"schedule_format"`
	RetentionDays  int    `json:"retention_days"`
	Repository     string `json:"repository"`
	Revision       string `json:"revision"`
}

type backupAdminInventory struct {
	Protocol    string                `json:"protocol"`
	GeneratedAt string                `json:"generated_at"`
	Policy      backupAdminPolicy     `json:"policy"`
	Snapshots   []backupAdminSnapshot `json:"snapshots"`
}

type backupAdminStatus struct {
	Protocol   string `json:"protocol"`
	State      string `json:"state"`
	RequestID  string `json:"request_id,omitempty"`
	Action     string `json:"action,omitempty"`
	SnapshotID string `json:"snapshot_id,omitempty"`
	StartedAt  string `json:"started_at,omitempty"`
	UpdatedAt  string `json:"updated_at,omitempty"`
	FinishedAt string `json:"finished_at,omitempty"`
	ErrorCode  string `json:"error_code,omitempty"`
	Message    string `json:"message,omitempty"`
	Stage      string `json:"stage,omitempty"`
	BytesDone  int64  `json:"bytes_done,omitempty"`
	BytesTotal int64  `json:"bytes_total,omitempty"`
}

type backupAdminRequest struct {
	Protocol         string `json:"protocol"`
	RequestID        string `json:"request_id"`
	Action           string `json:"action"`
	SnapshotID       string `json:"snapshot_id,omitempty"`
	Format           string `json:"format,omitempty"`
	Mode             string `json:"mode,omitempty"`
	KeepLast         int    `json:"keep_last,omitempty"`
	RetentionDays    int    `json:"retention_days"`
	Revision         string `json:"revision,omitempty"`
	Confirmation     string `json:"confirmation,omitempty"`
	PreviewRequestID string `json:"preview_request_id,omitempty"`
	RequestedBy      string `json:"requested_by,omitempty"`
	CreatedAt        string `json:"created_at"`
}

type backupAdminRetention struct {
	Mode                  string   `json:"mode"`
	Validation            string   `json:"validation"`
	KeepLast              int      `json:"keep_last"`
	CommittedSnapshots    int      `json:"committed_snapshots"`
	KeepSnapshots         []string `json:"keep_snapshots"`
	DropCandidates        []string `json:"drop_candidates"`
	RetainedObjects       int      `json:"retained_objects"`
	DropOnlyObjects       int      `json:"drop_only_objects"`
	UnreferencedObjects   int      `json:"unreferenced_objects"`
	DropOnlyObjectBytes   int64    `json:"drop_only_object_bytes"`
	UnreferencedBytes     int64    `json:"unreferenced_bytes"`
	DropSnapshotBytes     int64    `json:"drop_snapshot_bytes"`
	PotentialLogicalBytes int64    `json:"potential_logical_bytes"`
	DeleteEnabled         bool     `json:"delete_enabled"`
	Warning               string   `json:"warning"`
	HashedObjects         int      `json:"hashed_objects"`
	HashedBytes           int64    `json:"hashed_bytes"`
}
type backupAdminPage struct {
	Supported        bool                        `json:"supported"`
	Message          string                      `json:"message,omitempty"`
	Inventory        backupAdminInventory        `json:"inventory"`
	Operation        backupAdminStatus           `json:"operation"`
	Retention        *backupAdminRetention       `json:"retention,omitempty"`
	History          []backupAdminHistoryEntry   `json:"history,omitempty"`
	BulkVerification *backupAdminVerifyAllReport `json:"bulk_verification,omitempty"`
	SelectedPreview  *backupAdminSelectedPreview `json:"selected_preview,omitempty"`
}

// Host-authored historical receipts, not current snapshot integrity guarantees.
type backupAdminHistoryEntry struct {
	backupAdminStatus
	Mode           string                            `json:"mode,omitempty"`
	Verification   *backupAdminVerificationReceipt   `json:"verification,omitempty"`
	Drill          *backupAdminDrillReceipt          `json:"drill,omitempty"`
	SelectedDelete *backupAdminSelectedDeleteReceipt `json:"selected_delete,omitempty"`
}

type backupAdminHistory struct {
	Protocol   string                    `json:"protocol"`
	Operations []backupAdminHistoryEntry `json:"operations"`
}

func validBackupAdminHistory(events []backupAdminHistoryEntry) bool {
	if len(events) > 30 {
		return false
	}
	seen := make(map[string]bool, len(events))
	for _, e := range events {
		if e.Protocol != backupAdminProtocol || len(e.RequestID) != 24 ||
			strings.Trim(e.RequestID, "0123456789abcdef") != "" || seen[e.RequestID] ||
			(e.State != "success" && e.State != "failed") || len(e.ErrorCode) > 60 ||
			(e.SnapshotID != "" && !backupAdminSnapshotID.MatchString(e.SnapshotID)) {
			return false
		}
		if !validBackupVerificationReceipt(e) || !validBackupDrillReceipt(e) ||
			!validBackupSelectedDeleteHistory(e) {
			return false
		}
		switch e.Action {
		case "verify", "preview_delete":
			if e.SnapshotID == "" || (e.Mode != "fast" && e.Mode != "deep") ||
				(e.Action == "preview_delete" && !strings.HasPrefix(e.SnapshotID, "v2-")) {
				return false
			}
		case "plan", "verify_all":
			if e.SnapshotID != "" || (e.Mode != "fast" && e.Mode != "deep") {
				return false
			}
		case "restore", "restore_database_only", "delete", "delete_selected", "drill":
			if e.SnapshotID == "" || e.Mode != "" ||
				((e.Action == "drill" || e.Action == "delete_selected") && !strings.HasPrefix(e.SnapshotID, "v2-")) ||
				(e.Action == "restore_database_only" && !strings.HasPrefix(e.SnapshotID, "v1:")) {
				return false
			}
		case "create", "prune", "policy":
			if e.SnapshotID != "" || e.Mode != "" {
				return false
			}
		default:
			return false
		}
		start, startErr := time.Parse(time.RFC3339, e.StartedAt)
		finish, endErr := time.Parse(time.RFC3339, e.FinishedAt)
		if startErr != nil || endErr != nil || finish.Before(start) ||
			time.Until(finish) > 15*time.Second ||
			(e.State == "success" && e.ErrorCode != "") {
			return false
		}
		seen[e.RequestID] = true
	}
	return true
}

func readSafeBackupAdminJSON(dir, name string, maxSize int64, out any) error {
	path := filepath.Join(dir, name)
	st, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !st.Mode().IsRegular() || st.Size() < 1 || st.Size() > maxSize {
		return errors.New("unsafe host backup control record")
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	decoder := json.NewDecoder(io.LimitReader(file, maxSize+1))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return errors.New("trailing host backup control record")
	}
	return nil
}

func (s *Server) backupAdminState() backupAdminPage {
	page := backupAdminPage{
		Message: "宿主机备份控制尚未连接，操作入口已禁用。",
		Inventory: backupAdminInventory{
			Protocol:  backupAdminProtocol,
			Snapshots: []backupAdminSnapshot{},
		},
		Operation: backupAdminStatus{Protocol: backupAdminProtocol, State: "unavailable"},
	}
	if s == nil || strings.TrimSpace(s.HostControlDir) == "" {
		return page
	}
	dir := s.HostControlDir
	heartbeat, err := os.Lstat(filepath.Join(dir, "heartbeat"))
	if err != nil || !heartbeat.Mode().IsRegular() ||
		time.Since(heartbeat.ModTime()) > 45*time.Second ||
		time.Until(heartbeat.ModTime()) > 15*time.Second {
		return page
	}
	var inventory backupAdminInventory
	if err := readSafeBackupAdminJSON(dir, "backup-admin-inventory.json", 128<<10, &inventory); err != nil {
		page.Message = "宿主机尚未提供可验证的备份清单。"
		return page
	}
	generated, err := time.Parse(time.RFC3339, inventory.GeneratedAt)
	if err != nil || time.Since(generated) > 120*time.Second ||
		time.Until(generated) > 15*time.Second || inventory.Protocol != backupAdminProtocol ||
		len(inventory.Snapshots) > 100 ||
		(inventory.Policy.ScheduleFormat != "v1" && inventory.Policy.ScheduleFormat != "v2") ||
		inventory.Policy.RetentionDays < 0 || inventory.Policy.RetentionDays > 3650 ||
		len(inventory.Policy.Revision) != 64 ||
		strings.Trim(inventory.Policy.Revision, "0123456789abcdef") != "" {
		page.Message = "备份清单已过期或结构不符合协议。"
		return page
	}
	seen := make(map[string]bool, len(inventory.Snapshots))
	for _, item := range inventory.Snapshots {
		backupTime, parsedTimeErr := time.Parse(time.RFC3339, item.CreatedAt)
		namespace := strings.SplitN(item.ID, ":", 2)[0]
		if !backupAdminSnapshotID.MatchString(item.ID) || seen[item.ID] ||
			(item.Format != "v1" && item.Format != "v2") ||
			(item.Format == "v1") != (namespace == "v1") ||
			parsedTimeErr != nil ||
			backupTime.UTC().Format("20060102T150405Z") != strings.TrimPrefix(item.Name, "xdrive-backup-") ||
			(item.State != "complete" && item.State != "incomplete" && item.State != "inconsistent") ||
			item.Bytes < 0 || item.Name != strings.SplitN(item.ID, ":", 2)[1] ||
			len(item.CreatedAt) > 64 || (item.Format == "v2" && !item.FileDataIncluded) {
			page.Message = "备份清单包含无效或重复的快照。"
			return page
		}
		seen[item.ID] = true
	}
	page.Supported = true
	page.Message = ""
	page.Inventory = inventory
	var state backupAdminStatus
	if err := readSafeBackupAdminJSON(dir, "backup-admin-status.json", 4096, &state); err == nil &&
		state.Protocol == backupAdminProtocol &&
		(state.State == "queued" || state.State == "running" ||
			state.State == "success" || state.State == "failed" || state.State == "idle") &&
		len(state.Message) <= 200 && len(state.ErrorCode) <= 60 &&
		len(state.Stage) <= 96 && state.BytesDone >= 0 && state.BytesTotal >= 0 &&
		state.BytesDone <= 999_999_999_999_999 && state.BytesTotal <= 999_999_999_999_999 &&
		(state.BytesTotal == 0 || state.BytesDone <= state.BytesTotal) {
		page.Operation = state
	} else {
		page.Operation = backupAdminStatus{Protocol: backupAdminProtocol, State: "idle"}
	}
	var pending backupAdminRequest
	if err := readSafeBackupAdminJSON(dir, "backup-admin-request.json", 2048, &pending); err == nil &&
		pending.Protocol == backupAdminProtocol {
		page.Operation = backupAdminStatus{
			Protocol: backupAdminProtocol, State: "queued",
			RequestID: pending.RequestID, Action: pending.Action,
			SnapshotID: pending.SnapshotID, Message: "等待宿主机执行。",
		}
	}
	var report backupAdminRetention
	if err := readSafeBackupAdminJSON(dir, "backup-admin-retention-report.json", 32<<10, &report); err == nil &&
		report.Mode == "read_only" && report.KeepLast >= 1 && report.KeepLast <= 1000 &&
		!report.DeleteEnabled && len(report.KeepSnapshots) <= 100 && len(report.DropCandidates) <= 100 {
		page.Retention = &report
	}
	var history backupAdminHistory
	if err := readSafeBackupAdminJSON(dir, "backup-admin-history.json", 32<<10, &history); err == nil &&
		history.Protocol == "xdrive-backup-admin-history-v1" && validBackupAdminHistory(history.Operations) {
		page.History = history.Operations
	}
	var bulk backupAdminVerifyAllReport
	if err := readSafeBackupAdminJSON(dir, "backup-admin-verify-all-report.json", 16<<10, &bulk); err == nil &&
		validBackupAdminVerifyAllReport(bulk) {
		page.BulkVerification = &bulk
	}
	var selected backupAdminSelectedPreview
	if err := readSafeBackupAdminJSON(dir, "backup-admin-selected-preview.json", 4096, &selected); err == nil &&
		validBackupAdminSelectedPreview(selected) &&
		page.Operation.State == "success" && page.Operation.Action == "preview_delete" &&
		page.Operation.RequestID == selected.RequestID &&
		page.Operation.SnapshotID == selected.SnapshotID &&
		len(page.History) > 0 &&
		page.History[0].Action == "preview_delete" &&
		page.History[0].State == "success" &&
		page.History[0].RequestID == selected.RequestID &&
		page.History[0].SnapshotID == selected.SnapshotID &&
		page.History[0].Mode == selected.Mode {
		// A Host status alone is not a durable preview receipt.
		if finished, err := time.Parse(time.RFC3339, page.Operation.FinishedAt); err == nil &&
			time.Since(finished) >= 0 && time.Since(finished) < 15*time.Minute {
			page.SelectedPreview = &selected
		}
	}
	if _, err := os.Lstat(filepath.Join(dir, "backup-admin-active.json")); err == nil &&
		page.Operation.State != "running" {
		// Never claim idle/success while an active operation may be in progress.
		page.Operation.State = "running"
		page.Operation.Message = "宿主机正在处理备份操作。"
	}
	return page
}

func (s *Server) adminBackupManagement(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, s.backupAdminState())
}

func validateBackupAdminRequest(request backupAdminRequest) error {
	if request.SnapshotID != "" && !backupAdminSnapshotID.MatchString(request.SnapshotID) {
		return errors.New("invalid backup snapshot identity")
	}
	if request.Action != "delete_selected" && request.PreviewRequestID != "" {
		return errors.New("preview receipt only applies to selected v2 deletion")
	}
	switch request.Action {
	case "create":
		if request.Format != "v1" && request.Format != "v2" {
			return errors.New("create requires v1 or v2")
		}
		if request.SnapshotID != "" || request.Confirmation != "" ||
			request.KeepLast != 0 || request.RetentionDays != 0 || request.Revision != "" || request.Mode != "" {
			return errors.New("unexpected create parameters")
		}
	case "verify":
		if request.SnapshotID == "" || request.Mode != "fast" && request.Mode != "deep" ||
			request.Format != "" || request.Confirmation != "" || request.KeepLast != 0 ||
			request.RetentionDays != 0 || request.Revision != "" {
			return errors.New("invalid verification parameters")
		}
	case "preview_delete":
		if !strings.HasPrefix(request.SnapshotID, "v2-") ||
			(request.Mode != "fast" && request.Mode != "deep") ||
			request.Format != "" || request.Confirmation != "" || request.KeepLast != 0 ||
			request.RetentionDays != 0 || request.Revision != "" {
			return errors.New("selected v2 preview requires exact snapshot and fast/deep mode")
		}
	case "drill":
		if !strings.HasPrefix(request.SnapshotID, "v2-") ||
			request.Confirmation != "DRILL "+request.SnapshotID ||
			request.Format != "" || request.Mode != "" || request.KeepLast != 0 ||
			request.RetentionDays != 0 || request.Revision != "" {
			return errors.New("isolated drill requires exact committed v2 confirmation")
		}
	case "verify_all":
		if (request.Mode != "fast" && request.Mode != "deep") ||
			request.SnapshotID != "" || request.Format != "" ||
			request.Confirmation != "" || request.KeepLast != 0 ||
			request.RetentionDays != 0 || request.Revision != "" {
			return errors.New("verify_all accepts only fast or deep mode")
		}
	case "plan":
		if request.KeepLast < 1 || request.KeepLast > 1000 ||
			(request.Mode != "fast" && request.Mode != "deep") ||
			request.SnapshotID != "" || request.Format != "" || request.Confirmation != "" ||
			request.RetentionDays != 0 || request.Revision != "" {
			return errors.New("plan requires keep-last and fast or deep mode")
		}
	case "restore":
		if request.SnapshotID == "" || request.Confirmation != "RESTORE "+request.SnapshotID ||
			request.Format != "" || request.Mode != "" || request.KeepLast != 0 ||
			request.RetentionDays != 0 || request.Revision != "" {
			return errors.New("restore requires exact snapshot confirmation")
		}
	case "restore_database_only":
		if !strings.HasPrefix(request.SnapshotID, "v1:") ||
			request.Confirmation != "DATABASE ONLY RESTORE "+request.SnapshotID ||
			request.Format != "" || request.Mode != "" || request.KeepLast != 0 ||
			request.RetentionDays != 0 || request.Revision != "" {
			return errors.New("database-only recovery requires exact v1 confirmation")
		}
	case "delete_selected":
		if !strings.HasPrefix(request.SnapshotID, "v2-") ||
			request.Confirmation != "DELETE "+request.SnapshotID ||
			len(request.PreviewRequestID) != 24 ||
			strings.Trim(request.PreviewRequestID, "0123456789abcdef") != "" ||
			request.Format != "" || request.Mode != "" || request.KeepLast != 0 ||
			request.RetentionDays != 0 || request.Revision != "" {
			return errors.New("selected v2 deletion requires exact deep preview receipt and confirmation")
		}
	case "delete":
		if !strings.HasPrefix(request.SnapshotID, "v1:") ||
			request.Confirmation != "DELETE "+request.SnapshotID ||
			request.Format != "" || request.Mode != "" || request.KeepLast != 0 ||
			request.RetentionDays != 0 || request.Revision != "" {
			return errors.New("only exact v1 snapshot deletion is supported")
		}
	case "prune":
		if request.KeepLast < 1 || request.KeepLast > 1000 ||
			request.Confirmation != fmt.Sprintf("PRUNE %d", request.KeepLast) ||
			request.SnapshotID != "" || request.Mode != "" ||
			request.Format != "" || request.RetentionDays != 0 || request.Revision != "" {
			return errors.New("prune requires keep-last and exact confirmation")
		}
	case "policy":
		if (request.Format != "v1" && request.Format != "v2") ||
			request.RetentionDays < 0 || request.RetentionDays > 3650 ||
			len(request.Revision) != 64 ||
			strings.Trim(request.Revision, "0123456789abcdef") != "" ||
			request.SnapshotID != "" || request.Mode != "" || request.KeepLast != 0 ||
			request.Confirmation != "" {
			return errors.New("invalid backup schedule settings")
		}
	default:
		return errors.New("unsupported backup action")
	}
	return nil
}

func (s *Server) adminSubmitBackupManagement(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2048)
	var request backupAdminRequest
	dec := json.NewDecoder(c.Request.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_backup_request"})
		return
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_backup_request"})
		return
	}
	if err := validateBackupAdminRequest(request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_backup_request", "detail": err.Error()})
		return
	}
	page := s.backupAdminState()
	if !page.Supported {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "backup_controller_unavailable"})
		return
	}
	if page.Operation.State == "running" || page.Operation.State == "queued" {
		c.JSON(http.StatusConflict, gin.H{"error": "backup_operation_in_progress"})
		return
	}
	if request.Action == "policy" && request.Revision != page.Inventory.Policy.Revision {
		c.JSON(http.StatusConflict, gin.H{"error": "backup_policy_revision_changed"})
		return
	}
	if request.Action == "delete_selected" {
		preview := page.SelectedPreview
		if preview == nil || preview.RequestID != request.PreviewRequestID ||
			preview.SnapshotID != request.SnapshotID || preview.Mode != "deep" ||
			page.Operation.Action != "preview_delete" ||
			page.Operation.RequestID != preview.RequestID || page.Operation.State != "success" {
			c.JSON(http.StatusConflict, gin.H{"error": "backup_deep_preview_not_current"})
			return
		}
	}
	if request.SnapshotID != "" {
		found := false
		for _, snap := range page.Inventory.Snapshots {
			if snap.ID == request.SnapshotID &&
				(request.Action == "verify" || snap.State == "complete") {
				if (request.Action == "restore" || request.Action == "drill") && !snap.FileDataIncluded {
					c.JSON(http.StatusConflict, gin.H{"error": "backup_snapshot_database_only"})
					return
				}
				if request.Action == "restore_database_only" &&
					(snap.Format != "v1" || snap.FileDataIncluded) {
					c.JSON(http.StatusConflict, gin.H{"error": "backup_snapshot_not_database_only"})
					return
				}
				found = true
				break
			}
		}
		if !found {
			c.JSON(http.StatusConflict, gin.H{"error": "backup_snapshot_not_current"})
			return
		}
	}
	value := [12]byte{}
	if _, err := rand.Read(value[:]); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "backup_request_failed"})
		return
	}
	request.Protocol = backupAdminProtocol
	request.RequestID = hex.EncodeToString(value[:])
	request.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	if user, ok := currentUser(c); ok {
		request.RequestedBy = user.Username
	}
	raw, err := json.Marshal(request)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "backup_request_failed"})
		return
	}
	dir := s.HostControlDir
	temp, err := os.CreateTemp(dir, ".backup-admin-request-*.tmp")
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "backup_request_failed"})
		return
	}
	defer os.Remove(temp.Name())
	if err := temp.Chmod(0660); err == nil {
		_, err = temp.Write(append(raw, '\n'))
	}
	if err == nil {
		err = temp.Sync()
	}
	if closeErr := temp.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Link(temp.Name(), filepath.Join(dir, "backup-admin-request.json"))
	}
	if err != nil {
		if errors.Is(err, os.ErrExist) {
			c.JSON(http.StatusConflict, gin.H{"error": "backup_operation_in_progress"})
		} else {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "backup_request_failed"})
		}
		return
	}
	if s.DB != nil {
		s.recordAuditBestEffort(c, auditEventFromContext(c,
			"admin.backup."+request.Action, "server_backup",
			request.SnapshotID, request.SnapshotID, "success",
			map[string]any{"request_id": request.RequestID,
				"keep_last": request.KeepLast, "format": request.Format}))
	}
	c.JSON(http.StatusAccepted, backupAdminStatus{
		Protocol: backupAdminProtocol, State: "queued",
		RequestID: request.RequestID, Action: request.Action,
		SnapshotID: request.SnapshotID, Message: "等待宿主机执行。",
	})
}
