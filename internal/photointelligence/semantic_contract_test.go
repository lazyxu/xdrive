package photointelligence

import (
	"strings"
	"testing"
)

func testSemanticAnalyzerInfo() SemanticAnalyzerInfo {
	model := FaceAnalyzerModelInfo{
		Name:    "siglip2",
		Version: "v1",
		SHA256:  strings.Repeat("a", 64),
		License: "Apache-2.0",
	}
	return SemanticAnalyzerInfo{
		ProtocolVersion:     SemanticAnalyzerProtocolVersion,
		Name:                "test-semantic",
		PipelineVersion:     "semantic-v1",
		VisionModel:         model,
		TextModel:           model,
		TokenizerSHA256:     strings.Repeat("b", 64),
		EmbeddingFormat:     SemanticEmbeddingFormatI8Norm,
		EmbeddingDimensions: 768,
		Runtime: &FaceAnalyzerRuntimeInfo{
			Framework: "onnxruntime",
			Version:   "test",
			Device:    "cpu",
		},
	}
}

func TestValidateSemanticAnalyzerInfo(t *testing.T) {
	info := testSemanticAnalyzerInfo()
	if err := ValidateSemanticAnalyzerInfo(info); err != nil {
		t.Fatal(err)
	}
	if SemanticAnalyzerVersion(info) == "" {
		t.Fatal("semantic analyzer version is empty")
	}
}

func TestValidateSemanticEmbedding(t *testing.T) {
	info := testSemanticAnalyzerInfo()
	raw := make([]byte, info.EmbeddingDimensions)
	raw[0] = 12
	got, err := ValidateSemanticEmbedding(info, SemanticEmbedding{
		Embedding:  raw,
		Format:     SemanticEmbeddingFormatI8Norm,
		Dimensions: info.EmbeddingDimensions,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Embedding) != info.EmbeddingDimensions {
		t.Fatalf("embedding bytes=%d", len(got.Embedding))
	}
}

func TestNormalizeSemanticSearchText(t *testing.T) {
	got, err := NormalizeSemanticSearchText("  海边的狗  ")
	if err != nil {
		t.Fatal(err)
	}
	if got != "海边的狗" {
		t.Fatalf("text=%q", got)
	}
	if _, err := NormalizeSemanticSearchText(
		strings.Repeat("x", MaxSemanticSearchRunes+1),
	); err == nil {
		t.Fatal("oversized semantic search was accepted")
	}
}
