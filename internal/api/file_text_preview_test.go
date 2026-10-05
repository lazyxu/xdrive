package api

import (
	"strings"
	"testing"
)

func TestFileTextPreviewSupportedName(t *testing.T) {
	for _, name := range []string{
		"README", "LICENSE", "Dockerfile", ".gitignore",
		"notes.txt", "README.md", "data.json", "config.yaml", "main.go", "query.sql",
	} {
		if !fileTextPreviewSupportedName(name) {
			t.Fatalf("expected text preview support for %q", name)
		}
	}
	for _, name := range []string{
		"index.html", "graphic.svg", "secret.pem", "private.key", ".env",
		"photo.jpg", "video.mp4", "archive.zip", "unknown.bin",
	} {
		if fileTextPreviewSupportedName(name) {
			t.Fatalf("unexpected text preview support for %q", name)
		}
	}
}

func TestFileTextPreviewUTF8(t *testing.T) {
	textValue, ok := fileTextPreviewUTF8([]byte{0xef, 0xbb, 0xbf, 'h', 'i', '\n'})
	if !ok || textValue != "hi\n" {
		t.Fatalf("BOM text preview=%q ok=%v", textValue, ok)
	}
	if _, ok := fileTextPreviewUTF8([]byte{'a', 0, 'b'}); ok {
		t.Fatal("NUL-containing content must be rejected")
	}
	if _, ok := fileTextPreviewUTF8([]byte{0xff, 0xfe, 0xfd}); ok {
		t.Fatal("invalid UTF-8 content must be rejected")
	}
	prefix := strings.Repeat("a", fileTextPreviewLimit-1)
	textValue, ok = fileTextPreviewUTF8(append([]byte(prefix), 0xe4))
	if !ok || textValue != prefix {
		t.Fatalf("trailing partial UTF-8 sequence was not safely trimmed: len=%d ok=%v", len(textValue), ok)
	}
}
