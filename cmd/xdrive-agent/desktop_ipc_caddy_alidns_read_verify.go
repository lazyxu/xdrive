package main

import (
	"context"
	"net/http"

	"github.com/lazyxu/xdrive/internal/client"
)

type desktopIPCAdminCaddyAliDNSReadVerifyController interface {
	CloudVerifyAdminCaddyAliDNSRead(context.Context, client.AdminCaddyAliDNSReadVerifyInput) (client.AdminCaddyAliDNSReadVerify, error)
}

func (h *desktopIPCHandler) cloudVerifyAdminCaddyAliDNSRead(w http.ResponseWriter, r *http.Request) {
	p, ok := h.ctrl.(desktopIPCAdminCaddyAliDNSReadVerifyController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "admin_caddy_alidns_verify_unsupported", "AliDNS read verification is unsupported")
		return
	}
	var input struct {
		DesiredRevision    *uint64 `json:"desired_revision"`
		CredentialRevision *uint64 `json:"credential_revision"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.DesiredRevision == nil || input.CredentialRevision == nil ||
		*input.DesiredRevision == 0 || *input.CredentialRevision == 0 ||
		*input.DesiredRevision > 1<<60 || *input.CredentialRevision > 1<<60 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_alidns_revisions", "Current HTTPS and credential revisions required")
		return
	}
	result, err := p.CloudVerifyAdminCaddyAliDNSRead(r.Context(), client.AdminCaddyAliDNSReadVerifyInput{
		DesiredRevision: *input.DesiredRevision, CredentialRevision: *input.CredentialRevision,
	})
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	writeDesktopIPCJSON(w, http.StatusOK, result)
}
