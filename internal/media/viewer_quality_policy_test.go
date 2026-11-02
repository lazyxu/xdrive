package media

import (
	"errors"
	"strings"
	"testing"
)

func TestResolveViewerQualityUserAndAdminPrecedence(t *testing.T) {
	cases := []struct {
		account, device, maximum string
		requested, effective ViewerQualityPreset
		capped bool
	}{
		{"", "", "", ViewerQualityHigh, ViewerQualityHigh, false},
		{"balanced", "", "high", ViewerQualityBalanced, ViewerQualityBalanced, false},
		{"high", "economy", "high", ViewerQualityEconomy, ViewerQualityEconomy, false},
		{"high", "", "economy", ViewerQualityHigh, ViewerQualityEconomy, true},
		{"economy", "high", "balanced", ViewerQualityHigh, ViewerQualityBalanced, true},
	}
	for _, c := range cases {
		resolved, err := ResolveViewerQuality(c.account, c.device, c.maximum)
		if err != nil || resolved.Requested != c.requested || resolved.Effective != c.effective || resolved.Capped != c.capped {
			t.Fatalf("wrong preset resolution: %+v error %v", resolved, err)
		}
	}
	for _, c := range [][3]string{{"8k", "", "high"}, {"high", "original", "high"}, {"high", "", "unlimited"}} {
		if _, err := ResolveViewerQuality(c[0], c[1], c[2]); !errors.Is(err, ErrViewerQualityPreference) {
			t.Fatalf("accepted unapproved Viewer setting %q", c)
		}
	}
}

func TestViewerQualityCacheIdentityNoCollision(t *testing.T) {
	hash := strings.Repeat("a", 64)
	seenKeys, seenETags := map[string]bool{}, map[string]bool{}
	for _, preset := range []ViewerQualityPreset{ViewerQualityEconomy, ViewerQualityBalanced, ViewerQualityHigh} {
		for _, format := range []string{"webp", "jpeg"} {
			v, err := ViewerQualityVariantFor(preset, format)
			if err != nil { t.Fatal(err) }
			key, err := ViewerQualityStorageKey(12, 3, hash, v)
			if err != nil { t.Fatal(err) }
			etag, err := ViewerQualityETag(12, 3, hash, v)
			if err != nil { t.Fatal(err) }
			if !strings.HasPrefix(key, ThumbnailStoragePrefix) || !strings.Contains(key, hash) || seenKeys[key] || seenETags[etag] {
				t.Fatalf("unexpected cache collision: %q %q", key, etag)
			}
			seenKeys[key], seenETags[etag] = true, true
			if preset == ViewerQualityHigh {
				if key != ViewerPreviewStorageKey(12, 3, hash, format) ||
					etag != ViewerPreviewETag(12, 3, hash, format) {
					t.Fatal("existing 4K key or ETag changed")
				}
			} else if !strings.Contains(etag, ":v2") {
				t.Fatal("new preset reused legacy ETag")
			}
			revised, err := ViewerQualityStorageKey(12, 4, hash, v)
			if err != nil || revised == key { t.Fatal("source revision reused a stale cache key") }
		}
	}
	if len(seenKeys) != 6 || len(seenETags) != 6 { t.Fatal("expected six unique variants") }
	for _, format := range []string{"png", "JPEG", "../jpeg", ""} {
		if _, err := ViewerQualityVariantFor(ViewerQualityHigh, format); err == nil {
			t.Fatal("accepted unsupported format", format)
		}
	}
	v, _ := ViewerQualityVariantFor(ViewerQualityBalanced, "webp")
	v.Quality = 100
	if _, err := ViewerQualityStorageKey(12, 3, hash, v); err == nil {
		t.Fatal("arbitrary quality was allowed")
	}
	if _, err := ViewerQualityETag(12, 3, hash, v); err == nil {
		t.Fatal("invalid variant was allowed in ETag")
	}
}
