package main

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

type fakeIPCOwnerThumbnailReader struct {
	*fakeDesktopIPCController
	calls int
	bad   bool
}

func (f *fakeIPCOwnerThumbnailReader) CloudOwnerThumbnail(
	_ context.Context, id, revision uint64,
) (client.OwnerThumbnail, error) {
	f.calls++
	if id != 42 || revision != 7 {
		return client.OwnerThumbnail{}, context.Canceled
	}
	img := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.NRGBA{R: 100, G: 160, B: 255, A: 255})
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, img); err != nil {
		return client.OwnerThumbnail{}, err
	}
	value := client.OwnerThumbnail{ContentType: "image/png", AlphaState: "opaque", Data: buffer.Bytes()}
	if f.bad {
		value.ContentType = "text/html"
	}
	return value, nil
}

func TestBackupOnlyOwnerThumbnailOnlyCanonicalGET(t *testing.T) {
	reader := &fakeIPCOwnerThumbnailReader{fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1}}
	h := newDesktopIPCHandler(reader, "secret", func() {}, true)
	if fullAgentOnlyRequest(http.MethodGet, "/v1/cloud/thumbnail") ||
		!fullAgentOnlyRequest(http.MethodPost, "/v1/cloud/thumbnail") {
		t.Fatal("Owner thumbnail incorrectly exposed as an arbitrary route")
	}
	hasCapability := false
	for _, name := range desktopIPCCapabilitiesForRuntime(true) {
		if name == "cloud-thumbnail-read" {
			hasCapability = true
		}
	}
	if !hasCapability {
		t.Fatal("Backup-only Agent does not advertise bounded thumbnail capability")
	}
	goodPath := "/v1/cloud/thumbnail?node_id=42&revision=7"
	ok := desktopIPCRequest(t, h, http.MethodGet, goodPath, "")
	if ok.Code != http.StatusOK || reader.calls != 1 {
		t.Fatalf("valid Owner thumbnail failed: HTTP %d %s", ok.Code, ok.Body.String())
	}
	var good client.OwnerThumbnail
	if err := json.Unmarshal(ok.Body.Bytes(), &good); err != nil || !client.ValidateOwnerThumbnail(good) {
		t.Fatal("valid PNG projection is not a real image")
	}
	if strings.Contains(ok.Body.String(), "Bearer secret") {
		t.Fatal("private Agent token leaked through thumbnail projection")
	}
	for _, path := range []string{
		"/v1/cloud/thumbnail",
		"/v1/cloud/thumbnail?node_id=0&revision=7",
		"/v1/cloud/thumbnail?node_id=042&revision=7",
		"/v1/cloud/thumbnail?node_id=42&revision=07",
		"/v1/cloud/thumbnail?node_id=42&revision=0",
		"/v1/cloud/thumbnail?node_id=42&revision=7&url=https://private.example",
		"/v1/cloud/thumbnail?node_id=42&revision=7&node_id=99",
		"/v1/cloud/thumbnail?node_id=42&revision=7;op=run",
	} {
		if bad := desktopIPCRequest(t, h, http.MethodGet, path, ""); bad.Code == http.StatusOK {
			t.Fatalf("invalid Owner thumbnail selector accepted: %s", path)
		}
	}
	if reader.calls != 1 {
		t.Fatal("invalid Owner thumbnail selector reached original Agent")
	}
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		if bad := desktopIPCRequest(t, h, method, goodPath, ""); bad.Code != http.StatusConflict {
			t.Fatalf("backup-only Owner thumbnail mutation accepted: %s HTTP %d", method, bad.Code)
		}
	}
	reader.bad = true
	if bad := desktopIPCRequest(t, h, http.MethodGet, goodPath, ""); bad.Code == http.StatusOK {
		t.Fatal("forged image passed desktop IPC")
	}
	old := newDesktopIPCHandler(&fakeDesktopIPCController{revision: 1}, "secret", func() {}, true)
	if missing := desktopIPCRequest(t, old, http.MethodGet, goodPath, ""); missing.Code != http.StatusNotImplemented {
		t.Fatalf("old Agent unexpectedly served new thumbnail: %d", missing.Code)
	}
}
