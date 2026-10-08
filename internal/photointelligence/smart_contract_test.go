package photointelligence

import (
	"strings"
	"testing"
)

func testSmartAnalyzerInfo() SmartAnalyzerInfo {
	model := FaceAnalyzerModelInfo{
		Name:    "test-model",
		Version: "v1",
		SHA256:  strings.Repeat("a", 64),
		License: "Apache-2.0",
	}
	return SmartAnalyzerInfo{
		ProtocolVersion: SmartAnalyzerProtocolVersion,
		Name:            "test-smart",
		PipelineVersion: "pipeline-v1",
		Classifier:      model,
		TextDetector:    model,
		TextRecognizer:  model,
		OCRLanguage:     "zh-en",
		Runtime: &FaceAnalyzerRuntimeInfo{
			Framework: "opencv_dnn",
			Version:   "test",
			Device:    "cpu",
		},
	}
}

func TestValidateSmartAnalyzerInfo(t *testing.T) {
	info := testSmartAnalyzerInfo()
	if err := ValidateSmartAnalyzerInfo(info); err != nil {
		t.Fatal(err)
	}
	if SmartVisualAnalyzerVersion(info) == SmartOCRAnalyzerVersion(info) {
		t.Fatal("visual and OCR analyzer versions must use distinct domains")
	}
}

func TestValidateSmartAnalysisResultNormalizesLabels(t *testing.T) {
	got, err := ValidateSmartAnalysisResult(SmartAnalysisResult{
		Labels: []SmartVisualLabel{
			{Index: 207, Label: " golden retriever ", Confidence: 0.8},
			{Index: 207, Label: "Golden Retriever", Confidence: 0.9},
			{Index: 978, Label: "beach", Confidence: 0.7},
		},
		OCRText:     "  上海 2026  ",
		OCRLanguage: "zh-en",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Labels) != 2 ||
		got.Labels[0].Index != 207 ||
		got.Labels[0].Label != "Golden Retriever" ||
		got.OCRText != "上海 2026" {
		t.Fatalf("result=%+v", got)
	}
}

func TestValidateSmartAnalysisResultRejectsOversizedOCR(t *testing.T) {
	_, err := ValidateSmartAnalysisResult(SmartAnalysisResult{
		OCRText: strings.Repeat("文", MaxSmartOCRRunes+1),
	})
	if err == nil {
		t.Fatal("oversized OCR text was accepted")
	}
}

func TestValidateSmartAnalysisResultRejectsInvalidLabelIndex(t *testing.T) {
	_, err := ValidateSmartAnalysisResult(SmartAnalysisResult{
		Labels: []SmartVisualLabel{
			{Index: 1000, Label: "invalid", Confidence: 0.8},
		},
	})
	if err == nil {
		t.Fatal("invalid visual label index was accepted")
	}
}
