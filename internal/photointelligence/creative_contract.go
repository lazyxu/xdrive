package photointelligence

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"
)

const (
	CreativeAnalyzerProtocolVersion = 1
	CreativeCapabilityCutout        = "cutout"
	CreativeCapabilityErase         = "erase"
	CreativeCapabilityMovie         = "movie"
	CreativeCapabilityCollage       = "collage"
	CreativeMaxPoints               = 6
	CreativeMaxStrokes              = 64
	CreativeMaxStrokePoints         = 256
	CreativeMovieMinFrames          = 2
	CreativeMovieMaxFrames          = 30
	CreativeMovieMinFrameDurationMS = 1000
	CreativeMovieMaxFrameDurationMS = 5000
	CreativeMovieMinTransitionMS    = 0
	CreativeMovieMaxTransitionMS    = 1000
	CreativeMovieTemplateClassic    = "classic"
	CreativeMovieTemplateFill       = "fill"
	CreativeMovieTemplateKenBurns   = "ken_burns"
	CreativeCollageMinImages        = 2
	CreativeCollageMaxImages        = 9
	CreativeCollageTemplateGrid     = "grid"
	CreativeCollageTemplateFeatured = "featured"
	CreativeCollageTemplateColumns  = "columns"
	CreativeCollageTemplateRows     = "rows"
	CreativeMaxResultBytes          = 128 << 20
)

type CreativeAnalyzer interface {
	Info(context.Context) (CreativeAnalyzerInfo, error)
	Generate(context.Context, CreativeTask) (CreativeResult, error)
}

type CreativeAnalyzerInfo struct {
	ProtocolVersion int                      `json:"protocol_version"`
	Name            string                   `json:"name"`
	PipelineVersion string                   `json:"pipeline_version"`
	SegmentModel    FaceAnalyzerModelInfo    `json:"segment_model"`
	Capabilities    []string                 `json:"capabilities"`
	Runtime         *FaceAnalyzerRuntimeInfo `json:"runtime,omitempty"`
}

type CreativePoint struct {
	X          float64 `json:"x"`
	Y          float64 `json:"y"`
	Foreground bool    `json:"foreground"`
}

type CreativeStrokePoint struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type CreativeStroke struct {
	Radius float64               `json:"radius"`
	Points []CreativeStrokePoint `json:"points"`
}

type CreativeMovieFrame struct {
	PreviewURL       string `json:"preview_url"`
	PreviewVersion   int    `json:"preview_version"`
	PreviewEdge      int    `json:"preview_edge"`
	InputFingerprint string `json:"input_fingerprint"`
}

type CreativeTask struct {
	Kind             string               `json:"kind"`
	PreviewURL       string               `json:"preview_url"`
	PreviewVersion   int                  `json:"preview_version"`
	PreviewEdge      int                  `json:"preview_edge"`
	InputFingerprint string               `json:"input_fingerprint"`
	CutoutMode       string               `json:"cutout_mode,omitempty"`
	Points           []CreativePoint      `json:"points,omitempty"`
	Strokes          []CreativeStroke     `json:"strokes,omitempty"`
	MovieFrames      []CreativeMovieFrame `json:"movie_frames,omitempty"`
	MovieTemplate    string               `json:"movie_template,omitempty"`
	CollageImages    []CreativeMovieFrame `json:"collage_images,omitempty"`
	CollageTemplate  string               `json:"collage_template,omitempty"`
	FrameDurationMS  int                  `json:"frame_duration_ms,omitempty"`
	TransitionMS     int                  `json:"transition_ms,omitempty"`
}

type CreativeResult struct {
	Data     []byte `json:"data"`
	MIMEType string `json:"mime_type"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
}

func normalizeCreativeCapabilities(values []string) ([]string, error) {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.ToLower(strings.TrimSpace(value))
		switch value {
		case CreativeCapabilityCutout,
			CreativeCapabilityErase,
			CreativeCapabilityMovie,
			CreativeCapabilityCollage:
		default:
			return nil, fmt.Errorf("unsupported creative capability %q", value)
		}
		if _, ok := seen[value]; ok {
			return nil, fmt.Errorf("duplicate creative capability %q", value)
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	sort.Strings(out)
	if _, ok := seen[CreativeCapabilityCutout]; !ok {
		return nil, errors.New("creative analyzer does not support cutout")
	}
	if _, ok := seen[CreativeCapabilityErase]; !ok {
		return nil, errors.New("creative analyzer does not support erase")
	}
	return out, nil
}

func ValidateCreativeAnalyzerInfo(info CreativeAnalyzerInfo) error {
	if info.ProtocolVersion != CreativeAnalyzerProtocolVersion {
		return fmt.Errorf("unsupported creative analyzer protocol version %d", info.ProtocolVersion)
	}
	if strings.TrimSpace(info.Name) == "" {
		return errors.New("creative analyzer name is required")
	}
	if strings.TrimSpace(info.PipelineVersion) == "" {
		return errors.New("creative analyzer pipeline version is required")
	}
	if err := validateFaceModelInfo("creative segment", info.SegmentModel); err != nil {
		return err
	}
	if _, err := normalizeCreativeCapabilities(info.Capabilities); err != nil {
		return err
	}
	if info.Runtime != nil {
		if strings.TrimSpace(info.Runtime.Framework) == "" ||
			strings.TrimSpace(info.Runtime.Device) == "" {
			return errors.New("creative analyzer runtime is invalid")
		}
	}
	return nil
}

func CreativeAnalyzerSupports(
	info CreativeAnalyzerInfo,
	capability string,
) bool {
	capabilities, err := normalizeCreativeCapabilities(info.Capabilities)
	if err != nil {
		return false
	}
	capability = strings.ToLower(strings.TrimSpace(capability))
	for _, value := range capabilities {
		if value == capability {
			return true
		}
	}
	return false
}

func CreativeAnalyzerVersion(info CreativeAnalyzerInfo) string {
	capabilities, _ := normalizeCreativeCapabilities(info.Capabilities)
	return faceAnalyzerVersionToken("creative", []string{
		strings.TrimSpace(info.Name),
		strings.TrimSpace(info.PipelineVersion),
		strings.TrimSpace(info.SegmentModel.Name),
		strings.TrimSpace(info.SegmentModel.Version),
		strings.ToLower(strings.TrimSpace(info.SegmentModel.SHA256)),
		strings.Join(capabilities, ","),
	})
}

func validCreativeUnit(value float64) bool {
	return value >= 0 && value <= 1
}

func validateCreativeSourceImage(frame CreativeMovieFrame, label string) error {
	rawURL := strings.TrimSpace(frame.PreviewURL)
	parsed, err := url.Parse(rawURL)
	if rawURL == "" || err != nil ||
		(parsed.Scheme != "http" && parsed.Scheme != "https") ||
		parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" {
		return fmt.Errorf("creative %s preview URL is invalid", label)
	}
	if frame.PreviewVersion <= 0 ||
		frame.PreviewEdge <= 0 ||
		frame.PreviewEdge > 4096 {
		return fmt.Errorf("creative %s preview contract is invalid", label)
	}
	fingerprint := strings.TrimSpace(frame.InputFingerprint)
	if fingerprint == "" || len(fingerprint) > 128 {
		return fmt.Errorf("creative %s fingerprint is invalid", label)
	}
	return nil
}

func validCreativeMovieTemplate(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "",
		CreativeMovieTemplateClassic,
		CreativeMovieTemplateFill,
		CreativeMovieTemplateKenBurns:
		return true
	default:
		return false
	}
}

func validCreativeCollageTemplate(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case CreativeCollageTemplateGrid,
		CreativeCollageTemplateFeatured,
		CreativeCollageTemplateColumns,
		CreativeCollageTemplateRows:
		return true
	default:
		return false
	}
}

func ValidateCreativeTask(task CreativeTask) error {
	rawURL := strings.TrimSpace(task.PreviewURL)
	parsed, err := url.Parse(rawURL)
	if rawURL == "" || err != nil ||
		(parsed.Scheme != "http" && parsed.Scheme != "https") ||
		parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" {
		return errors.New("creative preview URL is invalid")
	}
	if task.PreviewVersion <= 0 || task.PreviewEdge <= 0 || task.PreviewEdge > 4096 {
		return errors.New("creative preview contract is invalid")
	}
	fingerprint := strings.TrimSpace(task.InputFingerprint)
	if fingerprint == "" || len(fingerprint) > 128 {
		return errors.New("creative input fingerprint is invalid")
	}
	switch strings.TrimSpace(task.Kind) {
	case CreativeCapabilityCutout:
		if strings.TrimSpace(task.CutoutMode) != "object" {
			return errors.New("cutout_mode must be object")
		}
		if len(task.Points) == 0 || len(task.Points) > CreativeMaxPoints {
			return fmt.Errorf("object cutout requires between 1 and %d points", CreativeMaxPoints)
		}
		foreground := 0
		for _, point := range task.Points {
			if !validCreativeUnit(point.X) || !validCreativeUnit(point.Y) {
				return errors.New("creative point is outside normalized bounds")
			}
			if point.Foreground {
				foreground++
			}
		}
		if foreground == 0 {
			return errors.New("object cutout requires a foreground point")
		}
		if len(task.Strokes) != 0 {
			return errors.New("cutout does not accept erase strokes")
		}
		if len(task.MovieFrames) != 0 ||
			len(task.CollageImages) != 0 ||
			strings.TrimSpace(task.CollageTemplate) != "" ||
			strings.TrimSpace(task.MovieTemplate) != "" ||
			task.FrameDurationMS != 0 ||
			task.TransitionMS != 0 {
			return errors.New("cutout does not accept multi-image inputs")
		}
	case CreativeCapabilityErase:
		if len(task.Points) != 0 || strings.TrimSpace(task.CutoutMode) != "" {
			return errors.New("erase does not accept cutout prompts")
		}
		if len(task.MovieFrames) != 0 ||
			len(task.CollageImages) != 0 ||
			strings.TrimSpace(task.CollageTemplate) != "" ||
			strings.TrimSpace(task.MovieTemplate) != "" ||
			task.FrameDurationMS != 0 ||
			task.TransitionMS != 0 {
			return errors.New("erase does not accept multi-image inputs")
		}
		if len(task.Strokes) == 0 || len(task.Strokes) > CreativeMaxStrokes {
			return fmt.Errorf("erase requires between 1 and %d strokes", CreativeMaxStrokes)
		}
		for _, stroke := range task.Strokes {
			if stroke.Radius < 0.002 || stroke.Radius > 0.15 ||
				len(stroke.Points) == 0 || len(stroke.Points) > CreativeMaxStrokePoints {
				return errors.New("creative erase stroke is invalid")
			}
			for _, point := range stroke.Points {
				if !validCreativeUnit(point.X) || !validCreativeUnit(point.Y) {
					return errors.New("creative stroke point is outside normalized bounds")
				}
			}
		}
	case CreativeCapabilityMovie:
		if len(task.Points) != 0 ||
			len(task.Strokes) != 0 ||
			strings.TrimSpace(task.CutoutMode) != "" ||
			len(task.CollageImages) != 0 ||
			strings.TrimSpace(task.CollageTemplate) != "" {
			return errors.New("movie does not accept other creative inputs")
		}
		if len(task.MovieFrames) < CreativeMovieMinFrames ||
			len(task.MovieFrames) > CreativeMovieMaxFrames {
			return fmt.Errorf(
				"movie requires between %d and %d frames",
				CreativeMovieMinFrames,
				CreativeMovieMaxFrames,
			)
		}
		if task.FrameDurationMS < CreativeMovieMinFrameDurationMS ||
			task.FrameDurationMS > CreativeMovieMaxFrameDurationMS {
			return errors.New("creative movie frame duration is invalid")
		}
		if task.TransitionMS < CreativeMovieMinTransitionMS ||
			task.TransitionMS > CreativeMovieMaxTransitionMS ||
			task.TransitionMS >= task.FrameDurationMS {
			return errors.New("creative movie transition is invalid")
		}
		if !validCreativeMovieTemplate(task.MovieTemplate) {
			return errors.New("creative movie template is invalid")
		}
		for _, frame := range task.MovieFrames {
			if err := validateCreativeSourceImage(frame, "movie frame"); err != nil {
				return err
			}
		}
	case CreativeCapabilityCollage:
		if len(task.Points) != 0 ||
			len(task.Strokes) != 0 ||
			strings.TrimSpace(task.CutoutMode) != "" ||
			len(task.MovieFrames) != 0 ||
			strings.TrimSpace(task.MovieTemplate) != "" ||
			task.FrameDurationMS != 0 ||
			task.TransitionMS != 0 {
			return errors.New("collage does not accept other creative inputs")
		}
		if len(task.CollageImages) < CreativeCollageMinImages ||
			len(task.CollageImages) > CreativeCollageMaxImages {
			return fmt.Errorf(
				"collage requires between %d and %d images",
				CreativeCollageMinImages,
				CreativeCollageMaxImages,
			)
		}
		if !validCreativeCollageTemplate(task.CollageTemplate) {
			return errors.New("creative collage template is invalid")
		}
		for _, image := range task.CollageImages {
			if err := validateCreativeSourceImage(image, "collage image"); err != nil {
				return err
			}
		}
	default:
		return errors.New("creative kind must be erase, cutout, movie, or collage")
	}
	return nil
}

func ValidateCreativeResult(result CreativeResult) (CreativeResult, error) {
	if len(result.Data) == 0 || len(result.Data) > CreativeMaxResultBytes {
		return CreativeResult{}, errors.New("creative result size is invalid")
	}
	switch strings.ToLower(strings.TrimSpace(result.MIMEType)) {
	case "image/png", "image/jpeg", "video/mp4":
	default:
		return CreativeResult{}, errors.New("creative result MIME type is invalid")
	}
	if result.Width <= 0 || result.Height <= 0 || result.Width > 4096 || result.Height > 4096 {
		return CreativeResult{}, errors.New("creative result dimensions are invalid")
	}
	result.Data = append([]byte(nil), result.Data...)
	result.MIMEType = strings.ToLower(strings.TrimSpace(result.MIMEType))
	return result, nil
}
