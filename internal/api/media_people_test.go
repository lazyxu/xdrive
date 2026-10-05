package api

import (
	"strings"
	"testing"
)

func TestNormalizeMediaPeople(t *testing.T) {
	people, err := normalizeMediaPeople([]string{
		"  Alice  Smith ",
		"张三",
		"ALICE   SMITH",
		"Bob",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"Alice Smith", "Bob", "张三"}
	if strings.Join(people, "|") != strings.Join(want, "|") {
		t.Fatalf("people=%v want=%v", people, want)
	}
	raw, err := encodeMediaPeople(people)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeMediaPeople(raw)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(decoded, "|") != strings.Join(want, "|") {
		t.Fatalf("decoded=%v want=%v", decoded, want)
	}
}

func TestNormalizeMediaPeopleAllowsClear(t *testing.T) {
	raw, err := encodeMediaPeople([]string{})
	if err != nil {
		t.Fatal(err)
	}
	if raw != "" {
		t.Fatalf("raw=%q want empty", raw)
	}
	people, err := decodeMediaPeople(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(people) != 0 {
		t.Fatalf("people=%v want empty", people)
	}
}

func TestNormalizeMediaPeopleRejectsInvalidInput(t *testing.T) {
	tooMany := make([]string, mediaPersonMaxCount+1)
	for index := range tooMany {
		tooMany[index] = "person-" + strings.Repeat("x", index%3+1)
	}
	if _, err := normalizeMediaPeople(tooMany); err == nil {
		t.Fatal("too many people were accepted")
	}
	if _, err := normalizeMediaPeople([]string{""}); err == nil {
		t.Fatal("empty person was accepted")
	}
	if _, err := normalizeMediaPeople([]string{strings.Repeat("x", mediaPersonMaxRunes+1)}); err == nil {
		t.Fatal("oversized person was accepted")
	}
	if _, err := normalizeMediaPeople([]string{"bad\x00person"}); err == nil {
		t.Fatal("control character person was accepted")
	}
}
