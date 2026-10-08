package api

import (
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
)

func testEditableMediaAsset(kind string, durationMS int64) editableMediaAsset {
	return editableMediaAsset{
		Node: meta.Node{
			ID:       42,
			OwnerID:  7,
			Revision: 3,
			File: &meta.File{
				NodeID: 42,
				SHA256: strings.Repeat("a", 64),
			},
		},
		Metadata: meta.MediaMetadata{
			NodeID:     42,
			OwnerID:    7,
			MediaKind:  kind,
			DurationMS: durationMS,
		},
		Asset: meta.PhotoAsset{
			ID:            11,
			OwnerID:       7,
			PrimaryNodeID: 42,
			Kind:          kind,
		},
	}
}

func TestNormalizeMediaEditRecipeImage(t *testing.T) {
	value := testEditableMediaAsset(meta.MediaKindImage, 0)
	got, err := normalizeMediaEditRecipe(mediaEditRecipeInput{
		RotationDegrees: 90,
		FlipHorizontal:  true,
		CropX:           0.1,
		CropY:           0.2,
		CropWidth:       0.8,
		CropHeight:      0.7,
		ExposureEV:      0.5,
		Contrast:        -0.2,
		Saturation:      0.3,
	}, value)
	if err != nil {
		t.Fatal(err)
	}
	if got.RotationDegrees != 90 ||
		got.CropWidth != 0.8 ||
		got.CropHeight != 0.7 ||
		!got.FlipHorizontal {
		t.Fatalf("normalized=%+v", got)
	}

	got, err = normalizeMediaEditRecipe(mediaEditRecipeInput{}, value)
	if err != nil {
		t.Fatal(err)
	}
	if got.CropWidth != 1 || got.CropHeight != 1 {
		t.Fatalf("default crop=%+v", got)
	}
	if _, err := normalizeMediaEditRecipe(
		mediaEditRecipeInput{
			CropWidth: 1, CropHeight: 1,
			TrimEndMS: 1000,
		},
		value,
	); err == nil {
		t.Fatal("image trim was accepted")
	}
}

func TestNormalizeMediaEditRecipeVideo(t *testing.T) {
	value := testEditableMediaAsset(meta.MediaKindVideo, 10_000)
	got, err := normalizeMediaEditRecipe(mediaEditRecipeInput{
		RotationDegrees: 270,
		FlipVertical:    true,
		TrimStartMS:     1000,
		TrimEndMS:       9000,
	}, value)
	if err != nil {
		t.Fatal(err)
	}
	if got.TrimStartMS != 1000 || got.TrimEndMS != 9000 || !got.FlipVertical {
		t.Fatalf("normalized=%+v", got)
	}

	for name, input := range map[string]mediaEditRecipeInput{
		"crop": {
			CropX: 0.1, CropWidth: 0.9, CropHeight: 1,
		},
		"color": {
			CropWidth: 1, CropHeight: 1, ExposureEV: 0.5,
		},
		"reverse trim": {
			CropWidth: 1, CropHeight: 1, TrimStartMS: 9000, TrimEndMS: 1000,
		},
		"past duration": {
			CropWidth: 1, CropHeight: 1, TrimEndMS: 11_000,
		},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := normalizeMediaEditRecipe(input, value); err == nil {
				t.Fatalf("invalid video edit accepted: %+v", input)
			}
		})
	}
}

func TestMediaEditRecipeRevisionAllowsStaleSourceRebuild(t *testing.T) {
	value := testEditableMediaAsset(meta.MediaKindImage, 0)
	current := meta.PhotoEditRecipe{
		AssetID:            value.Asset.ID,
		OwnerID:            value.Node.OwnerID,
		Revision:           4,
		SourceNodeID:       value.Node.ID,
		SourceNodeRevision: value.Node.Revision,
		SourceSHA256:       value.Node.File.SHA256,
		CreatedAt:          time.Now().UTC(),
		UpdatedAt:          time.Now().UTC(),
	}
	if !mediaEditRecipeSourceCurrent(current, value) {
		t.Fatal("current recipe was considered stale")
	}
	if mediaEditRecipeRevisionAccepted(current, value, 0) {
		t.Fatal("revision 0 overwrote a current recipe")
	}
	if !mediaEditRecipeRevisionAccepted(current, value, 4) {
		t.Fatal("matching revision was rejected")
	}

	staleValue := value
	staleValue.Node.Revision++
	staleValue.Node.File = &meta.File{
		NodeID: value.Node.ID,
		SHA256: strings.Repeat("b", 64),
	}
	if mediaEditRecipeSourceCurrent(current, staleValue) {
		t.Fatal("stale source fingerprint was considered current")
	}
	if !mediaEditRecipeRevisionAccepted(current, staleValue, 0) {
		t.Fatal("revision 0 could not rebuild a stale recipe")
	}
	if mediaEditRecipeRevisionAccepted(current, staleValue, 3) {
		t.Fatal("unrelated stale revision was accepted")
	}
}

func TestNormalizeMediaEditRecipeRejectsInvalidNumbers(t *testing.T) {
	value := testEditableMediaAsset(meta.MediaKindImage, 0)
	for name, input := range map[string]mediaEditRecipeInput{
		"rotation":      {RotationDegrees: 45, CropWidth: 1, CropHeight: 1},
		"small crop":    {CropWidth: 0.01, CropHeight: 1},
		"crop overflow": {CropX: 0.5, CropWidth: 0.6, CropHeight: 1},
		"exposure":      {CropWidth: 1, CropHeight: 1, ExposureEV: 2.1},
		"contrast":      {CropWidth: 1, CropHeight: 1, Contrast: -1.1},
		"saturation":    {CropWidth: 1, CropHeight: 1, Saturation: 1.1},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := normalizeMediaEditRecipe(input, value); err == nil {
				t.Fatalf("invalid edit accepted: %+v", input)
			}
		})
	}
}
