package photointelligence

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"sort"
	"strings"
)

const FaceAnalyzerProtocolVersion = 1
const MaxFacesPerImage = 256
const MaxFaceEmbeddingBytes = 16 << 10

type FaceAnalyzer interface {
	Info(context.Context) (FaceAnalyzerInfo, error)
	Analyze(context.Context, FaceAnalysisTask) ([]FaceObservation, error)
}

type FaceAnalyzerModelInfo struct {
	Name       string `json:"name"`
	Version    string `json:"version"`
	SHA256     string `json:"sha256"`
	License    string `json:"license"`
	LicenseURL string `json:"license_url,omitempty"`
}

type FaceAnalyzerInfo struct {
	ProtocolVersion     int                   `json:"protocol_version"`
	Name                string                `json:"name"`
	PipelineVersion     string                `json:"pipeline_version"`
	Detector            FaceAnalyzerModelInfo `json:"detector"`
	Embedding           FaceAnalyzerModelInfo `json:"embedding"`
	EmbeddingFormat     string                `json:"embedding_format"`
	EmbeddingDimensions int                   `json:"embedding_dimensions"`
}

type FaceAnalysisTask struct {
	PreviewURL       string `json:"preview_url"`
	PreviewVersion   int    `json:"preview_version"`
	PreviewEdge      int    `json:"preview_edge"`
	InputFingerprint string `json:"input_fingerprint"`
}

type NormalizedPoint struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type NormalizedBox struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type FaceObservation struct {
	Box        NormalizedBox     `json:"box"`
	Landmarks  []NormalizedPoint `json:"landmarks"`
	Confidence float64           `json:"confidence"`
	Embedding  []byte            `json:"embedding"`
}

func ValidateFaceAnalyzerInfo(info FaceAnalyzerInfo) error {
	if info.ProtocolVersion != FaceAnalyzerProtocolVersion {
		return fmt.Errorf(
			"unsupported face analyzer protocol version %d",
			info.ProtocolVersion,
		)
	}
	if strings.TrimSpace(info.Name) == "" {
		return errors.New("face analyzer name is required")
	}
	if strings.TrimSpace(info.PipelineVersion) == "" {
		return errors.New("face analyzer pipeline version is required")
	}
	if err := validateFaceModelInfo("detector", info.Detector); err != nil {
		return err
	}
	if err := validateFaceModelInfo("embedding", info.Embedding); err != nil {
		return err
	}
	switch strings.ToLower(strings.TrimSpace(info.EmbeddingFormat)) {
	case "f32le":
	default:
		return fmt.Errorf(
			"unsupported face embedding format %q",
			info.EmbeddingFormat,
		)
	}
	if info.EmbeddingDimensions < 1 || info.EmbeddingDimensions > 4096 {
		return fmt.Errorf(
			"face embedding dimensions %d are invalid",
			info.EmbeddingDimensions,
		)
	}
	return nil
}

func validateFaceModelInfo(kind string, info FaceAnalyzerModelInfo) error {
	if strings.TrimSpace(info.Name) == "" {
		return fmt.Errorf("%s model name is required", kind)
	}
	if strings.TrimSpace(info.Version) == "" {
		return fmt.Errorf("%s model version is required", kind)
	}
	hash := strings.ToLower(strings.TrimSpace(info.SHA256))
	if len(hash) != 64 {
		return fmt.Errorf("%s model sha256 is invalid", kind)
	}
	if _, err := hex.DecodeString(hash); err != nil {
		return fmt.Errorf("%s model sha256 is invalid", kind)
	}
	if strings.TrimSpace(info.License) == "" {
		return fmt.Errorf("%s model license is required", kind)
	}
	return nil
}

func ValidateFaceAnalysisTask(task FaceAnalysisTask) error {
	rawURL := strings.TrimSpace(task.PreviewURL)
	if rawURL == "" {
		return errors.New("face analysis preview URL is required")
	}
	parsed, err := url.Parse(rawURL)
	if err != nil ||
		(parsed.Scheme != "http" && parsed.Scheme != "https") ||
		parsed.Host == "" ||
		parsed.User != nil ||
		parsed.Fragment != "" {
		return errors.New("face analysis preview URL is invalid")
	}
	if task.PreviewVersion <= 0 {
		return errors.New("face analysis preview version is invalid")
	}
	if task.PreviewEdge <= 0 || task.PreviewEdge > 4096 {
		return errors.New("face analysis preview edge is invalid")
	}
	fingerprint := strings.TrimSpace(task.InputFingerprint)
	if fingerprint == "" || len(fingerprint) > 128 {
		return errors.New("face analysis input fingerprint is invalid")
	}
	return nil
}

func FaceDetectorAnalyzerVersion(info FaceAnalyzerInfo) string {
	return faceAnalyzerVersionToken(
		"face-det",
		[]string{
			strings.TrimSpace(info.Name),
			strings.TrimSpace(info.PipelineVersion),
			strings.TrimSpace(info.Detector.Name),
			strings.TrimSpace(info.Detector.Version),
			strings.ToLower(strings.TrimSpace(info.Detector.SHA256)),
		},
	)
}

func FaceEmbeddingAnalyzerVersion(info FaceAnalyzerInfo) string {
	return faceAnalyzerVersionToken(
		"face-embed",
		[]string{
			strings.TrimSpace(info.Name),
			strings.TrimSpace(info.PipelineVersion),
			strings.ToLower(strings.TrimSpace(info.Detector.SHA256)),
			strings.TrimSpace(info.Embedding.Name),
			strings.TrimSpace(info.Embedding.Version),
			strings.ToLower(strings.TrimSpace(info.Embedding.SHA256)),
			strings.ToLower(strings.TrimSpace(info.EmbeddingFormat)),
			fmt.Sprintf("%d", info.EmbeddingDimensions),
		},
	)
}

func faceAnalyzerVersionToken(prefix string, values []string) string {
	sum := sha256.Sum256([]byte(strings.Join(values, "\n")))
	return prefix + ":v1:" + hex.EncodeToString(sum[:])
}

func ValidateFaceObservations(
	info FaceAnalyzerInfo,
	faces []FaceObservation,
) ([]FaceObservation, error) {
	if err := ValidateFaceAnalyzerInfo(info); err != nil {
		return nil, err
	}
	if len(faces) > MaxFacesPerImage {
		return nil, fmt.Errorf(
			"face analyzer returned %d faces; maximum is %d",
			len(faces),
			MaxFacesPerImage,
		)
	}
	out := append([]FaceObservation(nil), faces...)
	for index := range out {
		if err := validateFaceObservation(info, out[index]); err != nil {
			return nil, fmt.Errorf("face %d: %w", index, err)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Box.Y != out[j].Box.Y {
			return out[i].Box.Y < out[j].Box.Y
		}
		if out[i].Box.X != out[j].Box.X {
			return out[i].Box.X < out[j].Box.X
		}
		if out[i].Box.Height != out[j].Box.Height {
			return out[i].Box.Height > out[j].Box.Height
		}
		return out[i].Box.Width > out[j].Box.Width
	})
	return out, nil
}

func validateFaceObservation(
	info FaceAnalyzerInfo,
	face FaceObservation,
) error {
	values := []float64{
		face.Box.X,
		face.Box.Y,
		face.Box.Width,
		face.Box.Height,
		face.Confidence,
	}
	for _, value := range values {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return errors.New("face geometry contains non-finite value")
		}
	}
	if face.Box.X < 0 || face.Box.Y < 0 ||
		face.Box.Width <= 0 || face.Box.Height <= 0 ||
		face.Box.X+face.Box.Width > 1.000001 ||
		face.Box.Y+face.Box.Height > 1.000001 {
		return errors.New("face box is outside normalized image bounds")
	}
	if face.Confidence < 0 || face.Confidence > 1 {
		return errors.New("face confidence must be between 0 and 1")
	}
	if len(face.Landmarks) != 5 {
		return fmt.Errorf(
			"face must contain exactly 5 alignment landmarks; got %d",
			len(face.Landmarks),
		)
	}
	for _, point := range face.Landmarks {
		if math.IsNaN(point.X) || math.IsInf(point.X, 0) ||
			math.IsNaN(point.Y) || math.IsInf(point.Y, 0) ||
			point.X < 0 || point.X > 1 ||
			point.Y < 0 || point.Y > 1 {
			return errors.New("face landmark is outside normalized image bounds")
		}
	}
	if len(face.Embedding) == 0 ||
		len(face.Embedding) > MaxFaceEmbeddingBytes {
		return errors.New("face embedding size is invalid")
	}
	if strings.EqualFold(strings.TrimSpace(info.EmbeddingFormat), "f32le") {
		expectedBytes := info.EmbeddingDimensions * 4
		if len(face.Embedding) != expectedBytes {
			return fmt.Errorf(
				"f32le face embedding has %d bytes; expected %d",
				len(face.Embedding),
				expectedBytes,
			)
		}
		for offset := 0; offset < len(face.Embedding); offset += 4 {
			value := math.Float32frombits(
				binary.LittleEndian.Uint32(face.Embedding[offset : offset+4]),
			)
			if math.IsNaN(float64(value)) || math.IsInf(float64(value), 0) {
				return errors.New("face embedding contains non-finite value")
			}
		}
	}
	return nil
}

func EncodeFaceLandmarks(points []NormalizedPoint) (string, error) {
	if len(points) != 5 {
		return "", fmt.Errorf(
			"face must contain exactly 5 landmarks; got %d",
			len(points),
		)
	}
	data, err := json.Marshal(points)
	if err != nil {
		return "", err
	}
	return string(data), nil
}
