package main

import (
	"context"
	"net/http"
	"regexp"

	"github.com/lazyxu/xdrive/internal/client"
)

// Optional extension: older Agent builds still run Files/Gallery/Server update
// without exposing a nonfunctional Release Bundle control to Desktop.
type desktopIPCReleaseBundleController interface {
	CloudReleaseBundleState(context.Context) (client.ReleaseBundleListing, error)
	CloudRetryReleaseBundle(context.Context) error
	CloudDownloadReleaseBundle(context.Context, string, string, string) error
	CloudInstallCurrentServerCommit(context.Context, string, string, bool) (clientUpdateState, error)
}

var desktopReleaseBundleCommit = regexp.MustCompile(`^[0-9a-f]{40}$`)
var desktopReleaseBundleFile = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._+-]{0,180}$`)

func (h *desktopIPCHandler) releaseBundleController(w http.ResponseWriter) (desktopIPCReleaseBundleController, bool) {
	ctrl, ok := h.ctrl.(desktopIPCReleaseBundleController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "release_bundle_unsupported",
			"Update xDrive Agent to use the current Server Release Bundle.")
	}
	return ctrl, ok
}

func (h *desktopIPCHandler) releaseBundleState(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	ctrl, ok := h.releaseBundleController(w)
	if !ok {
		return
	}
	state, err := ctrl.CloudReleaseBundleState(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, state)
}

func (h *desktopIPCHandler) releaseBundleRetry(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	ctrl, ok := h.releaseBundleController(w)
	if !ok {
		return
	}
	if err := ctrl.CloudRetryReleaseBundle(r.Context()); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusAccepted, map[string]string{"state": "queued"})
}

func (h *desktopIPCHandler) releaseBundleDownload(w http.ResponseWriter, r *http.Request) {
	ctrl, ok := h.releaseBundleController(w)
	if !ok {
		return
	}
	var input struct {
		Commit      string `json:"commit"`
		Filename    string `json:"filename"`
		Destination string `json:"destination"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if !desktopReleaseBundleCommit.MatchString(input.Commit) ||
		!desktopReleaseBundleFile.MatchString(input.Filename) ||
		len(input.Destination) == 0 || len(input.Destination) > 4096 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_bundle_download",
			"An exact full Commit, approved filename and explicit save destination are required.")
		return
	}
	if err := ctrl.CloudDownloadReleaseBundle(r.Context(),
		input.Commit, input.Filename, input.Destination); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"saved": true})
}

func (h *desktopIPCHandler) releaseBundleInstall(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	ctrl, ok := h.releaseBundleController(w)
	if !ok {
		return
	}
	var input struct {
		Commit           string `json:"commit"`
		Filename         string `json:"filename"`
		Confirm          bool   `json:"confirm"`
		PersonalUnsigned bool   `json:"personal_unsigned"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if !input.Confirm || !desktopReleaseBundleCommit.MatchString(input.Commit) ||
		!desktopReleaseBundleFile.MatchString(input.Filename) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_bundle_install",
			"An explicit user confirmation and exact full Commit are required.")
		return
	}
	state, err := ctrl.CloudInstallCurrentServerCommit(r.Context(), input.Commit, input.Filename, input.PersonalUnsigned)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusAccepted, state)
}
