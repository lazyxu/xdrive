package api

import (
	"bytes"
	"image"
	"image/png"
	"strings"
	"testing"
)

func TestNotesImageMIMEAndImmutablePathPolicy(t *testing.T) {
	out := new(bytes.Buffer)
	if err := png.Encode(out, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	extension, mime, err := notesImageFormat(out.Bytes())
	if err != nil || extension != "png" || mime != "image/png" {
		t.Fatalf("valid PNG rejected: ext=%q mime=%q err=%v", extension, mime, err)
	}
	for _, sample := range [][]byte{
		[]byte("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
		[]byte("<html><script>alert(1)</script></html>"),
		[]byte("%PDF-1.7"),
		[]byte("not an image"),
		nil,
	} {
		if _, _, err := notesImageFormat(sample); err == nil {
			t.Fatalf("allowed nonimage bytes: %q", sample)
		}
	}
	imageFile := "12345678-1234-1234-1234-123456789abc.png"
	if actual, ok := notesImageType(imageFile); !ok || actual != "image/png" {
		t.Fatalf("valid immutable image ID rejected: %q %v", actual, ok)
	}
	for _, filename := range []string{
		"other-user.png", "../evil.png", "x.png", strings.Repeat("x", 300),
		"12345678-1234-1234-1234-123456789abc.svg",
		"12345678-1234-1234-1234-123456789abc.png.js",
		"12345678-1234-1234-1234-123456789abc.PNG",
	} {
		if _, ok := notesImageType(filename); ok {
			t.Fatalf("unauthorized Notes image path accepted: %q", filename)
		}
	}
}
