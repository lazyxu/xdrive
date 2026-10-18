package main

import (
	"context"
	"net/http"

	"github.com/lazyxu/xdrive/internal/client"
)

// Local Agent IPC authentication is independent of remote Server admin ACL.
type desktopIPCBaiduJSAPIController interface {
	CloudAdminBaiduJSAPIConfig(context.Context) (client.AdminBaiduJSAPIConfig, error)
	CloudSetAdminBaiduJSAPIConfig(context.Context, client.AdminBaiduJSAPIUpdate) (client.AdminBaiduJSAPIConfig, error)
}

type desktopIPCBaiduJSAPIInput struct {
	DesiredEnabled *bool   `json:"desired_enabled"`
	Revision       *uint64 `json:"revision"`
	BrowserAK      string  `json:"browser_ak,omitempty"`
	ClearAK        bool    `json:"clear_ak,omitempty"`
}

func validDesktopBaiduJSAPIInput(v desktopIPCBaiduJSAPIInput) bool {
	if v.DesiredEnabled == nil || v.Revision == nil ||
		*v.Revision > 1<<60 || len(v.BrowserAK) > 256 ||
		(v.ClearAK && (*v.DesiredEnabled || v.BrowserAK != "")) {
		return false
	}
	for _, b := range []byte(v.BrowserAK) {
		if b < '!' || b > '~' {
			return false
		}
	}
	return true
}

func (h *desktopIPCHandler) cloudAdminBaiduJSAPI(w http.ResponseWriter, r *http.Request) {
	provider, ok := h.ctrl.(desktopIPCBaiduJSAPIController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "admin_baidu_jsapi_unavailable", "Browser AK configuration is unsupported by this Agent")
		return
	}
	out, err := provider.CloudAdminBaiduJSAPIConfig(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	writeDesktopIPCJSON(w, http.StatusOK, out)
}

func (h *desktopIPCHandler) cloudSetAdminBaiduJSAPI(w http.ResponseWriter, r *http.Request) {
	provider, ok := h.ctrl.(desktopIPCBaiduJSAPIController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "admin_baidu_jsapi_unavailable", "Browser AK configuration is unsupported by this Agent")
		return
	}
	var input desktopIPCBaiduJSAPIInput
	// Shared decoder rejects unknown fields, overlong bodies and duplicate JSON.
	if !decodeDesktopIPCJSONLimit(w, r, &input, 1024) {
		return
	}
	if !validDesktopBaiduJSAPIInput(input) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_baidu_jsapi", "desired enabled, revision and valid Browser AK are required")
		return
	}
	out, err := provider.CloudSetAdminBaiduJSAPIConfig(r.Context(), client.AdminBaiduJSAPIUpdate{
		DesiredEnabled: *input.DesiredEnabled,
		Revision:       *input.Revision,
		BrowserAK:      input.BrowserAK,
		ClearAK:        input.ClearAK,
	})
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	writeDesktopIPCJSON(w, http.StatusOK, out)
}
