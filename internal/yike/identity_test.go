package yike

import (
	"strings"
	"testing"
)

func TestExternalIDUsesOwnerNamespace(t *testing.T) {
	own, err := ExternalID(123, 456)
	if err != nil {
		t.Fatal(err)
	}
	shared, err := ExternalID(999, 456)
	if err != nil {
		t.Fatal(err)
	}
	if own != "yike:123:456" {
		t.Fatalf("own=%q", own)
	}
	if shared != "yike:999:456" {
		t.Fatalf("shared=%q", shared)
	}
	if own == shared {
		t.Fatal("different Yike owners collided")
	}
}

func TestExternalIDRejectsInvalidProviderIdentity(t *testing.T) {
	for _, tc := range [][2]int64{{0, 1}, {1, 0}, {-1, 1}, {1, -1}} {
		if _, err := ExternalID(tc[0], tc[1]); err == nil {
			t.Fatalf("ExternalID(%d,%d) unexpectedly succeeded", tc[0], tc[1])
		}
	}
}

func TestAlbumExternalIDValidatesAndCanonicalizes(t *testing.T) {
	got, err := AlbumExternalID("  abc  ")
	if err != nil {
		t.Fatal(err)
	}
	if got != "yike:album:abc" {
		t.Fatalf("album=%q", got)
	}
	if _, err := AlbumExternalID(""); err == nil {
		t.Fatal("empty album id unexpectedly succeeded")
	}
	if _, err := AlbumExternalID(strings.Repeat("x", 502)); err == nil {
		t.Fatal("overlong album id unexpectedly succeeded")
	}
}
