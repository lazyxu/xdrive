package api

import (
	"strings"
	"testing"
)

func TestNormalizeMediaTags(t *testing.T) {
	tags, err := normalizeMediaTags([]string{
		"  Travel  ",
		"family",
		"TRAVEL",
		"New   York",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"family", "New York", "Travel"}
	if strings.Join(tags, "|") != strings.Join(want, "|") {
		t.Fatalf("tags=%v want=%v", tags, want)
	}
	raw, err := encodeMediaTags(tags)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeMediaTags(raw)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(decoded, "|") != strings.Join(want, "|") {
		t.Fatalf("decoded=%v want=%v", decoded, want)
	}
}

func TestNormalizeMediaTagsAllowsClear(t *testing.T) {
	raw, err := encodeMediaTags([]string{})
	if err != nil {
		t.Fatal(err)
	}
	if raw != "" {
		t.Fatalf("raw=%q want empty", raw)
	}
	tags, err := decodeMediaTags(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(tags) != 0 {
		t.Fatalf("tags=%v want empty", tags)
	}
}

func TestNormalizeMediaTagsRejectsInvalidInput(t *testing.T) {
	tooMany := make([]string, mediaTagMaxCount+1)
	for index := range tooMany {
		tooMany[index] = "tag-" + strings.Repeat("x", index%3+1)
	}
	if _, err := normalizeMediaTags(tooMany); err == nil {
		t.Fatal("too many tags were accepted")
	}
	if _, err := normalizeMediaTags([]string{""}); err == nil {
		t.Fatal("empty tag was accepted")
	}
	if _, err := normalizeMediaTags([]string{strings.Repeat("x", mediaTagMaxRunes+1)}); err == nil {
		t.Fatal("oversized tag was accepted")
	}
	if _, err := normalizeMediaTags([]string{"bad\x00tag"}); err == nil {
		t.Fatal("control character tag was accepted")
	}
}
