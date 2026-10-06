package photointelligence

import (
	"encoding/binary"
	"math"
	"strings"
	"testing"
)

func testFaceAnalyzerInfo() FaceAnalyzerInfo {
	return FaceAnalyzerInfo{
		ProtocolVersion: FaceAnalyzerProtocolVersion,
		Name:            "test-face-analyzer",
		PipelineVersion: "pipeline-v1",
		Detector: FaceAnalyzerModelInfo{
			Name:    "YuNet",
			Version: "2023mar",
			SHA256:  strings.Repeat("a", 64),
			License: "MIT",
		},
		Embedding: FaceAnalyzerModelInfo{
			Name:    "SFace",
			Version: "2021dec",
			SHA256:  strings.Repeat("b", 64),
			License: "Apache-2.0",
		},
		EmbeddingFormat:     "f32le",
		EmbeddingDimensions: 512,
		Runtime: &FaceAnalyzerRuntimeInfo{
			Framework: "opencv_dnn",
			Version:   "4.14.0",
			Device:    "cpu",
		},
	}
}

func testEmbedding(dimensions int) []byte {
	out := make([]byte, dimensions*4)
	for index := 0; index < dimensions; index++ {
		binary.LittleEndian.PutUint32(
			out[index*4:(index+1)*4],
			math.Float32bits(float32(index+1)/float32(dimensions)),
		)
	}
	return out
}

func TestValidateFaceAnalyzerInfo(t *testing.T) {
	info := testFaceAnalyzerInfo()
	if err := ValidateFaceAnalyzerInfo(info); err != nil {
		t.Fatal(err)
	}
	bad := info
	bad.PipelineVersion = ""
	if err := ValidateFaceAnalyzerInfo(bad); err == nil {
		t.Fatal("missing pipeline version was accepted")
	}
	bad = info
	bad.Detector.License = ""
	if err := ValidateFaceAnalyzerInfo(bad); err == nil {
		t.Fatal("missing detector license was accepted")
	}
	bad = info
	bad.Embedding.SHA256 = "short"
	if err := ValidateFaceAnalyzerInfo(bad); err == nil {
		t.Fatal("invalid embedding hash was accepted")
	}
	bad = info
	bad.EmbeddingFormat = "unknown"
	if err := ValidateFaceAnalyzerInfo(bad); err == nil {
		t.Fatal("unknown embedding format was accepted")
	}
	bad = info
	bad.EmbeddingDimensions = 0
	if err := ValidateFaceAnalyzerInfo(bad); err == nil {
		t.Fatal("invalid embedding dimensions were accepted")
	}
	bad = info
	bad.Runtime = &FaceAnalyzerRuntimeInfo{Device: "cpu"}
	if err := ValidateFaceAnalyzerInfo(bad); err == nil {
		t.Fatal("runtime without framework was accepted")
	}
	bad = info
	bad.Runtime = &FaceAnalyzerRuntimeInfo{Framework: "opencv_dnn"}
	if err := ValidateFaceAnalyzerInfo(bad); err == nil {
		t.Fatal("runtime without device was accepted")
	}
}

func TestValidateFaceAnalysisTask(t *testing.T) {
	task := FaceAnalysisTask{
		PreviewURL:       "http://server:8080/api/v1/media-analysis-preview/42?ticket=abc",
		PreviewVersion:   1,
		PreviewEdge:      1280,
		InputFingerprint: "media-analysis-test-v1-1280",
	}
	if err := ValidateFaceAnalysisTask(task); err != nil {
		t.Fatal(err)
	}
	bad := task
	bad.PreviewURL = "file:///data/photo.jpg"
	if err := ValidateFaceAnalysisTask(bad); err == nil {
		t.Fatal("non-http preview URL was accepted")
	}
	bad = task
	bad.PreviewURL = "http://user:pass@server:8080/preview"
	if err := ValidateFaceAnalysisTask(bad); err == nil {
		t.Fatal("preview URL with userinfo was accepted")
	}
	bad = task
	bad.InputFingerprint = ""
	if err := ValidateFaceAnalysisTask(bad); err == nil {
		t.Fatal("empty input fingerprint was accepted")
	}
}

func TestValidateFaceObservationsSortsAndRejectsInvalidResults(t *testing.T) {
	info := testFaceAnalyzerInfo()
	embedding := testEmbedding(info.EmbeddingDimensions)
	faces := []FaceObservation{
		{
			Box: NormalizedBox{
				X: 0.5, Y: 0.5, Width: 0.2, Height: 0.2,
			},
			Landmarks: []NormalizedPoint{
				{X: 0.55, Y: 0.56},
				{X: 0.63, Y: 0.56},
				{X: 0.59, Y: 0.61},
				{X: 0.56, Y: 0.66},
				{X: 0.63, Y: 0.66},
			},
			Confidence: 0.91,
			Embedding:  append([]byte(nil), embedding...),
		},
		{
			Box: NormalizedBox{
				X: 0.1, Y: 0.1, Width: 0.2, Height: 0.2,
			},
			Landmarks: []NormalizedPoint{
				{X: 0.15, Y: 0.16},
				{X: 0.23, Y: 0.16},
				{X: 0.19, Y: 0.21},
				{X: 0.16, Y: 0.26},
				{X: 0.23, Y: 0.26},
			},
			Confidence: 0.99,
			Embedding:  append([]byte(nil), embedding...),
		},
	}
	got, err := ValidateFaceObservations(info, faces)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Box.X != 0.1 || got[1].Box.X != 0.5 {
		t.Fatalf("faces were not deterministically sorted: %+v", got)
	}

	bad := faces[0]
	bad.Box.Width = 0.6
	if _, err := ValidateFaceObservations(info, []FaceObservation{bad}); err == nil {
		t.Fatal("out-of-bounds face box was accepted")
	}
	bad = faces[0]
	bad.Landmarks = bad.Landmarks[:4]
	if _, err := ValidateFaceObservations(info, []FaceObservation{bad}); err == nil {
		t.Fatal("missing face landmark was accepted")
	}
	bad = faces[0]
	bad.Embedding = bad.Embedding[:len(bad.Embedding)-4]
	if _, err := ValidateFaceObservations(info, []FaceObservation{bad}); err == nil {
		t.Fatal("wrong embedding dimensions were accepted")
	}
	bad = faces[0]
	binary.LittleEndian.PutUint32(bad.Embedding[:4], math.Float32bits(float32(math.Inf(1))))
	if _, err := ValidateFaceObservations(info, []FaceObservation{bad}); err == nil {
		t.Fatal("non-finite embedding value was accepted")
	}
}

func TestFaceAnalyzerVersionsTrackModelIdentityWithinSchemaLimit(t *testing.T) {
	info := testFaceAnalyzerInfo()
	detector := FaceDetectorAnalyzerVersion(info)
	embedding := FaceEmbeddingAnalyzerVersion(info)
	if !strings.HasPrefix(detector, "face-det:v1:") ||
		!strings.HasPrefix(embedding, "face-embed:v1:") {
		t.Fatalf(
			"unexpected versions detector=%q embedding=%q",
			detector,
			embedding,
		)
	}
	if len(detector) > 100 || len(embedding) > 100 {
		t.Fatalf(
			"version token is unexpectedly long: detector=%d embedding=%d",
			len(detector),
			len(embedding),
		)
	}

	changedDetector := info
	changedDetector.Detector.SHA256 = strings.Repeat("c", 64)
	if FaceDetectorAnalyzerVersion(changedDetector) == detector {
		t.Fatal("detector version did not change with model hash")
	}
	if FaceEmbeddingAnalyzerVersion(changedDetector) == embedding {
		t.Fatal("embedding version did not change with detector hash")
	}

	changedEmbedding := info
	changedEmbedding.EmbeddingDimensions = 256
	if FaceEmbeddingAnalyzerVersion(changedEmbedding) == embedding {
		t.Fatal("embedding version did not change with dimensions")
	}

	changedPipeline := info
	changedPipeline.PipelineVersion = "pipeline-v2"
	if FaceDetectorAnalyzerVersion(changedPipeline) == detector {
		t.Fatal("detector version did not change with pipeline version")
	}
	if FaceEmbeddingAnalyzerVersion(changedPipeline) == embedding {
		t.Fatal("embedding version did not change with pipeline version")
	}
}
