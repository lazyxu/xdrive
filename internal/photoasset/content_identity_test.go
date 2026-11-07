package photoasset

import (
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestPhotoContentIdentitySingleOriginal(t *testing.T) {
	sha := strings.Repeat("a", 64)
	id, err := IdentifyOriginals(meta.PhotoAssetKindImage, []OriginalResource{{Role: "primary", SHA256: strings.ToUpper(sha), Size: 20, Ordinal: 7}})
	if err != nil || id.Key != "sha256:"+sha || !ValidContentKey(id.Key) {
		t.Fatalf("original identity=%+v error=%v", id, err)
	}
	other, err := IdentifyOriginals(meta.PhotoAssetKindImage, []OriginalResource{{Role: "primary", SHA256: sha, Size: 20}})
	if err != nil || other != id {
		t.Fatalf("import traversal order changed single original identity: %+v %v", other, err)
	}
}

func TestPhotoContentIdentityCompleteBundle(t *testing.T) {
	still := OriginalResource{Role: "still", SHA256: strings.Repeat("a", 64), Size: 20}
	motion := OriginalResource{Role: "motion", SHA256: strings.Repeat("b", 64), Size: 40, Ordinal: 1}
	one, err := IdentifyOriginals(meta.PhotoAssetKindLivePhoto, []OriginalResource{still, motion})
	if err != nil || !ValidContentKey(one.Key) {
		t.Fatalf("Live identity=%+v error=%v", one, err)
	}
	// A separately paired file set and fully verified ZIP/LIVP members use
	// these same original digests, regardless of storage location/packaging.
	two, err := IdentifyOriginals(meta.PhotoAssetKindLivePhoto, []OriginalResource{motion, still})
	if err != nil || two != one {
		t.Fatalf("resource enumeration changed Live identity: %+v %v", two, err)
	}
	motion.SHA256 = strings.Repeat("c", 64)
	changed, err := IdentifyOriginals(meta.PhotoAssetKindLivePhoto, []OriginalResource{still, motion})
	if err != nil || changed.Key == one.Key {
		t.Fatalf("motion replacement reused old Live identity: %+v %v", changed, err)
	}
	still.Role = "primary"
	single, err := IdentifyOriginals(meta.PhotoAssetKindImage, []OriginalResource{still})
	if err != nil || single.Key == one.Key {
		t.Fatalf("Live and still were conflated: %+v %v", single, err)
	}
	for _, kind := range []string{meta.PhotoAssetKindRAWPair, meta.PhotoAssetKindSidecar} {
		roles := []string{"rendered", "raw"}
		if kind == meta.PhotoAssetKindSidecar {
			roles = []string{"primary", "sidecar"}
		}
		still.Role, motion.Role = roles[0], roles[1]
		id, err := IdentifyOriginals(kind, []OriginalResource{still, motion})
		if err != nil || id.Key == one.Key {
			t.Fatalf("%s identity=%+v error=%v", kind, id, err)
		}
	}
}

func TestPhotoContentIdentityRejectsUnverifiedResources(t *testing.T) {
	valid := OriginalResource{Role: "primary", SHA256: strings.Repeat("a", 64), Size: 20}
	for _, tc := range []struct {
		name, kind string
		resources  []OriginalResource
	}{
		{"missing", "image", nil},
		{"partial digest", "image", []OriginalResource{{Role: "primary", SHA256: "abc", Size: 20}}},
		{"missing size", "image", []OriginalResource{{Role: "primary", SHA256: valid.SHA256}}},
		{"negative ordinal", "image", []OriginalResource{{Role: "primary", SHA256: valid.SHA256, Size: 20, Ordinal: -1}}},
		{"missing motion", "live_photo", []OriginalResource{{Role: "still", SHA256: valid.SHA256, Size: 20}}},
		{"duplicate primary", "image", []OriginalResource{valid, valid}},
		{"container is not an original member", "live_photo", []OriginalResource{{Role: "container", SHA256: valid.SHA256, Size: 20}, {Role: "motion", SHA256: valid.SHA256, Size: 20}}},
		{"unknown kind", "unknown", []OriginalResource{valid}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := IdentifyOriginals(tc.kind, tc.resources); err == nil {
				t.Fatal("unverified original acquired a canonical identity")
			}
		})
	}
	for _, key := range []string{"", "node:1", "sha256:A" + strings.Repeat("a", 63), "sha256:" + strings.Repeat("z", 64), "photo-bundle:v2:sha256:" + valid.SHA256} {
		if ValidContentKey(key) {
			t.Errorf("invalid canonical key accepted: %q", key)
		}
	}
}

func TestPhotoContentIdentityPreservesBurstOrder(t *testing.T) {
	a := OriginalResource{Role: "primary", SHA256: strings.Repeat("a", 64), Size: 20}
	b := OriginalResource{Role: "auxiliary", SHA256: strings.Repeat("b", 64), Size: 20, Ordinal: 1}
	one, err := IdentifyOriginals(meta.PhotoAssetKindBurst, []OriginalResource{a, b})
	if err != nil {
		t.Fatal(err)
	}
	a.Ordinal, b.Ordinal = 1, 0
	two, err := IdentifyOriginals(meta.PhotoAssetKindBurst, []OriginalResource{a, b})
	if err != nil || one.Key == two.Key {
		t.Fatalf("changed burst order reused identity: %+v %v", two, err)
	}
	b.Ordinal = a.Ordinal
	if _, err := IdentifyOriginals(meta.PhotoAssetKindBurst, []OriginalResource{a, b}); err == nil {
		t.Fatal("ambiguous burst order accepted")
	}
}
