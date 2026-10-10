package media

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"strings"
)

const (
	MaxThumbnailPixels     = 100_000_000
	DefaultThumbnailEdge   = 512
	AnalysisPreviewEdge    = 1280
	CreativePreviewEdge    = 2048
	ThumbnailVersion       = 3
	ThumbnailAlphaVersion  = 4
	MaxThumbnailMaskHeader = 4096
	AnalysisPreviewVersion = 3
	CreativePreviewVersion = 1
	ThumbnailStoragePrefix = ".xdrive-media/thumbnails/"
)

func AnalysisPreviewETag(
	nodeID, nodeRevision uint64,
	sha256 string,
) string {
	sha := strings.ToLower(strings.TrimSpace(sha256))
	if sha != "" {
		return fmt.Sprintf(
			"\"media-analysis-%s-v%d-%d\"",
			sha,
			AnalysisPreviewVersion,
			AnalysisPreviewEdge,
		)
	}
	return fmt.Sprintf(
		"\"media-analysis-node-%d-%d-v%d-%d\"",
		nodeID,
		nodeRevision,
		AnalysisPreviewVersion,
		AnalysisPreviewEdge,
	)
}

func AnalysisPreviewFingerprint(
	nodeID, nodeRevision uint64,
	sha256 string,
) string {
	return strings.Trim(
		AnalysisPreviewETag(nodeID, nodeRevision, sha256),
		"\"",
	)
}

func CreativePreviewETag(
	nodeID, nodeRevision uint64,
	sha256 string,
) string {
	sha := strings.ToLower(strings.TrimSpace(sha256))
	if sha != "" {
		return fmt.Sprintf(
			"\"media-creative-%s-v%d-%d\"",
			sha,
			CreativePreviewVersion,
			CreativePreviewEdge,
		)
	}
	return fmt.Sprintf(
		"\"media-creative-node-%d-%d-v%d-%d\"",
		nodeID,
		nodeRevision,
		CreativePreviewVersion,
		CreativePreviewEdge,
	)
}

func CreativePreviewFingerprint(
	nodeID, nodeRevision uint64,
	sha256 string,
) string {
	return strings.Trim(
		CreativePreviewETag(nodeID, nodeRevision, sha256),
		"\"",
	)
}

func ThumbnailStorageKey(
	nodeID, nodeRevision uint64,
	sha256 string,
	maxEdge int,
) string {
	return thumbnailStorageKey(
		nodeID,
		nodeRevision,
		sha256,
		ThumbnailVersion,
		maxEdge,
	)
}

// ThumbnailVersionForSource keeps ordinary JPEG v3 caches valid. Only images
// with a possible alpha channel need the new versioned derivative.
func ThumbnailVersionForSource(mime string) int {
	switch strings.ToLower(strings.TrimSpace(mime)) {
	case "image/png", "image/gif", "image/webp", "image/avif",
		"image/heic", "image/heif", "image/tiff", "image/bmp":
		return ThumbnailAlphaVersion
	default:
		return ThumbnailVersion
	}
}

// The neutral extension reflects that alpha-capable sources can output either
// a transparent PNG or a compact JPEG; the HTTP MIME describes the bytes.
func ThumbnailStorageKeyForSource(nodeID, nodeRevision uint64, sha256 string, maxEdge int, mime string) string {
	version := ThumbnailVersionForSource(mime)
	if version == ThumbnailVersion {
		return ThumbnailStorageKey(nodeID, nodeRevision, sha256, maxEdge)
	}
	key := thumbnailStorageKey(nodeID, nodeRevision, sha256, version, maxEdge)
	return strings.TrimSuffix(key, ".jpg") + ".thumb"
}

func AnalysisPreviewStorageKey(
	nodeID, nodeRevision uint64,
	sha256 string,
) string {
	return thumbnailStorageKey(
		nodeID,
		nodeRevision,
		sha256,
		AnalysisPreviewVersion,
		AnalysisPreviewEdge,
	)
}

func CreativePreviewStorageKey(
	nodeID, nodeRevision uint64,
	sha256 string,
) string {
	return thumbnailStorageKey(
		nodeID,
		nodeRevision,
		sha256,
		CreativePreviewVersion,
		CreativePreviewEdge,
	)
}

func thumbnailStorageKey(
	nodeID, nodeRevision uint64,
	sha256 string,
	version, maxEdge int,
) string {
	if version <= 0 {
		version = 1
	}
	if maxEdge <= 0 {
		maxEdge = DefaultThumbnailEdge
	}
	sha := strings.ToLower(strings.TrimSpace(sha256))
	if len(sha) >= 2 {
		return fmt.Sprintf(
			"%s%s/%s-v%d-%d.jpg",
			ThumbnailStoragePrefix,
			sha[:2],
			sha,
			version,
			maxEdge,
		)
	}
	return fmt.Sprintf(
		"%snode/%d-%d-v%d-%d.jpg",
		ThumbnailStoragePrefix,
		nodeID,
		nodeRevision,
		version,
		maxEdge,
	)
}

type Thumbnail struct {
	Data       []byte
	MIMEType   string
	Width      int
	Height     int
	MaxEdge    int
	Quality    int
	SourceKind string
}

// ThumbnailJPEG renders a bounded JPEG preview without changing or duplicating
// the original xDrive file object. The returned bytes are a derived cache only.
func ThumbnailJPEG(r io.ReadSeeker, orientation, maxEdge int) (Thumbnail, error) {
	return renderThumbnail(r, orientation, maxEdge, false)
}

// ThumbnailWithAlpha preserves real alpha (including translucent edges), but
// keeps opaque assets as JPEG. Only this thumbnail derivative may use PNG.
func ThumbnailWithAlpha(r io.ReadSeeker, orientation, maxEdge int) (Thumbnail, error) {
	return renderThumbnail(r, orientation, maxEdge, true)
}

func renderThumbnail(r io.ReadSeeker, orientation, maxEdge int, preserveAlpha bool) (Thumbnail, error) {
	var out Thumbnail
	if r == nil {
		return out, errors.New("media reader is nil")
	}
	if maxEdge <= 0 {
		maxEdge = 512
	}
	if maxEdge > 2048 {
		maxEdge = 2048
	}
	if _, err := r.Seek(0, io.SeekStart); err != nil {
		return out, err
	}
	cfg, format, err := image.DecodeConfig(r)
	if err != nil {
		return out, err
	}
	if cfg.Width <= 0 || cfg.Height <= 0 ||
		int64(cfg.Width)*int64(cfg.Height) > MaxThumbnailPixels {
		return out, errors.New("image dimensions exceed thumbnail safety limit")
	}
	orientation = thumbnailSourceOrientation(r, format, orientation)
	if _, err := r.Seek(0, io.SeekStart); err != nil {
		return out, err
	}
	src, _, err := image.Decode(r)
	if err != nil {
		return out, err
	}
	src = orientImage(src, orientation)

	bounds := src.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if width <= 0 || height <= 0 {
		return out, errors.New("invalid image dimensions")
	}

	dstWidth, dstHeight := width, height
	if width > maxEdge || height > maxEdge {
		if width >= height {
			dstWidth = maxEdge
			dstHeight = maxInt(1, int(float64(height)*float64(maxEdge)/float64(width)+0.5))
		} else {
			dstHeight = maxEdge
			dstWidth = maxInt(1, int(float64(width)*float64(maxEdge)/float64(height)+0.5))
		}
	}

	dst := image.NewNRGBA(image.Rect(0, 0, dstWidth, dstHeight))
	for y := 0; y < dstHeight; y++ {
		srcY := bounds.Min.Y + minInt(
			height-1,
			int((float64(y)+0.5)*float64(height)/float64(dstHeight)),
		)
		for x := 0; x < dstWidth; x++ {
			srcX := bounds.Min.X + minInt(
				width-1,
				int((float64(x)+0.5)*float64(width)/float64(dstWidth)),
			)
			dst.Set(x, y, src.At(srcX, srcY))
		}
	}

	var encoded bytes.Buffer
	const quality = 84
	mimeType := "image/jpeg"
	outputQuality := quality
	if preserveAlpha && !dst.Opaque() {
		if err := png.Encode(&encoded, dst); err != nil {
			return out, err
		}
		mimeType = "image/png"
		outputQuality = 0
	} else if err := jpeg.Encode(&encoded, dst, &jpeg.Options{Quality: quality}); err != nil {
		return out, err
	}
	out = Thumbnail{
		Data:       encoded.Bytes(),
		MIMEType:   mimeType,
		Width:      dstWidth,
		Height:     dstHeight,
		MaxEdge:    maxEdge,
		Quality:    outputQuality,
		SourceKind: format,
	}
	return out, nil
}

// ThumbnailAlphaMaskHeader encodes the derivative's exact per-pixel alpha as
// a same-size PNG mask. The HTTP header arrives before the streamed image.
// Pathological masks exceed the safe 4 KiB header budget: clients then hide
// the pie instead of painting over transparent pixels.
func ThumbnailAlphaMaskHeader(data []byte) string {
	if len(data) == 0 || len(data) > 4<<20 {
		return ""
	}
	src, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		return ""
	}
	bounds := src.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	if w < 1 || h < 1 || w > 2048 || h > 2048 {
		return ""
	}
	mask := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			_, _, _, a := src.At(bounds.Min.X+x, bounds.Min.Y+y).RGBA()
			i := mask.PixOffset(x, y)
			mask.Pix[i] = 255
			mask.Pix[i+1] = 255
			mask.Pix[i+2] = 255
			mask.Pix[i+3] = uint8(a >> 8)
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, mask); err != nil {
		return ""
	}
	if base64.StdEncoding.EncodedLen(encoded.Len()) > MaxThumbnailMaskHeader {
		return ""
	}
	return base64.StdEncoding.EncodeToString(encoded.Bytes())
}

func thumbnailSourceOrientation(
	r io.ReadSeeker,
	format string,
	orientation int,
) int {
	orientation = thumbnailDecodeOrientation(format, orientation)
	if strings.EqualFold(strings.TrimSpace(format), "avif") {
		if containerOrientation := avifContainerOrientation(r); containerOrientation > 1 {
			return containerOrientation
		}
	}
	return orientation
}

func thumbnailDecodeOrientation(format string, orientation int) int {
	if orientation < 2 || orientation > 8 {
		return 1
	}
	// github.com/gen2brain/heic applies HEIF container transforms and EXIF
	// orientation while decoding. Applying the stored EXIF orientation again
	// here would rotate/mirror HEIC thumbnails twice.
	if strings.EqualFold(strings.TrimSpace(format), "heic") {
		return 1
	}
	return orientation
}

func orientImage(src image.Image, orientation int) image.Image {
	bounds := src.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if orientation < 2 || orientation > 8 {
		return src
	}

	dstWidth, dstHeight := width, height
	if orientation >= 5 && orientation <= 8 {
		dstWidth, dstHeight = height, width
	}
	dst := image.NewNRGBA(image.Rect(0, 0, dstWidth, dstHeight))
	for y := 0; y < dstHeight; y++ {
		for x := 0; x < dstWidth; x++ {
			var srcX, srcY int
			switch orientation {
			case 2:
				srcX, srcY = width-1-x, y
			case 3:
				srcX, srcY = width-1-x, height-1-y
			case 4:
				srcX, srcY = x, height-1-y
			case 5:
				srcX, srcY = y, x
			case 6:
				srcX, srcY = y, height-1-x
			case 7:
				srcX, srcY = width-1-y, height-1-x
			case 8:
				srcX, srcY = width-1-y, x
			default:
				srcX, srcY = x, y
			}
			dst.Set(
				x,
				y,
				color.NRGBAModel.Convert(src.At(bounds.Min.X+srcX, bounds.Min.Y+srcY)),
			)
		}
	}
	return dst
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
