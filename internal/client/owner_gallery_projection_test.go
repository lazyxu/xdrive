package client

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func ownerGalleryFixture() MediaItemRange {
	parent := uint64(17)
	now := time.Date(2026, 10, 28, 0, 0, 0, 0, time.UTC)
	return MediaItemRange{
		Items: []MediaItem{{
			Node: Node{ID: 42, ParentID: &parent, Name: "owner.jpg", Type: "file",
				Size: 1234, Revision: 7, CreatedAt: now, UpdatedAt: now,
				SHA256: strings.Repeat("a", 64)},
			Metadata: MediaMetadata{MediaKind: "image", MIMEType: "image/jpeg",
				Width: 480, Height: 640, IndexState: "ready", HasThumbnail: true,
				EXIF: map[string]any{"secret": "private"}, Latitude: new(float64)},
			AssetKind: "image", Favorite: true, Description: "private description",
			Tags: []string{"private tag"},
		}},
		TotalCount: 1, Offset: 0, Limit: 100,
	}
}

func TestOwnerGalleryProjectionRedactsEverythingBeyondApprovedReadFields(t *testing.T) {
	page, err := ProjectOwnerGalleryPage(ownerGalleryFixture(), 100, 0)
	if err != nil || !ValidOwnerGalleryPage(page, 100, 0) || page.TotalCount != 1 {
		t.Fatalf("Owner gallery projection invalid: %+v %v", page, err)
	}
	data, err := json.Marshal(page)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{
		"private description", "private tag", "EXIF", "exif", "latitude",
		"sha256", "secret", "resources", "ocr", "trash_root", "token", "owner_username",
	} {
		if strings.Contains(string(data), forbidden) {
			t.Errorf("sensitive Gallery field was serialized: %s", forbidden)
		}
	}
	if !strings.Contains(string(data), `"has_thumbnail":true`) ||
		!strings.Contains(string(data), `"total_count":1`) {
		t.Fatal("real Owner count or thumbnail identity was lost")
	}
}

func TestOwnerGalleryProjectionRejectsInvalidRangeAndNodes(t *testing.T) {
	for _, mutate := range []func(*MediaItemRange){
		func(p *MediaItemRange) { p.TotalCount = -1 },
		func(p *MediaItemRange) { p.TotalCount = 0 },
		func(p *MediaItemRange) { p.Offset = 2 },
		func(p *MediaItemRange) { p.Limit = 200 },
		func(p *MediaItemRange) { p.Items = append(p.Items, p.Items[0]) },
		func(p *MediaItemRange) { p.Items[0].Node.ID = 0 },
		func(p *MediaItemRange) { p.Items[0].Node.ID = ownerGalleryMaxSafe + 1 },
		func(p *MediaItemRange) { p.Items[0].Node.ParentID = nil },
		func(p *MediaItemRange) { p.Items[0].Node.Size = -1 },
		func(p *MediaItemRange) { p.Items[0].Node.DeletedAt = new(time.Time) },
		func(p *MediaItemRange) { p.Items[0].Metadata.MediaKind = "file" },
		func(p *MediaItemRange) { p.Items[0].Metadata.Width = -1 },
		func(p *MediaItemRange) { p.Items[0].Metadata.MIMEType = "image/jpeg\nBearer xyz" },
		func(p *MediaItemRange) { p.Items[0].AssetKind = "../secret" },
	} {
		source := ownerGalleryFixture()
		mutate(&source)
		if out, err := ProjectOwnerGalleryPage(source, 100, 0); err == nil {
			t.Errorf("unsafe original Gallery response was projected: %+v", out)
		}
	}
	for _, limit := range []int{0, -1, 101} {
		if ValidOwnerGalleryWindow(limit, 0) {
			t.Errorf("invalid Gallery limit accepted: %d", limit)
		}
	}
}

func TestOwnerGalleryAlbumProjectionIsBoundedAndRedacted(t *testing.T) {
	now := time.Now()
	cover := uint64(42)
	albums, err := ProjectOwnerGalleryAlbums([]MediaAlbum{{
		ID: "manual:abc", Kind: "manual", Name: "Favorites",
		ItemCount: 1, CoverNodeID: &cover,
		UpdatedAt: &now, Query: &MediaSmartAlbumQuery{Search: "secret"},
	}})
	if err != nil || len(albums) != 1 {
		t.Fatalf("safe album unavailable: %+v %v", albums, err)
	}
	data, err := json.Marshal(albums)
	if err != nil || strings.Contains(string(data), "secret") {
		t.Fatal("smart album query leaked", err)
	}
	for _, id := range []string{"", "folder:../../etc", "manual:", "bad:abc",
		"manual:ab\ncd", "source:http://evil.test", "smart:ab?x=1"} {
		if ValidOwnerGalleryAlbumID(id) {
			t.Errorf("invalid album accepted: %q", id)
		}
	}
	if _, err := ProjectOwnerGalleryAlbums([]MediaAlbum{{ID: "manual:1",
		Kind: "manual", Name: "ok"}, {ID: "manual:1", Kind: "manual", Name: "duplicate"}}); err == nil {
		t.Fatal("duplicate Owner albums accepted")
	}
}

func TestOwnerGalleryEmptyRangeBeyondLastItemIsGenuineEmpty(t *testing.T) {
	empty := MediaItemRange{Items: []MediaItem{}, TotalCount: 3, Offset: 100, Limit: 100}
	projected, err := ProjectOwnerGalleryPage(empty, 100, 100)
	if err != nil || !ValidOwnerGalleryPage(projected, 100, 100) || len(projected.Items) != 0 {
		t.Fatalf("valid out-of-range Gallery page rejected: %+v %v", projected, err)
	}
	// An empty window inside the known total is not a valid sparse Range.
	empty.Offset = 0
	if _, err := ProjectOwnerGalleryPage(empty, 100, 0); err == nil {
		t.Fatal("non-advancing Owner Gallery page accepted")
	}
	if ValidOwnerGalleryPage(OwnerGalleryPage{Items: []OwnerGalleryItem{}, TotalCount: 3, Limit: 100}, 100, 0) {
		t.Fatal("stalled Owner Gallery read accepted")
	}
	if ValidOwnerGalleryPage(OwnerGalleryPage{TotalCount: 0, Offset: 0, Limit: 100}, 100, 0) {
		t.Fatal("missing Owner media items array accepted as verified empty")
	}
}

func TestOwnerGalleryUntrustedAssetKindCannotCrossProjectionBoundaries(t *testing.T) {
	original := ownerGalleryFixture()
	projected, err := ProjectOwnerGalleryPage(original, 100, 0)
	if err != nil {
		t.Fatalf("safe projection failed: %v", err)
	}
	for _, invalid := range []string{"../../secret", "IMG", "live-photo", "bad\\nline", strings.Repeat("x", 65)} {
		original.Items[0].AssetKind = invalid
		if _, err := ProjectOwnerGalleryPage(original, 100, 0); err == nil {
			t.Errorf("untrusted Server asset kind was projected: %q", invalid)
		}
		projected.Items[0].AssetKind = invalid
		if ValidOwnerGalleryPage(projected, 100, 0) {
			t.Errorf("untrusted Agent asset kind would enter DSM: %q", invalid)
		}
	}
}
