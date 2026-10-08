package photointelligence

import (
	"strings"
	"testing"
)

func testCreativeInfo() CreativeAnalyzerInfo {
	return CreativeAnalyzerInfo{
		ProtocolVersion: CreativeAnalyzerProtocolVersion,
		Name:            "xdrive-opencv-efficientsam",
		PipelineVersion: "creative-v1",
		SegmentModel: FaceAnalyzerModelInfo{
			Name: "EfficientSAM-Ti", Version: "2025april-int8",
			SHA256: strings.Repeat("a", 64), License: "Apache-2.0",
		},
		Capabilities: []string{
			CreativeCapabilityCutout,
			CreativeCapabilityCutoutRefine,
			CreativeCapabilityErase,
			CreativeCapabilityMovie,
			CreativeCapabilityMovieTemplate,
			CreativeCapabilityMovieMusic,
			CreativeCapabilityCollage,
		},
		Runtime: &FaceAnalyzerRuntimeInfo{Framework: "opencv_dnn", Device: "cpu"},
	}
}

func TestValidateCreativeAnalyzerInfo(t *testing.T) {
	info := testCreativeInfo()
	if err := ValidateCreativeAnalyzerInfo(info); err != nil {
		t.Fatal(err)
	}
	info.Capabilities = []string{
		CreativeCapabilityCutout,
		CreativeCapabilityErase,
	}
	if err := ValidateCreativeAnalyzerInfo(info); err != nil {
		t.Fatalf("legacy cutout/erase analyzer was rejected: %v", err)
	}
	if CreativeAnalyzerSupports(info, CreativeCapabilityCutoutRefine) {
		t.Fatal("legacy analyzer unexpectedly reports cutout-refine support")
	}
	if CreativeAnalyzerSupports(info, CreativeCapabilityMovie) {
		t.Fatal("legacy analyzer unexpectedly reports movie support")
	}
	if CreativeAnalyzerSupports(info, CreativeCapabilityMovieTemplate) {
		t.Fatal("legacy analyzer unexpectedly reports movie-template support")
	}
	if CreativeAnalyzerSupports(info, CreativeCapabilityMovieMusic) {
		t.Fatal("legacy analyzer unexpectedly reports movie-music support")
	}
	if CreativeAnalyzerSupports(info, CreativeCapabilityCollage) {
		t.Fatal("legacy analyzer unexpectedly reports collage support")
	}
	info.Capabilities = []string{CreativeCapabilityCutout}
	if err := ValidateCreativeAnalyzerInfo(info); err == nil {
		t.Fatal("creative analyzer without erase capability was accepted")
	}
}

func TestValidateCreativeTask(t *testing.T) {
	base := CreativeTask{
		PreviewURL:     "http://server:8080/api/v1/media-creative-preview/42?ticket=abc",
		PreviewVersion: 1, PreviewEdge: 2048, InputFingerprint: "creative-test",
	}
	cutout := base
	cutout.Kind = CreativeCapabilityCutout
	cutout.CutoutMode = "object"
	cutout.Points = []CreativePoint{
		{X: 0.5, Y: 0.5, Foreground: true},
		{X: 0.1, Y: 0.1, Foreground: false},
	}
	if err := ValidateCreativeTask(cutout); err != nil {
		t.Fatal(err)
	}
	cutout.CutoutExpand = 0.02
	cutout.CutoutFeather = 0.01
	if err := ValidateCreativeTask(cutout); err != nil {
		t.Fatalf("cutout refinement was rejected: %v", err)
	}
	cutout.CutoutExpand = 0.031
	if err := ValidateCreativeTask(cutout); err == nil {
		t.Fatal("oversized cutout expansion was accepted")
	}
	cutout.CutoutExpand = 0
	cutout.CutoutFeather = 0.031
	if err := ValidateCreativeTask(cutout); err == nil {
		t.Fatal("oversized cutout feather was accepted")
	}
	cutout.CutoutFeather = 0
	person := cutout
	person.CutoutMode = "person"
	person.Points = nil
	if err := ValidateCreativeTask(person); err == nil {
		t.Fatal("unsupported person cutout was accepted")
	}

	erase := base
	erase.Kind = CreativeCapabilityErase
	erase.Strokes = []CreativeStroke{{
		Radius: 0.03,
		Points: []CreativeStrokePoint{{X: 0.3, Y: 0.4}, {X: 0.4, Y: 0.45}},
	}}
	if err := ValidateCreativeTask(erase); err != nil {
		t.Fatal(err)
	}
	erase.CutoutExpand = 0.01
	if err := ValidateCreativeTask(erase); err == nil {
		t.Fatal("erase cutout refinement was accepted")
	}
	erase.CutoutExpand = 0
	erase.Strokes[0].Radius = 0.5
	if err := ValidateCreativeTask(erase); err == nil {
		t.Fatal("oversized erase brush was accepted")
	}

	movie := base
	movie.Kind = CreativeCapabilityMovie
	movie.MovieFrames = []CreativeMovieFrame{
		{
			PreviewURL:     "http://server:8080/api/v1/media-creative-preview/42?ticket=a",
			PreviewVersion: 1, PreviewEdge: 2048, InputFingerprint: "movie-a",
		},
		{
			PreviewURL:     "http://server:8080/api/v1/media-creative-preview/43?ticket=b",
			PreviewVersion: 1, PreviewEdge: 2048, InputFingerprint: "movie-b",
		},
	}
	movie.FrameDurationMS = 2000
	movie.TransitionMS = 350
	if err := ValidateCreativeTask(movie); err != nil {
		t.Fatal(err)
	}
	movie.TransitionMS = 2000
	if err := ValidateCreativeTask(movie); err == nil {
		t.Fatal("movie transition equal to frame duration was accepted")
	}
	movie.TransitionMS = 350
	movie.MovieTemplate = CreativeMovieTemplateFill
	if err := ValidateCreativeTask(movie); err != nil {
		t.Fatalf("fill movie template was rejected: %v", err)
	}
	movie.MovieTemplate = "freeform"
	if err := ValidateCreativeTask(movie); err == nil {
		t.Fatal("unsupported movie template was accepted")
	}
	movie.MovieTemplate = CreativeMovieTemplateClassic
	movie.MusicURL = "http://server:8080/api/v1/file-preview/99?ticket=music"
	movie.MusicFingerprint = strings.Repeat("b", 64)
	if err := ValidateCreativeTask(movie); err != nil {
		t.Fatalf("movie music contract was rejected: %v", err)
	}
	movie.MusicFingerprint = "bad"
	if err := ValidateCreativeTask(movie); err == nil {
		t.Fatal("invalid movie music fingerprint was accepted")
	}
	movie.MusicURL = ""
	movie.MusicFingerprint = ""

	collage := base
	collage.Kind = CreativeCapabilityCollage
	collage.CollageTemplate = CreativeCollageTemplateGrid
	collage.CollageImages = []CreativeMovieFrame{
		{
			PreviewURL:     "http://server:8080/api/v1/media-creative-preview/42?ticket=a",
			PreviewVersion: 1, PreviewEdge: 2048, InputFingerprint: "collage-a",
		},
		{
			PreviewURL:     "http://server:8080/api/v1/media-creative-preview/43?ticket=b",
			PreviewVersion: 1, PreviewEdge: 2048, InputFingerprint: "collage-b",
		},
	}
	if err := ValidateCreativeTask(collage); err != nil {
		t.Fatal(err)
	}
	collage.CollageTemplate = "freeform"
	if err := ValidateCreativeTask(collage); err == nil {
		t.Fatal("unsupported collage template was accepted")
	}
}

func TestValidateCreativeResult(t *testing.T) {
	raw := []byte{1, 2, 3}
	result, err := ValidateCreativeResult(CreativeResult{
		Data: raw, MIMEType: "IMAGE/PNG", Width: 64, Height: 32,
	})
	if err != nil {
		t.Fatal(err)
	}
	raw[0] = 9
	if result.Data[0] != 1 || result.MIMEType != "image/png" {
		t.Fatalf("result=%+v", result)
	}
	movie, err := ValidateCreativeResult(CreativeResult{
		Data:     []byte{0, 0, 0, 24, 'f', 't', 'y', 'p'},
		MIMEType: "video/mp4", Width: 1920, Height: 1080,
	})
	if err != nil || movie.MIMEType != "video/mp4" {
		t.Fatalf("movie=%+v err=%v", movie, err)
	}
}
