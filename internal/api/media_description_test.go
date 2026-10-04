package api

import (
	"strings"
	"testing"
)

func TestNormalizeMediaDescription(t *testing.T) {
	got, err := normalizeMediaDescription("  First line\r\nSecond\tline  ")
	if err != nil {
		t.Fatal(err)
	}
	if got != "First line\nSecond\tline" {
		t.Fatalf("description=%q", got)
	}
}

func TestNormalizeMediaDescriptionAllowsClear(t *testing.T) {
	got, err := normalizeMediaDescription(" \n\t ")
	if err != nil {
		t.Fatal(err)
	}
	if got != "" {
		t.Fatalf("description=%q want empty", got)
	}
}

func TestNormalizeMediaDescriptionRejectsInvalidInput(t *testing.T) {
	if _, err := normalizeMediaDescription(strings.Repeat("x", mediaDescriptionMaxRunes+1)); err == nil {
		t.Fatal("oversized description was accepted")
	}
	if _, err := normalizeMediaDescription("bad\x00description"); err == nil {
		t.Fatal("control character description was accepted")
	}
}
