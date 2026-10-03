package sourcemetadata

import (
	"strings"
	"testing"
	"time"
)

func TestValidateSnapshotsNormalizesProvenance(t *testing.T) {
	created := time.Date(2026, 9, 26, 1, 2, 3, 0, time.UTC)
	snapshots := []Snapshot{{
		ItemExternalID:  " yike:123:1 ",
		OriginalPath:    " /DCIM/A.JPG ",
		OwnerExternalID: " 123 ",
		RemoteCreatedAt: &created,
		ContentMD5:      strings.Repeat("A", 32),
	}}
	if err := validateSnapshots(snapshots); err != nil {
		t.Fatal(err)
	}
	got := snapshots[0]
	if got.ItemExternalID != "yike:123:1" ||
		got.OriginalPath != "/DCIM/A.JPG" ||
		got.OwnerExternalID != "123" ||
		got.RemoteCreatedAt == nil || !got.RemoteCreatedAt.Equal(created) ||
		got.ContentMD5 != strings.Repeat("a", 32) {
		t.Fatalf("normalized snapshot=%+v", got)
	}
}

func TestValidateSnapshotsRejectsInvalidMD5(t *testing.T) {
	if err := validateSnapshots([]Snapshot{{
		ItemExternalID: "x",
		ContentMD5:     "not-md5",
	}}); err == nil {
		t.Fatal("invalid md5 was accepted")
	}
}

func TestValidateSnapshotsRejectsDuplicates(t *testing.T) {
	if err := validateSnapshots([]Snapshot{
		{ItemExternalID: "x"},
		{ItemExternalID: " x "},
	}); err == nil {
		t.Fatal("duplicate metadata external id was accepted")
	}
}
