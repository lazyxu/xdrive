package media

import "testing"

func TestVideoPosterStorageKeyUsesContentIdentity(t *testing.T) {
	const sha = "AABBCCDDEEFF"
	if got, want := VideoPosterStorageKey(7, 9, sha), ".xdrive-media/posters/aa/aabbccddeeff-v1-512.jpg"; got != want {
		t.Fatalf("storage key=%q want=%q", got, want)
	}
	if got, want := VideoPosterETag(7, 9, sha), "\"media-video-poster-aabbccddeeff-v1-512\""; got != want {
		t.Fatalf("etag=%q want=%q", got, want)
	}
}

func TestVideoPosterStorageKeyFallsBackToRevision(t *testing.T) {
	if got, want := VideoPosterStorageKey(7, 9, ""), ".xdrive-media/posters/node/7-9-v1-512.jpg"; got != want {
		t.Fatalf("storage key=%q want=%q", got, want)
	}
	if got, want := VideoPosterETag(7, 9, ""), "\"media-video-poster-node-7-9-v1-512\""; got != want {
		t.Fatalf("etag=%q want=%q", got, want)
	}
}
