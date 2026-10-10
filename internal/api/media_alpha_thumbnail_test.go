package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/storage"
)

func TestServeTransparentThumbnailIncludesExactAlphaMaskBeforeBody(t *testing.T) {
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	pixels := image.NewNRGBA(image.Rect(0, 0, 4, 4))
	for y := 0; y < 4; y++ {
		for x := 0; x < 4; x++ {
			pixels.SetNRGBA(x, y, color.NRGBA{R: 255, G: 0, B: 0, A: uint8((x + y) * 32)})
		}
	}
	var body bytes.Buffer
	if err := png.Encode(&body, pixels); err != nil {
		t.Fatal(err)
	}
	key := mediapkg.ThumbnailStorageKeyForSource(7, 9, "abc", 512, "image/png")
	if _, err := store.Put(context.Background(), key, bytes.NewReader(body.Bytes())); err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/media/items/7/thumbnail", nil)
	server := &Server{Store: store}
	if !server.tryServeMediaDerivative(c, key, "photo.png.jpg", "image/jpeg", time.Now()) {
		t.Fatal("cached thumbnail not served")
	}
	result := recorder.Result()
	defer result.Body.Close()
	if got := result.Header.Get("Content-Type"); got != "image/png" {
		t.Fatalf("MIME=%q", got)
	}
	if got := result.Header.Get("Content-Length"); got != fmt.Sprint(body.Len()) {
		t.Fatalf("Content-Length=%q want=%d", got, body.Len())
	}
	mask := result.Header.Get("X-XDrive-Thumbnail-Alpha-Mask")
	if mask == "" {
		t.Fatal("missing early alpha-mask header")
	}
	decoded, err := base64.StdEncoding.DecodeString(mask)
	if err != nil {
		t.Fatal(err)
	}
	raster, err := png.Decode(bytes.NewReader(decoded))
	if err != nil {
		t.Fatal(err)
	}
	_, _, _, got := raster.At(3, 3).RGBA()
	_, _, _, want := pixels.At(3, 3).RGBA()
	if got != want {
		t.Fatalf("mask alpha=%d expected %d", got, want)
	}
	if !bytes.Equal(recorder.Body.Bytes(), body.Bytes()) {
		t.Fatal("PNG derivative body was altered")
	}
}
