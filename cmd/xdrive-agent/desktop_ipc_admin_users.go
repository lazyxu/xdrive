package main

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/lazyxu/xdrive/internal/client"
)

type desktopIPCAdminUsersController interface {
	CloudAdminUsers(context.Context) ([]client.AdminUser, error)
	CloudAdminCreateUser(context.Context, client.AdminCreateUserInput) (client.AdminUser, error)
	CloudAdminUpdateUser(context.Context, uint64, client.AdminUpdateUserInput) (client.AdminUser, error)
	CloudAdminResetUserPassword(context.Context, uint64, string, bool) error
	CloudAdminRevokeUserSessions(context.Context, uint64) error
	CloudAdminDeleteUser(context.Context, uint64) error
}

func (h *desktopIPCHandler) adminUsersController(w http.ResponseWriter) (desktopIPCAdminUsersController, bool) {
	snapshot, _ := h.ctrl.SnapshotWithRevision()
	if !snapshot.Configured || snapshot.Role != "admin" || snapshot.MustChangePassword {
		writeDesktopIPCError(w, http.StatusForbidden, "admin_required", "administrator session required")
		return nil, false
	}
	provider, ok := h.ctrl.(desktopIPCAdminUsersController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "admin_users_unavailable", "update the xdrive Agent to manage users")
	}
	return provider, ok
}

func desktopAdminUserID(w http.ResponseWriter, r *http.Request) (uint64, bool) {
	id, err := strconv.ParseUint(r.PathValue("id"), 10, 64)
	if err != nil || id == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_user_id", "invalid user id")
		return 0, false
	}
	return id, true
}

func (h *desktopIPCHandler) cloudAdminUsers(w http.ResponseWriter, r *http.Request) {
	p, ok := h.adminUsersController(w)
	if !ok {
		return
	}
	result, err := p.CloudAdminUsers(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) cloudAdminCreateUser(w http.ResponseWriter, r *http.Request) {
	p, ok := h.adminUsersController(w)
	if !ok {
		return
	}
	var input client.AdminCreateUserInput
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	input.Username = strings.TrimSpace(input.Username)
	if len(input.Username) < 3 || len(input.Username) > 64 ||
		len(input.Password) < 8 || len(input.Password) > 1024 ||
		(input.Role != "user" && input.Role != "admin") || input.QuotaBytes < 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_user", "invalid user fields")
		return
	}
	result, err := p.CloudAdminCreateUser(r.Context(), input)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusCreated, result)
}

func (h *desktopIPCHandler) cloudAdminUpdateUser(w http.ResponseWriter, r *http.Request) {
	p, ok := h.adminUsersController(w)
	if !ok {
		return
	}
	id, valid := desktopAdminUserID(w, r)
	if !valid {
		return
	}
	var input client.AdminUpdateUserInput
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if (input.Role == nil && input.Disabled == nil && input.QuotaBytes == nil) ||
		(input.Role != nil && *input.Role != "user" && *input.Role != "admin") ||
		(input.QuotaBytes != nil && *input.QuotaBytes < 0) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_user", "invalid user changes")
		return
	}
	result, err := p.CloudAdminUpdateUser(r.Context(), id, input)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) cloudAdminResetUserPassword(w http.ResponseWriter, r *http.Request) {
	p, ok := h.adminUsersController(w)
	if !ok {
		return
	}
	id, valid := desktopAdminUserID(w, r)
	if !valid {
		return
	}
	var input struct {
		Password           string `json:"password"`
		MustChangePassword *bool  `json:"must_change_password"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if len(input.Password) < 8 || len(input.Password) > 1024 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_password", "invalid password")
		return
	}
	mustChange := true
	if input.MustChangePassword != nil {
		mustChange = *input.MustChangePassword
	}
	if err := p.CloudAdminResetUserPassword(r.Context(), id, input.Password, mustChange); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *desktopIPCHandler) cloudAdminRevokeUserSessions(w http.ResponseWriter, r *http.Request) {
	p, ok := h.adminUsersController(w)
	if !ok {
		return
	}
	id, valid := desktopAdminUserID(w, r)
	if !valid {
		return
	}
	if err := p.CloudAdminRevokeUserSessions(r.Context(), id); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *desktopIPCHandler) cloudAdminDeleteUser(w http.ResponseWriter, r *http.Request) {
	p, ok := h.adminUsersController(w)
	if !ok {
		return
	}
	id, valid := desktopAdminUserID(w, r)
	if !valid {
		return
	}
	if err := p.CloudAdminDeleteUser(r.Context(), id); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
