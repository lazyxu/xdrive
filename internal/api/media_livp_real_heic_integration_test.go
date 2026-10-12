package api

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image/jpeg"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// Reuses the existing real PostgreSQL/Gin/CAS Gallery fixture, but with
// actual HEVC-coded HEIC still bytes instead of the older synthetic JPEG.
// This validates the shared Web/Mobile Web REST and Desktop Server contract.
func testRealHEICLivePhotoThumbnail(t *testing.T, db *gorm.DB, server *Server, router *gin.Engine, parentID uint64, token string) {
	t.Helper()
	still, err := os.ReadFile("../media/testdata/heic-8bit-512.heic")
	if err != nil {
		t.Fatal(err)
	}
	motion := testLIVPMOV("HEIC-REAL-STILL-TEST-ID")
	var archive bytes.Buffer
	zw := zip.NewWriter(&archive)
	for _, entry := range []struct {
		name string
		data []byte
	}{
		{"IMG_HEIC_512.HEIC", still},
		{"IMG_HEIC_512.MOV", motion},
	} {
		writer, err := zw.CreateHeader(&zip.FileHeader{Name: entry.name, Method: zip.Store})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := writer.Write(entry.data); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	original := archive.Bytes()
	indexed, err := mediapkg.InspectLIVP(bytes.NewReader(original), int64(len(original)))
	if err != nil {
		t.Fatalf("real HEIC LIVP is not a valid local container: %v", err)
	}
	if (indexed.Still.MIMEType != "image/heic" && indexed.Still.MIMEType != "image/heif") || indexed.Still.Width != 512 || indexed.Still.Height != 512 {
		t.Fatalf("real HEIC still classification: %+v", indexed.Still)
	}
	node := uploadTestFile(t, router, token, parentID, "real-heic-still.livp", string(original))
	t.Run("real HEIC LIVP cold thumbnail and signed ranges after derived rows disappear", func(t *testing.T) {
		detailResponse := request(t, router, http.MethodGet,
			fmt.Sprintf("/api/v1/media/items/%d", node.ID), token, nil, http.StatusOK)
		var detail mediaItemDTO
		if err := json.Unmarshal(detailResponse.Body.Bytes(), &detail); err != nil {
			t.Fatal(err)
		}
		if !detail.LivePhoto || !detail.Metadata.HasThumbnail || len(detail.DerivedResources) != 2 ||
			detail.Metadata.ContainerKind != mediapkg.ContainerKindLIVP {
			t.Fatalf("real HEIC LIVP not indexed as thumbnail-capable Live Photo: %+v", detail)
		}
		var metadata meta.MediaMetadata
		if err := db.Where("node_id = ?", node.ID).First(&metadata).Error; err != nil {
			t.Fatal(err)
		}
		if mime := mediaThumbnailSourceMIME(metadata); mime != indexed.Still.MIMEType {
			t.Fatalf("effective still MIME=%q, want HEIC", mime)
		}
		if version := mediaThumbnailVersion(metadata); version != mediapkg.ThumbnailAlphaVersion {
			t.Fatalf("HEIC still wrong thumbnail cache version: %d", version)
		}
		var count int64
		if err := db.Where("node_id = ?", node.ID).Delete(&meta.MediaDerivedResource{}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Model(&meta.MediaDerivedResource{}).Where("node_id = ?", node.ID).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("failed to prepare missing-derived case: %d", count)
		}
		thumbURL := fmt.Sprintf("/api/v1/media/items/%d/thumbnail?revision=%d", node.ID, node.Revision)
		thumb := request(t, router, http.MethodGet, thumbURL, token, nil, http.StatusOK)
		if mime := thumb.Header().Get("Content-Type"); !strings.HasPrefix(mime, "image/jpeg") {
			t.Fatalf("browser-safe HEIC thumbnail MIME=%q", mime)
		}
		config, err := jpeg.DecodeConfig(bytes.NewReader(thumb.Body.Bytes()))
		if err != nil || config.Width != 512 || config.Height != 512 {
			t.Fatalf("HEIC thumbnail not a real 512x512 JPEG: config=%+v err=%v", config, err)
		}
		if !strings.Contains(thumb.Header().Get("ETag"), "-v4-") {
			t.Fatalf("HEIC must use v4 derivative ETag: %q", thumb.Header().Get("ETag"))
		}
		cached := request(t, router, http.MethodGet, thumbURL, token, nil, http.StatusOK)
		if !bytes.Equal(thumb.Body.Bytes(), cached.Body.Bytes()) ||
			thumb.Header().Get("ETag") != cached.Header().Get("ETag") {
			t.Fatal("cached HEIC thumbnail bytes or revision changed")
		}
		for _, entry := range []struct {
			role        string
			kind        string
			contentType string
			bytes       []byte
		}{
			{meta.MediaDerivedResourceRoleStill, "live-photo-still-ticket", indexed.Still.MIMEType, still},
			{meta.MediaDerivedResourceRoleMotion, "live-photo-motion-ticket", "video/quicktime", motion},
		} {
			direct := request(t, router, http.MethodGet,
				fmt.Sprintf("/api/v1/media/items/%d/resources/%s", node.ID, entry.role),
				token, nil, http.StatusOK)
			if !bytes.Equal(direct.Body.Bytes(), entry.bytes) ||
				!strings.HasPrefix(direct.Header().Get("Content-Type"), entry.contentType) {
				t.Fatalf("recovered %s bytes or MIME differ from HEIC LIVP original", entry.role)
			}
			issued := request(t, router, http.MethodPost,
				fmt.Sprintf("/api/v1/media/items/%d/%s", node.ID, entry.kind),
				token, nil, http.StatusOK)
			var ticket filePreviewTicketDTO
			if err := json.Unmarshal(issued.Body.Bytes(), &ticket); err != nil {
				t.Fatal(err)
			}
			if ticket.MIMEType != entry.contentType || !strings.Contains(ticket.URL, "ticket=") {
				t.Fatalf("signed %s transport metadata wrong: %+v", entry.role, ticket)
			}
			partial := requestWithHeaders(t, router, http.MethodGet, ticket.URL,
				"", nil, http.StatusPartialContent, map[string]string{"Range": "bytes=0-31"})
			if !bytes.Equal(partial.Body.Bytes(), entry.bytes[:32]) ||
				partial.Header().Get("Content-Range") != fmt.Sprintf("bytes 0-31/%d", len(entry.bytes)) {
				t.Fatalf("signed %s Range did not return local original bytes", entry.role)
			}
		}
		if err := db.Model(&meta.MediaDerivedResource{}).Where("node_id = ?", node.ID).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatal("read-only HEIC LIVP recovery persisted derived rows")
		}
		var persisted meta.Node
		if err := db.Preload("File").First(&persisted, node.ID).Error; err != nil {
			t.Fatal(err)
		}
		originalFile, err := server.Store.Open(context.Background(), persisted.File.StorageKey)
		if err != nil {
			t.Fatal(err)
		}
		actual, readErr := io.ReadAll(originalFile)
		closeErr := originalFile.Close()
		if readErr != nil || closeErr != nil || !bytes.Equal(actual, original) {
			t.Fatalf("canonical HEIC LIVP CAS original changed: read=%v close=%v", readErr, closeErr)
		}
		stale := request(t, router, http.MethodGet,
			fmt.Sprintf("/api/v1/media/items/%d/thumbnail?revision=%d", node.ID, node.Revision+1),
			token, nil, http.StatusConflict)
		if stale.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatalf("stale HEIC revision must not cache: %q", stale.Header().Get("Cache-Control"))
		}
	})

	t.Run("truncated HEIC derivative cache heals without returning a gray image", func(t *testing.T) {
		var row meta.MediaMetadata
		if err := db.Where("node_id = ?", node.ID).First(&row).Error; err != nil {
			t.Fatal(err)
		}
		var cacheNode meta.Node
		if err := db.Preload("File").First(&cacheNode, node.ID).Error; err != nil {
			t.Fatal(err)
		}
		key := mediaThumbnailStorageKey(cacheNode, row)
		uri := fmt.Sprintf("/api/v1/media/items/%d/thumbnail?revision=%d", node.ID, node.Revision)
		baseline := request(t, router, http.MethodGet, uri, token, nil, http.StatusOK)
		originalDerivative := append([]byte(nil), baseline.Body.Bytes()...)
		cfg, err := jpeg.DecodeConfig(bytes.NewReader(originalDerivative))
		if err != nil || cfg.Width != 512 || cfg.Height != 512 {
			t.Fatalf("valid HEIC derivative missing before corruption: %+v err=%v", cfg, err)
		}
		for _, tc := range []struct {
			name string
			data []byte
		}{
			{"truncated JPEG", originalDerivative[:len(originalDerivative)-2]},
			{"orphan PNG header", []byte{137, 80, 78, 71, 13, 10, 26, 10}},
			{"empty derivative", nil},
		} {
			t.Run(tc.name, func(t *testing.T) {
				if _, err := server.Store.Put(context.Background(), key, bytes.NewReader(tc.data)); err != nil {
					t.Fatal(err)
				}
				repaired := request(t, router, http.MethodGet, uri, token, nil, http.StatusOK)
				config, err := jpeg.DecodeConfig(bytes.NewReader(repaired.Body.Bytes()))
				if err != nil || config.Width != 512 || config.Height != 512 {
					t.Fatalf("cached HEIC still remained corrupt: image=%+v err=%v", config, err)
				}
				if !bytes.Equal(repaired.Body.Bytes(), originalDerivative) {
					t.Fatal("repaired thumbnail differs from canonical decoded HEIC still")
				}
				if got := repaired.Header().Get("ETag"); got != baseline.Header().Get("ETag") {
					t.Fatalf("same source revision changed cache ETag: %q", got)
				}
				if got := repaired.Header().Get("Cache-Control"); got != "private, max-age=3600" {
					t.Fatalf("successful regenerated JPEG has unexpected cache policy: %q", got)
				}
			})
		}
		// Repairing only a derived thumbnail may never rewrite the LIVP
		// original, its still/motion byte ranges or their persisted rows.
		var current meta.Node
		if err := db.Preload("File").First(&current, node.ID).Error; err != nil {
			t.Fatal(err)
		}
		canonical, err := server.Store.Open(context.Background(), current.File.StorageKey)
		if err != nil {
			t.Fatal(err)
		}
		body, readErr := io.ReadAll(canonical)
		closeErr := canonical.Close()
		if readErr != nil || closeErr != nil || !bytes.Equal(body, original) {
			t.Fatalf("corrupt-cache repair modified original LIVP: read=%v close=%v", readErr, closeErr)
		}
		var rows int64
		if err := db.Model(&meta.MediaDerivedResource{}).Where("node_id = ?", node.ID).Count(&rows).Error; err != nil {
			t.Fatal(err)
		}
		if rows != 0 {
			t.Fatalf("thumbnail repair unexpectedly wrote %d derived-range records", rows)
		}
	})
}
