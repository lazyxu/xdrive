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
		Capabilities: []string{CreativeCapabilityCutout, CreativeCapabilityErase},
		Runtime:      &FaceAnalyzerRuntimeInfo{Framework: "opencv_dnn", Device: "cpu"},
	}
}

func TestValidateCreativeAnalyzerInfo(t *testing.T) {
	info := testCreativeInfo()
	if err := ValidateCreativeAnalyzerInfo(info); err != nil {
		t.Fatal(err)
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
	erase.Strokes[0].Radius = 0.5
	if err := ValidateCreativeTask(erase); err == nil {
		t.Fatal("oversized erase brush was accepted")
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
}
