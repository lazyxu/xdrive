package photointelligence

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/url"
	"sort"
	"strings"
	"unicode/utf8"
)

const SmartAnalyzerProtocolVersion = 1

const (
	MaxSmartVisualLabels = 16
	MaxSmartLabelRunes   = 128
	MaxSmartOCRRunes     = 8192
)

type SmartAnalyzer interface {
	Info(context.Context) (SmartAnalyzerInfo, error)
	Analyze(context.Context, SmartAnalysisTask) (SmartAnalysisResult, error)
}

type SmartAnalyzerInfo struct {
	ProtocolVersion int                      `json:"protocol_version"`
	Name            string                   `json:"name"`
	PipelineVersion string                   `json:"pipeline_version"`
	Classifier      FaceAnalyzerModelInfo    `json:"classifier"`
	TextDetector    FaceAnalyzerModelInfo    `json:"text_detector"`
	TextRecognizer  FaceAnalyzerModelInfo    `json:"text_recognizer"`
	OCRLanguage     string                   `json:"ocr_language"`
	Runtime         *FaceAnalyzerRuntimeInfo `json:"runtime,omitempty"`
}

type SmartAnalysisTask struct {
	PreviewURL       string `json:"preview_url"`
	PreviewVersion   int    `json:"preview_version"`
	PreviewEdge      int    `json:"preview_edge"`
	InputFingerprint string `json:"input_fingerprint"`
}

type SmartVisualLabel struct {
	Index      int     `json:"index"`
	Label      string  `json:"label"`
	Confidence float64 `json:"confidence"`
}

type SmartAnalysisResult struct {
	Labels      []SmartVisualLabel `json:"labels"`
	OCRText     string             `json:"ocr_text"`
	OCRLanguage string             `json:"ocr_language,omitempty"`
}

func ValidateSmartAnalyzerInfo(info SmartAnalyzerInfo) error {
	if info.ProtocolVersion != SmartAnalyzerProtocolVersion {
		return fmt.Errorf(
			"unsupported smart analyzer protocol version %d",
			info.ProtocolVersion,
		)
	}
	if strings.TrimSpace(info.Name) == "" {
		return errors.New("smart analyzer name is required")
	}
	if strings.TrimSpace(info.PipelineVersion) == "" {
		return errors.New("smart analyzer pipeline version is required")
	}
	if err := validateFaceModelInfo("classifier", info.Classifier); err != nil {
		return err
	}
	if err := validateFaceModelInfo("text detector", info.TextDetector); err != nil {
		return err
	}
	if err := validateFaceModelInfo("text recognizer", info.TextRecognizer); err != nil {
		return err
	}
	language := strings.TrimSpace(info.OCRLanguage)
	if language == "" || len(language) > 32 {
		return errors.New("smart analyzer OCR language is invalid")
	}
	if info.Runtime != nil {
		if strings.TrimSpace(info.Runtime.Framework) == "" {
			return errors.New("smart analyzer runtime framework is required")
		}
		if strings.TrimSpace(info.Runtime.Device) == "" {
			return errors.New("smart analyzer runtime device is required")
		}
	}
	return nil
}

func ValidateSmartAnalysisTask(task SmartAnalysisTask) error {
	rawURL := strings.TrimSpace(task.PreviewURL)
	if rawURL == "" {
		return errors.New("smart analysis preview URL is required")
	}
	parsed, err := url.Parse(rawURL)
	if err != nil ||
		(parsed.Scheme != "http" && parsed.Scheme != "https") ||
		parsed.Host == "" ||
		parsed.User != nil ||
		parsed.Fragment != "" {
		return errors.New("smart analysis preview URL is invalid")
	}
	if task.PreviewVersion <= 0 {
		return errors.New("smart analysis preview version is invalid")
	}
	if task.PreviewEdge <= 0 || task.PreviewEdge > 4096 {
		return errors.New("smart analysis preview edge is invalid")
	}
	fingerprint := strings.TrimSpace(task.InputFingerprint)
	if fingerprint == "" || len(fingerprint) > 128 {
		return errors.New("smart analysis input fingerprint is invalid")
	}
	return nil
}

func SmartVisualAnalyzerVersion(info SmartAnalyzerInfo) string {
	return faceAnalyzerVersionToken(
		"smart-visual",
		[]string{
			info.Name,
			info.PipelineVersion,
			info.Classifier.Name,
			info.Classifier.Version,
			info.Classifier.SHA256,
		},
	)
}

func SmartOCRAnalyzerVersion(info SmartAnalyzerInfo) string {
	return faceAnalyzerVersionToken(
		"smart-ocr",
		[]string{
			info.Name,
			info.PipelineVersion,
			info.TextDetector.Name,
			info.TextDetector.Version,
			info.TextDetector.SHA256,
			info.TextRecognizer.Name,
			info.TextRecognizer.Version,
			info.TextRecognizer.SHA256,
			info.OCRLanguage,
		},
	)
}

func ValidateSmartAnalysisResult(
	result SmartAnalysisResult,
) (SmartAnalysisResult, error) {
	if len(result.Labels) > MaxSmartVisualLabels {
		return SmartAnalysisResult{}, fmt.Errorf(
			"smart analyzer returned %d labels; maximum is %d",
			len(result.Labels),
			MaxSmartVisualLabels,
		)
	}
	byLabel := make(map[string]SmartVisualLabel, len(result.Labels))
	for _, item := range result.Labels {
		label := strings.TrimSpace(item.Label)
		if item.Index < 0 || item.Index >= 1000 {
			return SmartAnalysisResult{}, errors.New("smart visual label index is invalid")
		}
		if label == "" || utf8.RuneCountInString(label) > MaxSmartLabelRunes {
			return SmartAnalysisResult{}, errors.New("smart visual label is invalid")
		}
		if math.IsNaN(item.Confidence) ||
			math.IsInf(item.Confidence, 0) ||
			item.Confidence < 0 ||
			item.Confidence > 1 {
			return SmartAnalysisResult{}, errors.New("smart visual confidence is invalid")
		}
		key := strings.ToLower(label)
		if previous, exists := byLabel[key]; !exists || item.Confidence > previous.Confidence {
			byLabel[key] = SmartVisualLabel{
				Index:      item.Index,
				Label:      label,
				Confidence: item.Confidence,
			}
		}
	}
	labels := make([]SmartVisualLabel, 0, len(byLabel))
	for _, item := range byLabel {
		labels = append(labels, item)
	}
	sort.Slice(labels, func(i, j int) bool {
		if labels[i].Confidence != labels[j].Confidence {
			return labels[i].Confidence > labels[j].Confidence
		}
		return strings.ToLower(labels[i].Label) < strings.ToLower(labels[j].Label)
	})
	text := strings.TrimSpace(strings.ReplaceAll(result.OCRText, "\r\n", "\n"))
	if utf8.RuneCountInString(text) > MaxSmartOCRRunes {
		return SmartAnalysisResult{}, fmt.Errorf(
			"smart OCR text exceeds %d runes",
			MaxSmartOCRRunes,
		)
	}
	language := strings.TrimSpace(result.OCRLanguage)
	if len(language) > 32 {
		return SmartAnalysisResult{}, errors.New("smart OCR language is invalid")
	}
	return SmartAnalysisResult{
		Labels:      labels,
		OCRText:     text,
		OCRLanguage: language,
	}, nil
}
