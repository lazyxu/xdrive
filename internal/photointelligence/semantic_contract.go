package photointelligence

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"unicode/utf8"
)

const (
	SemanticAnalyzerProtocolVersion = 1
	SemanticEmbeddingFormatI8Norm   = "i8norm-v1"
	MaxSemanticSearchRunes          = 256
)

type SemanticAnalyzer interface {
	Info(context.Context) (SemanticAnalyzerInfo, error)
	EmbedImage(context.Context, SemanticImageTask) (SemanticEmbedding, error)
	EmbedText(context.Context, string) (SemanticEmbedding, error)
}

type SemanticAnalyzerInfo struct {
	ProtocolVersion     int                      `json:"protocol_version"`
	Name                string                   `json:"name"`
	PipelineVersion     string                   `json:"pipeline_version"`
	VisionModel         FaceAnalyzerModelInfo    `json:"vision_model"`
	TextModel           FaceAnalyzerModelInfo    `json:"text_model"`
	TokenizerSHA256     string                   `json:"tokenizer_sha256"`
	EmbeddingFormat     string                   `json:"embedding_format"`
	EmbeddingDimensions int                      `json:"embedding_dimensions"`
	Runtime             *FaceAnalyzerRuntimeInfo `json:"runtime,omitempty"`
}

type SemanticImageTask struct {
	PreviewURL       string `json:"preview_url"`
	PreviewVersion   int    `json:"preview_version"`
	PreviewEdge      int    `json:"preview_edge"`
	InputFingerprint string `json:"input_fingerprint"`
}

type SemanticEmbedding struct {
	Embedding  []byte `json:"embedding"`
	Format     string `json:"format"`
	Dimensions int    `json:"dimensions"`
}

func ValidateSemanticAnalyzerInfo(info SemanticAnalyzerInfo) error {
	if info.ProtocolVersion != SemanticAnalyzerProtocolVersion {
		return fmt.Errorf(
			"unsupported semantic analyzer protocol version %d",
			info.ProtocolVersion,
		)
	}
	if strings.TrimSpace(info.Name) == "" {
		return errors.New("semantic analyzer name is required")
	}
	if strings.TrimSpace(info.PipelineVersion) == "" {
		return errors.New("semantic analyzer pipeline version is required")
	}
	if err := validateFaceModelInfo("semantic vision", info.VisionModel); err != nil {
		return err
	}
	if err := validateFaceModelInfo("semantic text", info.TextModel); err != nil {
		return err
	}
	tokenizerHash := strings.ToLower(strings.TrimSpace(info.TokenizerSHA256))
	if len(tokenizerHash) != 64 {
		return errors.New("semantic tokenizer sha256 is invalid")
	}
	if _, err := hex.DecodeString(tokenizerHash); err != nil {
		return errors.New("semantic tokenizer sha256 is invalid")
	}
	if strings.TrimSpace(info.EmbeddingFormat) != SemanticEmbeddingFormatI8Norm {
		return fmt.Errorf(
			"unsupported semantic embedding format %q",
			info.EmbeddingFormat,
		)
	}
	if info.EmbeddingDimensions < 64 || info.EmbeddingDimensions > 4096 {
		return fmt.Errorf(
			"semantic embedding dimensions %d are invalid",
			info.EmbeddingDimensions,
		)
	}
	if info.Runtime != nil {
		if strings.TrimSpace(info.Runtime.Framework) == "" {
			return errors.New("semantic analyzer runtime framework is required")
		}
		if strings.TrimSpace(info.Runtime.Device) == "" {
			return errors.New("semantic analyzer runtime device is required")
		}
	}
	return nil
}

func ValidateSemanticImageTask(task SemanticImageTask) error {
	rawURL := strings.TrimSpace(task.PreviewURL)
	if rawURL == "" {
		return errors.New("semantic analysis preview URL is required")
	}
	parsed, err := url.Parse(rawURL)
	if err != nil ||
		(parsed.Scheme != "http" && parsed.Scheme != "https") ||
		parsed.Host == "" ||
		parsed.User != nil ||
		parsed.Fragment != "" {
		return errors.New("semantic analysis preview URL is invalid")
	}
	if task.PreviewVersion <= 0 {
		return errors.New("semantic analysis preview version is invalid")
	}
	if task.PreviewEdge <= 0 || task.PreviewEdge > 4096 {
		return errors.New("semantic analysis preview edge is invalid")
	}
	fingerprint := strings.TrimSpace(task.InputFingerprint)
	if fingerprint == "" || len(fingerprint) > 128 {
		return errors.New("semantic analysis input fingerprint is invalid")
	}
	return nil
}

func NormalizeSemanticSearchText(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", errors.New("semantic search text is required")
	}
	if utf8.RuneCountInString(value) > MaxSemanticSearchRunes {
		return "", fmt.Errorf(
			"semantic search text exceeds %d runes",
			MaxSemanticSearchRunes,
		)
	}
	return value, nil
}

func SemanticAnalyzerVersion(info SemanticAnalyzerInfo) string {
	return faceAnalyzerVersionToken(
		"semantic",
		[]string{
			info.Name,
			info.PipelineVersion,
			info.VisionModel.Name,
			info.VisionModel.Version,
			info.VisionModel.SHA256,
			info.TextModel.Name,
			info.TextModel.Version,
			info.TextModel.SHA256,
			info.TokenizerSHA256,
			info.EmbeddingFormat,
			fmt.Sprintf("%d", info.EmbeddingDimensions),
		},
	)
}

func ValidateSemanticEmbedding(
	info SemanticAnalyzerInfo,
	value SemanticEmbedding,
) (SemanticEmbedding, error) {
	if err := ValidateSemanticAnalyzerInfo(info); err != nil {
		return SemanticEmbedding{}, err
	}
	if strings.TrimSpace(value.Format) != info.EmbeddingFormat {
		return SemanticEmbedding{}, fmt.Errorf(
			"semantic embedding format %q does not match analyzer %q",
			value.Format,
			info.EmbeddingFormat,
		)
	}
	if value.Dimensions != info.EmbeddingDimensions {
		return SemanticEmbedding{}, fmt.Errorf(
			"semantic embedding dimensions %d do not match analyzer %d",
			value.Dimensions,
			info.EmbeddingDimensions,
		)
	}
	if len(value.Embedding) != value.Dimensions {
		return SemanticEmbedding{}, fmt.Errorf(
			"semantic embedding byte length %d does not match dimensions %d",
			len(value.Embedding),
			value.Dimensions,
		)
	}
	nonZero := false
	for _, raw := range value.Embedding {
		if int8(raw) != 0 {
			nonZero = true
			break
		}
	}
	if !nonZero {
		return SemanticEmbedding{}, errors.New("semantic embedding is all zero")
	}
	value.Embedding = append([]byte(nil), value.Embedding...)
	value.Format = info.EmbeddingFormat
	return value, nil
}
