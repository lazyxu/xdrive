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
		Kind:          meta.PhotoCreativeKindCutout,
		CutoutMode:    "object",
		CutoutExpand:  0.02,
		CutoutFeather: 0.01,
		Points:        []photointelligence.CreativePoint{{X: 0.5, Y: 0.5, Foreground: true}},
	}, value)
	if err != nil ||
		cutout.Kind != meta.PhotoCreativeKindCutout ||
		cutout.CutoutExpand != 0.02 ||
		cutout.CutoutFeather != 0.01 {
		t.Fatalf("cutout=%+v err=%v", cutout, err)
	}
	if _, err := normalizeMediaCreativeInput(mediaCreativeInput{
		Kind:         meta.PhotoCreativeKindCutout,
		CutoutMode:   "object",
		CutoutExpand: 0.031,
		Points:       []photointelligence.CreativePoint{{X: 0.5, Y: 0.5, Foreground: true}},
	}, value); err == nil {
		t.Fatal("oversized cutout expansion was accepted")
	}
	if _, err := normalizeMediaCreativeInput(mediaCreativeInput{
		Kind:          meta.PhotoCreativeKindCutout,
		CutoutMode:    "object",
		CutoutFeather: 0.031,
		Points:        []photointelligence.CreativePoint{{X: 0.5, Y: 0.5, Foreground: true}},
	}, value); err == nil {
		t.Fatal("oversized cutout feather was accepted")
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
		MusicNodeID:     44,
		FrameDurationMS: 2000,
	}, value)
	if err != nil {
		t.Fatal(err)
	}
	if len(movie.SourceNodeIDs) != 3 ||
		movie.SourceNodeIDs[0] != 11 ||
		movie.MusicNodeID != 44 ||
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
	if _, err := normalizeMediaCreativeInput(mediaCreativeInput{
		Kind:          meta.PhotoCreativeKindCollage,
		SourceNodeIDs: []uint64{11, 22},
		MusicNodeID:   44,
	}, value); err == nil {
		t.Fatal("collage movie music was accepted")
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

// P1-2i: the actual Go creative job must reject corrupt Worker image bytes
// before the SQL/CAS commit can mark a photo as completed. MIME/dimensions
// alone do not prove decodeability of the new canonical media file.
func TestValidateMediaCreativeDecodedImage(t *testing.T) {
	good := photointelligence.CreativeResult{
		Data: testPNG(t, 3, 2), MIMEType: "image/png", Width: 3, Height: 2,
	}
	if err := validateMediaCreativeDecodedImage(good); err != nil {
		t.Fatalf("valid generated PNG rejected: %v", err)
	}
	cases := []struct {
		name   string
		result photointelligence.CreativeResult
	}{
		{"broken image", photointelligence.CreativeResult{
			Data: []byte("not-a-png"), MIMEType: "image/png", Width: 3, Height: 2,
		}},
		{"forged dimensions", photointelligence.CreativeResult{
			Data: good.Data, MIMEType: "image/png", Width: 4, Height: 2,
		}},
		{"forged MIME", photointelligence.CreativeResult{
			Data: good.Data, MIMEType: "image/jpeg", Width: 3, Height: 2,
		}},
		{"truncated image", photointelligence.CreativeResult{
			Data: good.Data[:len(good.Data)-8], MIMEType: "image/png", Width: 3, Height: 2,
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := validateMediaCreativeDecodedImage(tc.result); err == nil {
				t.Fatalf("unsafe Worker bytes accepted: %s", tc.name)
			}
		})
	}
}
