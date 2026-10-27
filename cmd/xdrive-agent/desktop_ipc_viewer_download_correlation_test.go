package main

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

type fakeIPCViewerDownloadCorrelated struct {
	*fakeDesktopIPCController
	calls           int
	id              uint64
	destination     string
	clientRequestID string
}

func (f *fakeIPCViewerDownloadCorrelated) CloudDownloadWithClientRequestID(
	_ context.Context, id uint64, destination, clientRequestID string,
) error {
	f.calls++
	f.id, f.destination, f.clientRequestID = id, destination, clientRequestID
	return nil
}

func TestDesktopDownloadCorrelationOptionalAndStrictlyValidated(t *testing.T) {
	controller := &fakeIPCViewerDownloadCorrelated{
		fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1},
	}
	handler := newDesktopIPCHandler(controller, "secret", func() {}, false)
	const endpoint = "/v1/cloud/download"
	const destination = "/tmp/viewer-image.jpg"
	firstNonce := strings.Repeat("ab", 16)
	secondNonce := strings.Repeat("cd", 16)
	for index, nonce := range []string{firstNonce, secondNonce} {
		body := fmt.Sprintf(`{"id":42,"destination":%q,"client_request_id":%q}`, destination, nonce)
		response := desktopIPCRequest(t, handler, http.MethodPost, endpoint, body)
		if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "\"ok\":true") {
			t.Fatalf("exact request %d failed: %d %s", index, response.Code, response.Body.String())
		}
		if controller.calls != index+1 || controller.id != 42 ||
			controller.destination != destination || controller.clientRequestID != nonce {
			t.Fatalf("download %d lost its exact request correlation: %+v", index, controller)
		}
	}
	for _, nonce := range []string{
		"too-short", strings.Repeat("A", 32), strings.Repeat("z", 32),
		strings.Repeat("a", 31), strings.Repeat("a", 33), strings.Repeat("a", 31) + "/",
	} {
		body := fmt.Sprintf(`{"id":42,"destination":%q,"client_request_id":%q}`, destination, nonce)
		bad := desktopIPCRequest(t, handler, http.MethodPost, endpoint, body)
		if bad.Code != http.StatusBadRequest {
			t.Fatalf("malformed nonce was accepted: HTTP %d", bad.Code)
		}
		if strings.Contains(bad.Body.String(), nonce) {
			t.Fatal("untrusted client correlation leaked into an error response")
		}
	}
	if controller.calls != 2 {
		t.Fatal("invalid correlated requests reached the owning Agent controller")
	}
	legacy := desktopIPCRequest(t, handler, http.MethodPost, endpoint,
		fmt.Sprintf(`{"id":42,"destination":%q}`, destination))
	if legacy.Code != http.StatusOK ||
		controller.fakeDesktopIPCController.cloudDownloadID != 42 ||
		controller.fakeDesktopIPCController.cloudDownloadDestination != destination ||
		controller.calls != 2 {
		t.Fatalf("legacy download behavior was modified: HTTP %d", legacy.Code)
	}
}

func TestOldAgentCannotSilentlyDropViewerDownloadCorrelation(t *testing.T) {
	legacy := &fakeDesktopIPCController{revision: 1}
	h := newDesktopIPCHandler(legacy, "secret", func() {}, false)
	response := desktopIPCRequest(t, h, http.MethodPost, "/v1/cloud/download",
		fmt.Sprintf(`{"id":42,"destination":"/tmp/old.jpg","client_request_id":%q}`, strings.Repeat("a", 32)))
	if response.Code != http.StatusNotImplemented || legacy.cloudDownloadID != 0 {
		t.Fatalf("legacy Agent silently accepted an untracked download: HTTP %d", response.Code)
	}
}
