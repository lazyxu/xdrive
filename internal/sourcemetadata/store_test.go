package sourcemetadata

import (
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestValidateSnapshotsNormalizesMetadata(t *testing.T) {
	created := time.Date(2026, 9, 26, 1, 2, 3, 0, time.UTC)
	snapshots := []Snapshot{{
		ItemExternalID:  " yike:123:1 ",
		OriginalPath:    " /DCIM/A.JPG ",
		OwnerExternalID: " 123 ",
		RemoteCreatedAt: &created,
		ContentMD5:      strings.Repeat("A", 32),
		ThumbnailURL:    " https://thumb.example/a ",
	}}
	if err := validateSnapshots(snapshots); err != nil {
		t.Fatal(err)
	}
	got := snapshots[0]
	if got.ItemExternalID != "yike:123:1" ||
		got.OriginalPath != "/DCIM/A.JPG" ||
		got.OwnerExternalID != "123" ||
		got.ContentMD5 != strings.Repeat("a", 32) ||
		got.ThumbnailURL != "https://thumb.example/a" {
		t.Fatalf("normalized snapshot=%+v", got)
	}
}

func TestValidateSnapshotsRejectsInvalidPairingAndMD5(t *testing.T) {
	tests := []Snapshot{
		{ItemExternalID: "x", ContentMD5: "not-md5"},
		{ItemExternalID: "x", PairGroupID: "group-only"},
		{ItemExternalID: "x", PairRole: meta.SourceMediaPairRoleStill},
		{ItemExternalID: "x", PairGroupID: "g", PairRole: "guess"},
	}
	for _, snapshot := range tests {
		if err := validateSnapshots([]Snapshot{snapshot}); err == nil {
			t.Fatalf("invalid snapshot was accepted: %+v", snapshot)
		}
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
