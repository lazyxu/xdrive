package media

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"strings"
)

const (
	MaxThumbnailPixels     = 100_000_000
	DefaultThumbnailEdge   = 512
	AnalysisPreviewEdge    = 1280
	ThumbnailVersion       = 2
	AnalysisPreviewVersion = 2
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
	if _, err := r.Seek(0, io.SeekStart); err != nil {
		return out, err
	}
	src, _, err := image.Decode(r)
	if err != nil {
		return out, err
	}
	src = orientImage(src, thumbnailDecodeOrientation(format, orientation))

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
	if err := jpeg.Encode(&encoded, dst, &jpeg.Options{Quality: quality}); err != nil {
		return out, err
	}
	out = Thumbnail{
		Data:       encoded.Bytes(),
		MIMEType:   "image/jpeg",
		Width:      dstWidth,
		Height:     dstHeight,
		MaxEdge:    maxEdge,
		Quality:    quality,
		SourceKind: format,
	}
	return out, nil
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
