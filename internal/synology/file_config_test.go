package synology

import (
	"reflect"
	"testing"
)

func TestNormalizeFilePullConfig(t *testing.T) {
	got, err := NormalizeFilePullConfig(FilePullConfig{
		Roots: []string{"/video/projects", "/documents", "/documents"},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"/documents", "/video/projects"}
	if !reflect.DeepEqual(got.Roots, want) {
		t.Fatalf("roots=%v want=%v", got.Roots, want)
	}
}

func TestNormalizeFilePullConfigRejectsEmptyRootAndOverlap(t *testing.T) {
	for _, input := range []FilePullConfig{
		{},
		{Roots: []string{"/"}},
		{Roots: []string{"/documents", "/documents/work"}},
		{Roots: []string{"documents"}},
		{Roots: []string{"/documents\\work"}},
	} {
		if _, err := NormalizeFilePullConfig(input); err == nil {
			t.Fatalf("config %+v was accepted", input)
		}
	}
}

func TestNormalizeFileStationPath(t *testing.T) {
	got, err := NormalizeFileStationPath("/documents//work/../notes")
	if err != nil {
		t.Fatal(err)
	}
	if got != "/documents/notes" {
		t.Fatalf("path=%q want=/documents/notes", got)
	}
}
