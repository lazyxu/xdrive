package client

import (
	"bytes"
	"context"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func ownerThumbnailTestPNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.NRGBA{R: 44, G: 88, B: 210, A: 255})
	var out bytes.Buffer
	if err := png.Encode(&out, img); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func TestOwnerThumbnailAcceptsOnlyBoundedRealImageAndMask(t *testing.T) {
	pngBytes := ownerThumbnailTestPNG(t)
	ok := OwnerThumbnail{ContentType: "image/png", AlphaState: "opaque", Data: pngBytes}
	if !ValidateOwnerThumbnail(ok) {
		t.Fatal("valid Owner PNG rejected")
	}
	oversized := image.NewNRGBA(image.Rect(0, 0, ownerThumbnailMaxDimension+1, 1))
	var tooLarge bytes.Buffer
	if err := png.Encode(&tooLarge, oversized); err != nil {
		t.Fatal(err)
	}
	if ValidateOwnerThumbnail(OwnerThumbnail{ContentType: "image/png", Data: tooLarge.Bytes()}) {
		t.Fatal("compressed thumbnail with excessive decoded dimensions accepted")
	}
	masked := ok
	masked.AlphaState = "masked"
	masked.AlphaMask = ""
	if ValidateOwnerThumbnail(masked) {
		t.Fatal("empty alpha mask accepted")
	}
	masked.AlphaMask = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL2zgAAAABJRU5ErkJggg=="
	if ValidateOwnerThumbnail(masked) {
		t.Fatal("alpha-mask dimensions mismatch was accepted")
	}
	masked.AlphaMask = base64.StdEncoding.EncodeToString(pngBytes)
	if !ValidateOwnerThumbnail(masked) {
		t.Fatal("matching real decoded alpha PNG mask was rejected")
	}
	masked.AlphaMask = base64.StdEncoding.EncodeToString(pngBytes[:40])
	if ValidateOwnerThumbnail(masked) {
		t.Fatal("alpha-mask header without complete PNG payload was accepted")
	}
	for _, modify := range []func(*OwnerThumbnail){
		func(v *OwnerThumbnail) { v.ContentType = "text/html" },
		// PNG DecodeConfig succeeds on a bare IHDR but the full decoder
		// must reject incomplete image data before the browser sees a Blob.
		func(v *OwnerThumbnail) { v.Data = append([]byte(nil), pngBytes[:40]...) },
		func(v *OwnerThumbnail) { v.ContentType = "image/jpeg" },
		func(v *OwnerThumbnail) { v.Data = nil },
		func(v *OwnerThumbnail) { v.Data = []byte("<html>not a thumbnail</html>") },
		func(v *OwnerThumbnail) { v.Data = bytes.Repeat([]byte("X"), OwnerThumbnailMaxBytes+1) },
		func(v *OwnerThumbnail) { v.AlphaState = "fake" },
		func(v *OwnerThumbnail) { v.AlphaMask = "secret" },
	} {
		changed := ok
		modify(&changed)
		if ValidateOwnerThumbnail(changed) {
			t.Fatal("invalid media derivative projected to DSM")
		}
	}
}

func TestMediaOwnerThumbnailBindsServerAccountAndCurrentRevision(t *testing.T) {
	imageBytes := ownerThumbnailTestPNG(t)
	hits := 0
	behavior := http.StatusOK
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/media/items/42/thumbnail" ||
			r.URL.Query().Get("v") != "4" || r.URL.Query().Get("revision") != "7" ||
			r.Header.Get("Authorization") != "Bearer secure" {
			t.Errorf("invalid Owner revision/auth in upstream read: %s %s", r.Method, r.URL)
		}
		if behavior != http.StatusOK {
			w.WriteHeader(behavior)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("X-XDrive-Thumbnail-Alpha-State", "opaque")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(imageBytes)
	}))
	defer server.Close()
	api := &Client{BaseURL: server.URL, Token: "secure", HTTP: server.Client()}
	if _, err := api.MediaOwnerThumbnail(context.Background(), 0, 7); err == nil {
		t.Fatal("invalid Node 0 admitted")
	}
	if _, err := api.MediaOwnerThumbnail(context.Background(), 42, 0); err == nil {
		t.Fatal("invalid revision 0 admitted")
	}
	if hits != 0 {
		t.Fatal("invalid IDs contacted Server")
	}
	thumbnail, err := api.MediaOwnerThumbnail(context.Background(), 42, 7)
	if err != nil || !bytes.Equal(thumbnail.Data, imageBytes) ||
		thumbnail.ContentType != "image/png" {
		t.Fatalf("revision-verified Server thumbnail failed: %+v %v", thumbnail, err)
	}
	behavior = http.StatusConflict
	if _, err := api.MediaOwnerThumbnail(context.Background(), 42, 7); err == nil {
		t.Fatal("stale Owner revision inherited cached thumbnail")
	}
	if hits != 2 {
		t.Fatalf("expected independent Server check per request, got %d", hits)
	}
	if strings.Contains(string(imageBytes), "Bearer secure") {
		t.Fatal("test fixture unexpectedly embeds credentials")
	}
}
