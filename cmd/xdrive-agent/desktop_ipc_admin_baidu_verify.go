package main

import (
	"context"
	"net/http"

	"github.com/lazyxu/xdrive/internal/client"
)

func (h *desktopIPCHandler) cloudVerifyAdminBaiduMap(w http.ResponseWriter, r *http.Request) {
	provider, ok := h.ctrl.(interface {
		CloudVerifyAdminBaiduMap(context.Context, uint64) (client.AdminBaiduMapVerification, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "admin_baidu_map_verify_unavailable", "Baidu live verification is unsupported by this Agent")
		return
	}
	var input struct {
		Revision *uint64 `json:"revision"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.Revision == nil || *input.Revision > 1<<60 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_baidu_revision", "current revision is required")
		return
	}
	out, err := provider.CloudVerifyAdminBaiduMap(r.Context(), *input.Revision)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeDesktopIPCJSON(w, http.StatusOK, out)
}
