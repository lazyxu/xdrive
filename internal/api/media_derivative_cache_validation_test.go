package api

import (
	"bytes"
	"image"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	mediapkg "github.com/lazyxu/xdrive/internal/media"
)

func TestMediaDerivativeCacheImageEnvelopeValidation(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 3, 2))
	var jpg, pngData bytes.Buffer
	if err := jpeg.Encode(&jpg, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(&pngData, img); err != nil {
		t.Fatal(err)
	}
	jpgKey := mediapkg.ThumbnailStoragePrefix + "aa/sha-v3-512.jpg"
	thumbKey := mediapkg.ThumbnailStoragePrefix + "aa/sha-v4-512.thumb"
	for _, tc := range []struct {
		name string
		key  string
		data []byte
		want bool
	}{
		{"opaque jpeg", jpgKey, jpg.Bytes(), true},
		{"v4 jpeg", thumbKey, jpg.Bytes(), true},
		{"v4 png", thumbKey, pngData.Bytes(), true},
		{"jpeg under wrong v3 key", jpgKey, pngData.Bytes(), false},
		{"truncated jpeg", jpgKey, jpg.Bytes()[:len(jpg.Bytes())-3], false},
		{"zero byte", thumbKey, nil, false},
		{"truncated png signature", thumbKey, pngData.Bytes()[:8], false},
		{"png without IEND", thumbKey, pngData.Bytes()[:len(pngData.Bytes())-12], false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "derivative.data")
			if err := os.WriteFile(path, tc.data, 0o600); err != nil {
				t.Fatal(err)
			}
			file, err := os.Open(path)
			if err != nil {
				t.Fatal(err)
			}
			defer file.Close()
			if got := mediaDerivativeCacheValid(file, tc.key); got != tc.want {
				t.Fatalf("cached image envelope valid=%t want=%t", got, tc.want)
			}
			// The envelope check may not consume bytes from the response file.
			if offset, err := file.Seek(0, 1); err != nil || offset != 0 {
				t.Fatalf("cache verification moved file offset to %d: %v", offset, err)
			}
		})
	}
}
