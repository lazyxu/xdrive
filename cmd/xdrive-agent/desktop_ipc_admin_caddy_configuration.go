package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"

	"github.com/lazyxu/xdrive/internal/client"
)

type desktopIPCAdminCaddyDeployController interface {
	CloudStartAdminCaddyDeploy(context.Context) (client.AdminCaddyDeployState, error)
	CloudAdminCaddyDeployStatus(context.Context, string) (client.AdminCaddyDeployState, error)
}
type desktopIPCAdminCaddyConfigurationController interface {
	CloudSaveAdminCaddyConfiguration(context.Context, client.AdminCaddyConfigurationSaveInput) (client.AdminCaddyConfigurationSaveResult, error)
}

// Fail closed when an older Agent has no atomic transport; never silently
// fall back to separate HTTPS and AliDNS writes or perform Host operations.
func (h *desktopIPCHandler) cloudSaveAdminCaddyConfiguration(w http.ResponseWriter, r *http.Request) {
	provider, ok := h.ctrl.(desktopIPCAdminCaddyConfigurationController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "admin_caddy_atomic_unsupported", "Upgrade Agent for atomic Caddy desired save")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 2048)
	var input struct {
		HTTPSRevision  *uint64 `json:"https_revision"`
		AliDNSRevision *uint64 `json:"alidns_revision"`
		HostEnvSHA256  string  `json:"host_env_sha256,omitempty"`
		HTTPS          *struct {
			Enabled    *bool   `json:"enabled"`
			Domain     *string `json:"domain"`
			LANEnabled *bool   `json:"lan_enabled"`
			LANIP      *string `json:"lan_ip"`
		} `json:"https"`
		AliDNS *client.AdminCaddyConfigurationAliDNS `json:"alidns"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var trailing any
	if decoder.Decode(&input) != nil || decoder.Decode(&trailing) != io.EOF ||
		input.HTTPSRevision == nil || input.AliDNSRevision == nil ||
		*input.HTTPSRevision > 1<<60 || *input.AliDNSRevision > 1<<60 ||
		(input.HTTPS == nil && input.AliDNS == nil) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_caddy_atomic_input", "Two revisions and a complete modified group are required")
		return
	}
	out := client.AdminCaddyConfigurationSaveInput{
		HTTPSRevision: *input.HTTPSRevision, AliDNSRevision: *input.AliDNSRevision,
		HostEnvSHA256: input.HostEnvSHA256,
	}
	if input.HTTPS != nil {
		cfg := input.HTTPS
		if cfg.Enabled == nil || cfg.Domain == nil || cfg.LANEnabled == nil || cfg.LANIP == nil ||
			len(*cfg.Domain) > 253 || len(*cfg.LANIP) > 15 ||
			(!*cfg.Enabled && !*cfg.LANEnabled) {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_caddy_atomic_https", "Full bounded HTTPS domain and LAN targets required")
			return
		}
		out.HTTPS = &client.AdminCaddyConfigurationHTTPS{
			Enabled: *cfg.Enabled, Domain: *cfg.Domain,
			LANEnabled: *cfg.LANEnabled, LANIP: *cfg.LANIP,
		}
	}
	if input.AliDNS != nil {
		switch input.AliDNS.Action {
		case "replace":
			if !validDesktopCaddyAliDNSChange(input.AliDNS.AccessKeyID, input.AliDNS.AccessKeySecret) {
				writeDesktopIPCError(w, http.StatusBadRequest, "invalid_caddy_atomic_alidns", "Provide both bounded AliDNS credentials")
				return
			}
		case "clear":
			if input.AliDNS.AccessKeyID != "" || input.AliDNS.AccessKeySecret != "" {
				writeDesktopIPCError(w, http.StatusBadRequest, "invalid_caddy_atomic_alidns", "Clear cannot contain credentials")
				return
			}
		default:
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_caddy_atomic_alidns", "Explicit replace or clear is required")
			return
		}
		copy := *input.AliDNS
		out.AliDNS = &copy
	}
	result, err := provider.CloudSaveAdminCaddyConfiguration(r.Context(), out)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) cloudStartAdminCaddyDeploy(w http.ResponseWriter, r *http.Request) {
	provider, ok := h.ctrl.(desktopIPCAdminCaddyDeployController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "admin_caddy_deploy_unsupported", "Upgrade Agent for Caddy deploy")
		return
	}
	result, err := provider.CloudStartAdminCaddyDeploy(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeDesktopIPCJSON(w, http.StatusAccepted, result)
}
func (h *desktopIPCHandler) cloudAdminCaddyDeployStatus(w http.ResponseWriter, r *http.Request) {
	provider, ok := h.ctrl.(desktopIPCAdminCaddyDeployController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "admin_caddy_deploy_unsupported", "Upgrade Agent for Caddy deploy")
		return
	}
	id := r.URL.Query().Get("request_id")
	if len(id) != 24 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_caddy_deploy_id", "Invalid Caddy operation ID")
		return
	}
	for _, c := range id {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_caddy_deploy_id", "Invalid Caddy operation ID")
			return
		}
	}
	result, err := provider.CloudAdminCaddyDeployStatus(r.Context(), id)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeDesktopIPCJSON(w, http.StatusOK, result)
}
