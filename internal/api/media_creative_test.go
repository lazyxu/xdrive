package api

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
)

func creativeTestAsset() editableMediaAsset {
	return editableMediaAsset{
		Node:     meta.Node{ID: 11},
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

	movie, err := normalizeMediaCreativeInput(mediaCreativeInput{
		Kind:            meta.PhotoCreativeKindMovie,
		SourceNodeIDs:   []uint64{11, 22, 33},
		FrameDurationMS: 2000,
	}, value)
	if err != nil {
		t.Fatal(err)
	}
	if len(movie.SourceNodeIDs) != 3 ||
		movie.SourceNodeIDs[0] != 11 ||
		movie.MovieTemplate != photointelligence.CreativeMovieTemplateClassic ||
		movie.TransitionMS == nil ||
		*movie.TransitionMS != 350 {
		t.Fatalf("movie=%+v", movie)
	}
	if _, err := normalizeMediaCreativeInput(mediaCreativeInput{
		Kind:          meta.PhotoCreativeKindMovie,
		SourceNodeIDs: []uint64{11},
	}, value); err == nil {
		t.Fatal("one-frame movie was accepted")
	}
	if _, err := normalizeMediaCreativeInput(mediaCreativeInput{
		Kind:          meta.PhotoCreativeKindMovie,
		SourceNodeIDs: []uint64{11, 22},
		MovieTemplate: "freeform",
	}, value); err == nil {
		t.Fatal("unsupported movie template was accepted")
	}

	collage, err := normalizeMediaCreativeInput(mediaCreativeInput{
		Kind:          meta.PhotoCreativeKindCollage,
		SourceNodeIDs: []uint64{11, 22, 33},
	}, value)
	if err != nil {
		t.Fatal(err)
	}
	if len(collage.SourceNodeIDs) != 3 ||
		collage.CollageTemplate != photointelligence.CreativeCollageTemplateGrid {
		t.Fatalf("collage=%+v", collage)
	}
	if _, err := normalizeMediaCreativeInput(mediaCreativeInput{
		Kind:            meta.PhotoCreativeKindCollage,
		SourceNodeIDs:   []uint64{11, 22},
		CollageTemplate: "freeform",
	}, value); err == nil {
		t.Fatal("unsupported collage template was accepted")
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
	name, err = creativeOutputName("photo.jpg", "", meta.PhotoCreativeKindMovie, "video/mp4")
	if err != nil || name != "photo-movie.mp4" {
		t.Fatalf("movie name=%q err=%v", name, err)
	}
	name, err = creativeOutputName("photo.jpg", "", meta.PhotoCreativeKindCollage, "image/jpeg")
	if err != nil || name != "photo-collage.jpg" {
		t.Fatalf("collage name=%q err=%v", name, err)
	}
	if mediaCreativeRunTimeoutFor(meta.PhotoCreativeKindMovie) != mediaCreativeMovieRunTimeout {
		t.Fatal("movie timeout mismatch")
	}
}
