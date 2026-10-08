package api

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
)

func creativeTestAsset() editableMediaAsset {
	return editableMediaAsset{
		Metadata: meta.MediaMetadata{MediaKind: meta.MediaKindImage},
		Asset:    meta.PhotoAsset{Kind: meta.PhotoAssetKindImage},
	}
}

func TestNormalizeMediaCreativeInput(t *testing.T) {
	value := creativeTestAsset()
	cutout, err := normalizeMediaCreativeInput(mediaCreativeInput{
		Kind:       meta.PhotoCreativeKindCutout,
		CutoutMode: "object",
		Points:     []photointelligence.CreativePoint{{X: 0.5, Y: 0.5, Foreground: true}},
	}, value)
	if err != nil || cutout.Kind != meta.PhotoCreativeKindCutout {
		t.Fatalf("cutout=%+v err=%v", cutout, err)
	}
	if _, err := normalizeMediaCreativeInput(mediaCreativeInput{
		Kind: meta.PhotoCreativeKindCutout, CutoutMode: "person",
	}, value); err == nil {
		t.Fatal("unsupported person cutout was accepted")
	}

	erase, err := normalizeMediaCreativeInput(mediaCreativeInput{
		Kind: meta.PhotoCreativeKindErase,
		Strokes: []photointelligence.CreativeStroke{{
			Radius: 0.03,
			Points: []photointelligence.CreativeStrokePoint{{X: 0.2, Y: 0.3}},
		}},
	}, value)
	if err != nil || erase.Kind != meta.PhotoCreativeKindErase {
		t.Fatalf("erase=%+v err=%v", erase, err)
	}
}

func TestCreativeOutputName(t *testing.T) {
	name, err := creativeOutputName("photo.heic", "", meta.PhotoCreativeKindCutout, "image/png")
	if err != nil || name != "photo-cutout.png" {
		t.Fatalf("name=%q err=%v", name, err)
	}
	name, err = creativeOutputName("photo.jpg", "", meta.PhotoCreativeKindErase, "image/jpeg")
	if err != nil || name != "photo-erase.jpg" {
		t.Fatalf("name=%q err=%v", name, err)
	}
}
