package media

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"io"
	"strings"

	webpcodec "github.com/gen2brain/webp"
	xdraw "golang.org/x/image/draw"
)

const (
	// A separate, foreground-only derivative. These values must NOT affect
	// the existing 512px Gallery wall cache or 1280px analysis endpoint.
	ViewerPreviewEdge        = 4096
	ViewerPreviewVersion     = 1
	ViewerPreviewWebPQuality = 90
	ViewerPreviewJPEGQuality = 93
)

func ViewerPreviewStorageKey(nodeID, revision uint64, sha256, format string) string {
	// Version namespace 101 cannot collide with the existing v3/v4 or
	// analysis/creative derivatives, even for the same original blob.
	key := strings.TrimSuffix(thumbnailStorageKey(
		nodeID, revision, sha256, 100+ViewerPreviewVersion, ViewerPreviewEdge,
	), ".jpg")
	if format == "webp" {
		return fmt.Sprintf("%s-q%d.webp", key, ViewerPreviewWebPQuality)
	}
	return fmt.Sprintf("%s-q%d.jpg", key, ViewerPreviewJPEGQuality)
}

func ViewerPreviewETag(nodeID, revision uint64, sha256, format string) string {
	return fmt.Sprintf("%q", fmt.Sprintf("media-viewer:%s:%d:%d:%s:v%d",
		strings.ToLower(strings.TrimSpace(sha256)), nodeID, revision, format, ViewerPreviewVersion))
}

func ViewerPreviewWebP(r io.ReadSeeker, orientation, maxEdge int) (Thumbnail, error) {
	return renderViewerPreview(r, orientation, maxEdge, "webp")
}

func ViewerPreviewJPEG(r io.ReadSeeker, orientation, maxEdge int) (Thumbnail, error) {
	return renderViewerPreview(r, orientation, maxEdge, "jpeg")
}

// ViewerQualityPreview renders only a previously validated, finite Viewer
// quality variant. It does not change the current 4096px/v1 Server route.
func ViewerQualityPreview(r io.ReadSeeker, orientation int, variant ViewerQualityVariant) (Thumbnail, error) {
	if !validViewerQualityVariant(variant) {
		return Thumbnail{}, ErrViewerQualityPreference
	}
	return renderViewerPreviewWithQuality(r, orientation, variant.MaxEdge, variant.Format, variant.Quality)
}

func renderViewerPreview(r io.ReadSeeker, orientation, maxEdge int, format string) (Thumbnail, error) {
	switch format {
	case "webp":
		return renderViewerPreviewWithQuality(r, orientation, maxEdge, format, ViewerPreviewWebPQuality)
	case "jpeg":
		return renderViewerPreviewWithQuality(r, orientation, maxEdge, format, ViewerPreviewJPEGQuality)
	default:
		return Thumbnail{}, fmt.Errorf("unsupported viewer format %q", format)
	}
}

func renderViewerPreviewWithQuality(r io.ReadSeeker, orientation, maxEdge int, format string, quality int) (Thumbnail, error) {
	var out Thumbnail
	if r == nil {
		return out, fmt.Errorf("viewer source is nil")
	}
	if maxEdge <= 0 || maxEdge > ViewerPreviewEdge {
		maxEdge = ViewerPreviewEdge
	}
	if _, err := r.Seek(0, io.SeekStart); err != nil {
		return out, err
	}
	cfg, sourceFormat, err := image.DecodeConfig(r)
	if err != nil {
		return out, err
	}
	if cfg.Width <= 0 || cfg.Height <= 0 ||
		int64(cfg.Width)*int64(cfg.Height) > MaxThumbnailPixels {
		return out, fmt.Errorf("viewer image dimensions exceed safe limit")
	}
	orientation = thumbnailSourceOrientation(r, sourceFormat, orientation)
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
		return out, fmt.Errorf("invalid viewer image dimensions")
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
	// Unlike thumbnail.go's fast point sampling, the fullscreen Viewer uses
	// a high-quality reconstruction filter before encoding.
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, bounds, draw.Src, nil)
	var encoded bytes.Buffer
	out = Thumbnail{Width: dstWidth, Height: dstHeight, MaxEdge: maxEdge,
		SourceKind: sourceFormat}
	switch format {
	case "webp":
		if err := webpcodec.Encode(&encoded, dst, webpcodec.Options{
			Quality: quality, Method: 4,
		}); err != nil {
			return Thumbnail{}, err
		}
		out.MIMEType = "image/webp"
		out.Quality = quality
	case "jpeg":
		// JPEG lacks alpha: composite transparent pixels over white rather
		// than allowing uninitialized black pixels to appear in fallback.
		opaque := image.NewRGBA(dst.Bounds())
		draw.Draw(opaque, opaque.Bounds(), &image.Uniform{C: color.White},
			image.Point{}, draw.Src)
		draw.Draw(opaque, opaque.Bounds(), dst, image.Point{}, draw.Over)
		if err := jpeg.Encode(&encoded, opaque, &jpeg.Options{
			Quality: quality,
		}); err != nil {
			return Thumbnail{}, err
		}
		out.MIMEType = "image/jpeg"
		out.Quality = quality
	default:
		return Thumbnail{}, fmt.Errorf("unsupported viewer format %q", format)
	}
	out.Data = encoded.Bytes()
	return out, nil
}
