package main

import (
	"context"
	"net/http"
	"strings"

	"github.com/lazyxu/xdrive/internal/client"
)

type desktopIPCAdminAuditController interface {
	CloudAdminAuditRange(context.Context, client.AdminAuditRangeQuery) (client.AdminAuditRange, error)
}

func validDesktopAdminAuditRange(query client.AdminAuditRangeQuery) bool {
	return query.Limit >= 1 && query.Limit <= 200 && query.Offset >= 0 &&
		len(query.Action) <= 80 && len(query.Actor) <= 64 &&
		(query.Result == "" || query.Result == "success" || query.Result == "failure")
}

func (h *desktopIPCHandler) cloudAdminAuditRange(w http.ResponseWriter, r *http.Request) {
	snapshot, _ := h.ctrl.SnapshotWithRevision()
	if !snapshot.Configured || snapshot.Role != "admin" || snapshot.MustChangePassword {
		writeDesktopIPCError(w, http.StatusForbidden, "admin_required", "administrator session required")
		return
	}
	provider, ok := h.ctrl.(desktopIPCAdminAuditController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "admin_audit_unavailable", "update the xdrive Agent to inspect audit events")
		return
	}
	var query client.AdminAuditRangeQuery
	if !decodeDesktopIPCJSON(w, r, &query) {
		return
	}
	query.Action = strings.TrimSpace(query.Action)
	query.Actor = strings.TrimSpace(query.Actor)
	if !validDesktopAdminAuditRange(query) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_audit_range", "invalid audit range or filters")
		return
	}
	page, err := provider.CloudAdminAuditRange(r.Context(), query)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeDesktopIPCJSON(w, http.StatusOK, page)
}
