package media

import (
	"bytes"
	"image"
	"testing"
)

func TestHEICDecoderIsRegistered(t *testing.T) {
	// image.RegisterFormat matches bytes 4..11 before the HEIC decoder parses
	// the rest. A deliberately short container therefore proves the decoder is
	// wired into the standard image pipeline without embedding a binary fixture.
	data := []byte{0, 0, 0, 12, 'f', 't', 'y', 'p', 'h', 'e', 'i', 'c'}
	_, format, err := image.DecodeConfig(bytes.NewReader(data))
	if format != "heic" {
		t.Fatalf("format=%q want=heic (err=%v)", format, err)
	}
	if err == nil {
		t.Fatal("truncated HEIC unexpectedly decoded")
	}
}
