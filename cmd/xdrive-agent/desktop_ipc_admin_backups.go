package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/lazyxu/xdrive/internal/client"
)

type desktopIPCAdminServerBackupsController interface {
	CloudAdminServerBackups(context.Context) (json.RawMessage, error)
	CloudAdminServerBackupAction(context.Context, client.AdminServerBackupRequest) (json.RawMessage, error)
}

// Kept separate from the legacy Controller interface so existing Agent test
// fakes and older Host adapters remain compatible with read-only listing.
type desktopIPCAdminBackupSnapshotPageController interface {
	CloudAdminServerBackupSnapshotPage(context.Context, int, int) (json.RawMessage, error)
}

var desktopBackupSnapshotID = regexp.MustCompile("^(v1|v2-default|v2-configured):xdrive-backup-[0-9]{8}T[0-9]{6}Z$")
var desktopBackupRevision = regexp.MustCompile("^[0-9a-f]{64}$")

func validDesktopAdminServerBackupRequest(in client.AdminServerBackupRequest) bool {
	if in.SnapshotID != "" && !desktopBackupSnapshotID.MatchString(in.SnapshotID) {
		return false
	}
	if in.Action != "delete_selected" && in.PreviewRequestID != "" {
		return false
	}
	switch in.Action {
	case "create":
		return (in.Format == "v1" || in.Format == "v2") && in.SnapshotID == "" && in.Mode == "" &&
			in.KeepLast == 0 && in.RetentionDays == 0 && in.Revision == "" && in.Confirmation == ""
	case "verify":
		return in.SnapshotID != "" && (in.Mode == "fast" || in.Mode == "deep") &&
			in.Format == "" && in.KeepLast == 0 && in.RetentionDays == 0 && in.Revision == "" && in.Confirmation == ""
	case "preview_delete":
		return strings.HasPrefix(in.SnapshotID, "v2-") && (in.Mode == "fast" || in.Mode == "deep") &&
			in.Format == "" && in.KeepLast == 0 && in.RetentionDays == 0 && in.Revision == "" && in.Confirmation == ""
	case "drill":
		return strings.HasPrefix(in.SnapshotID, "v2-") && in.Confirmation == "DRILL "+in.SnapshotID &&
			in.Format == "" && in.Mode == "" && in.KeepLast == 0 && in.RetentionDays == 0 && in.Revision == ""
	case "verify_all":
		return (in.Mode == "fast" || in.Mode == "deep") &&
			in.SnapshotID == "" && in.Format == "" &&
			in.KeepLast == 0 && in.RetentionDays == 0 &&
			in.Revision == "" && in.Confirmation == ""
	case "plan":
		return in.SnapshotID == "" && in.KeepLast >= 1 && in.KeepLast <= 1000 &&
			(in.Mode == "fast" || in.Mode == "deep") && in.Format == "" &&
			in.RetentionDays == 0 && in.Revision == "" && in.Confirmation == ""
	case "restore":
		return in.SnapshotID != "" && in.Confirmation == "RESTORE "+in.SnapshotID &&
			in.Format == "" && in.Mode == "" && in.KeepLast == 0 && in.RetentionDays == 0 && in.Revision == ""
	case "restore_database_only":
		return strings.HasPrefix(in.SnapshotID, "v1:") &&
			in.Confirmation == "DATABASE ONLY RESTORE "+in.SnapshotID &&
			in.Format == "" && in.Mode == "" && in.KeepLast == 0 &&
			in.RetentionDays == 0 && in.Revision == ""
	case "delete_selected":
		return strings.HasPrefix(in.SnapshotID, "v2-") &&
			in.Confirmation == "DELETE "+in.SnapshotID && len(in.PreviewRequestID) == 24 &&
			strings.Trim(in.PreviewRequestID, "0123456789abcdef") == "" &&
			in.Format == "" && in.Mode == "" && in.KeepLast == 0 &&
			in.RetentionDays == 0 && in.Revision == ""
	case "delete":
		return strings.HasPrefix(in.SnapshotID, "v1:") && in.Confirmation == "DELETE "+in.SnapshotID &&
			in.Format == "" && in.Mode == "" && in.KeepLast == 0 && in.RetentionDays == 0 && in.Revision == ""
	case "prune":
		return in.SnapshotID == "" && in.KeepLast >= 1 && in.KeepLast <= 1000 &&
			in.Confirmation == fmt.Sprintf("PRUNE %d", in.KeepLast) &&
			in.Format == "" && in.Mode == "" && in.RetentionDays == 0 && in.Revision == ""
	case "policy":
		return (in.Format == "v1" || in.Format == "v2") && in.RetentionDays >= 0 &&
			in.RetentionDays <= 3650 && desktopBackupRevision.MatchString(in.Revision) &&
			in.SnapshotID == "" && in.Mode == "" && in.KeepLast == 0 && in.Confirmation == ""
	default:
		return false
	}
}

func (h *desktopIPCHandler) adminBackupProvider(w http.ResponseWriter) (desktopIPCAdminServerBackupsController, bool) {
	snapshot, _ := h.ctrl.SnapshotWithRevision()
	if !snapshot.Configured || snapshot.Role != "admin" || snapshot.MustChangePassword {
		writeDesktopIPCError(w, http.StatusForbidden, "admin_required", "administrator session required")
		return nil, false
	}
	provider, ok := h.ctrl.(desktopIPCAdminServerBackupsController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "admin_backups_unavailable", "update xDrive Agent to manage Server backups")
		return nil, false
	}
	return provider, true
}

func (h *desktopIPCHandler) cloudAdminServerBackups(w http.ResponseWriter, r *http.Request) {
	provider, ok := h.adminBackupProvider(w)
	if !ok {
		return
	}
	out, err := provider.CloudAdminServerBackups(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeDesktopIPCJSON(w, http.StatusOK, out)
}

func (h *desktopIPCHandler) cloudAdminServerBackupAction(w http.ResponseWriter, r *http.Request) {
	provider, ok := h.adminBackupProvider(w)
	if !ok {
		return
	}
	var input client.AdminServerBackupRequest
	if !decodeDesktopIPCJSONLimit(w, r, &input, 2048) {
		return
	}
	if !validDesktopAdminServerBackupRequest(input) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_backup_action", "invalid bounded administrator backup action")
		return
	}
	out, err := provider.CloudAdminServerBackupAction(r.Context(), input)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeDesktopIPCJSON(w, http.StatusAccepted, out)
}

// This must reject unknown/repeated inputs before calling Server. No Host
// paths, restore flags or arbitrary commands may be forwarded by the Agent.
func boundedAdminBackupSnapshotPageQuery(values url.Values) (int, int, bool) {
	if len(values) != 2 || len(values["offset"]) != 1 || len(values["limit"]) != 1 {
		return 0, 0, false
	}
	for _, raw := range []string{values.Get("offset"), values.Get("limit")} {
		if raw == "" || len(raw) > 5 {
			return 0, 0, false
		}
		for _, ch := range raw {
			if ch < '0' || ch > '9' {
				return 0, 0, false
			}
		}
	}
	offset, e1 := strconv.Atoi(values.Get("offset"))
	limit, e2 := strconv.Atoi(values.Get("limit"))
	if e1 != nil || e2 != nil || offset < 0 || offset > 10_000 || limit < 1 || limit > 100 {
		return 0, 0, false
	}
	return offset, limit, true
}

func (h *desktopIPCHandler) cloudAdminBackupSnapshotPage(w http.ResponseWriter, r *http.Request) {
	provider, ok := h.adminBackupProvider(w)
	if !ok {
		return
	}
	pager, ok := provider.(desktopIPCAdminBackupSnapshotPageController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "admin_backup_page_unavailable", "Update xDrive Agent to inspect older backups")
		return
	}
	offset, limit, valid := boundedAdminBackupSnapshotPageQuery(r.URL.Query())
	if !valid {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_backup_page", "invalid bounded backup snapshot page")
		return
	}
	out, err := pager.CloudAdminServerBackupSnapshotPage(r.Context(), offset, limit)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeDesktopIPCJSON(w, http.StatusOK, out)
}
