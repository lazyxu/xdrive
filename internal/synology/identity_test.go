package synology

import "testing"

func TestExternalIDScopesItemsByPhotosSpace(t *testing.T) {
	personal, err := ExternalID(SpacePersonal, 80716)
	if err != nil {
		t.Fatal(err)
	}
	shared, err := ExternalID(SpaceShared, 80716)
	if err != nil {
		t.Fatal(err)
	}
	if personal != "synology:personal:80716" {
		t.Fatalf("personal=%q", personal)
	}
	if shared != "synology:shared:80716" {
		t.Fatalf("shared=%q", shared)
	}
	if personal == shared {
		t.Fatal("personal/shared identities collided")
	}
}

func TestExternalIDRejectsInvalidProviderIdentity(t *testing.T) {
	for _, tc := range []struct {
		space Space
		id    int64
	}{
		{Space("unknown"), 1},
		{SpacePersonal, 0},
		{SpaceShared, -1},
	} {
		if _, err := ExternalID(tc.space, tc.id); err == nil {
			t.Fatalf("ExternalID(%q,%d) unexpectedly succeeded", tc.space, tc.id)
		}
	}
}

func TestAlbumExternalIDScopesAlbumsByPhotosSpace(t *testing.T) {
	got, err := AlbumExternalID(SpaceShared, 101)
	if err != nil {
		t.Fatal(err)
	}
	if got != "synology:album:shared:101" {
		t.Fatalf("album=%q", got)
	}
}
