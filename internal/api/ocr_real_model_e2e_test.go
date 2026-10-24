package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
	"unicode"

	"github.com/google/uuid"
	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
	"gorm.io/gorm"
)

// runOCRRealModelGalleryFixture is only called from the existing isolated
// PostgreSQL Gallery filter test when XD_OCR_REAL_MODEL_E2E=1. Unlike the
// fake analyzer tests, its input is JPEG bytes and its output is produced by
// the real pinned PP-OCR/CRNN model over the private Unix Socket.
// It does not test the HTTP upload API or character-level OCR accuracy.
func runOCRRealModelGalleryFixture(
	t *testing.T,
	db *gorm.DB,
	server *Server,
	ownerID, sessionVersion uint64,
	node meta.Node,
	file meta.File,
	metadata meta.MediaMetadata,
	asset meta.PhotoAsset,
	otherNodeID uint64,
) {
	t.Helper()
	if runtime.GOOS != "linux" {
		t.Skip("Docker host-network real model test requires Linux")
	}
	imageRef := strings.TrimSpace(os.Getenv("XD_OCR_REAL_MODEL_IMAGE"))
	if imageRef == "" {
		t.Fatal("XD_OCR_REAL_MODEL_IMAGE is required for real OCR test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 7*time.Minute)
	defer cancel()

	jpegBytes := ocrRealJPEGFixture(t)
	sha := fmt.Sprintf("%x", sha256.Sum256(jpegBytes))
	// Make DB file evidence match the actual bytes exposed by the preview
	// server. Keep the other image out of the candidate set for this phase.
	if err := db.Model(&meta.File{}).Where("node_id = ?", node.ID).
		Updates(map[string]any{"sha256": sha, "size": int64(len(jpegBytes))}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.PhotoResource{}).Where("asset_id = ?", asset.ID).
		Update("size", int64(len(jpegBytes))).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.MediaMetadata{}).Where("node_id = ?", node.ID).
		Update("sha256", sha).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.MediaMetadata{}).Where("node_id = ?", otherNodeID).
		Update("index_state", "pending").Error; err != nil {
		t.Fatal(err)
	}
	file.SHA256 = sha
	file.Size = int64(len(jpegBytes))
	metadata.SHA256 = sha
	fingerprint := mediaOCRInputFingerprint(sha, node.ID, node.Revision)
	previewPath := "/api/v1/media-analysis-preview/" + strconv.FormatUint(node.ID, 10)
	preview := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != previewPath ||
			r.URL.RawQuery != "ticket=ocr-fixture" || r.Header.Get("Accept") != "image/jpeg" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "image/jpeg")
		w.Header().Set("Content-Length", strconv.Itoa(len(jpegBytes)))
		w.Header().Set("ETag", strconv.Quote(fingerprint))
		w.Header().Set("X-XDrive-Analysis-Preview-Version",
			strconv.Itoa(mediapkg.AnalysisPreviewVersion))
		w.Header().Set("X-XDrive-Analysis-Preview-Edge",
			strconv.Itoa(mediapkg.AnalysisPreviewEdge))
		_, _ = w.Write(jpegBytes)
	}))
	defer preview.Close()

	model := ocrRealStartModel(t, ctx, imageRef, preview.URL)
	runner := &photointelligence.SmartRunner{
		DB: db, Analyzer: model,
		PreviewURL: func(_ context.Context, gotOwner, gotSession, gotNode, gotRevision uint64) (string, error) {
			if gotOwner != ownerID || gotSession != sessionVersion ||
				gotNode != node.ID || gotRevision != node.Revision {
				return "", fmt.Errorf("unexpected OCR Owner or media revision")
			}
			return preview.URL + previewPath + "?ticket=ocr-fixture", nil
		},
	}
	processed, err := runner.RunOwnerBatch(ctx, ownerID, 2)
	if err != nil || processed != 1 {
		t.Fatalf("real JPEG smart analysis: processed=%d error=%v", processed, err)
	}

	var state meta.PhotoAnalysisState
	if err := db.Where("asset_id = ? AND kind = ?", asset.ID, meta.PhotoAnalysisKindOCRText).
		First(&state).Error; err != nil {
		t.Fatal(err)
	}
	if state.State != meta.PhotoAnalysisStateReady ||
		state.InputFingerprint != fingerprint {
		t.Fatalf("actual OCR model did not persist ready current-image evidence: %+v", state)
	}
	var ocr meta.PhotoOCRText
	if err := db.Where("asset_id = ?", asset.ID).First(&ocr).Error; err != nil {
		t.Fatal(err)
	}
	// This checks that the real OCR recognizer finds at least one searchable
	// word, without claiming the decoded spelling equals the fixture label.
	word := ocrRealSearchToken(ocr.Text)
	if word == "" {
		t.Fatal("pinned PP-OCR/CRNN returned no searchable text for the high-contrast JPEG fixture")
	}
	if ocr.Language == "" {
		t.Fatal("model OCR language was not persisted")
	}
	// Negative control: prove the model-derived word is not independently
	// searchable through the filename, tags or other preexisting metadata.
	// Otherwise the positive Gallery assertion could pass without OCR search.
	staleWrite := db.Model(&meta.PhotoAnalysisState{}).
		Where("asset_id = ? AND kind = ?", asset.ID, meta.PhotoAnalysisKindOCRText).
		Update("state", meta.PhotoAnalysisStateStale)
	if staleWrite.Error != nil || staleWrite.RowsAffected != 1 {
		t.Fatalf("temporarily hide OCR search evidence: %v (rows=%d)", staleWrite.Error, staleWrite.RowsAffected)
	}
	withoutOCR, err := server.queryMediaItems(ctx, ownerID, mediaQueryOptions{Search: word}, "", 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range withoutOCR {
		if item.Node.ID == node.ID {
			t.Fatal("OCR search token also matches non-OCR metadata; choose an unambiguous fixture")
		}
	}
	restoreWrite := db.Model(&meta.PhotoAnalysisState{}).
		Where("asset_id = ? AND kind = ?", asset.ID, meta.PhotoAnalysisKindOCRText).
		Update("state", meta.PhotoAnalysisStateReady)
	if restoreWrite.Error != nil || restoreWrite.RowsAffected != 1 {
		t.Fatalf("restore actual OCR search evidence: %v (rows=%d)", restoreWrite.Error, restoreWrite.RowsAffected)
	}
	items, err := server.queryMediaItems(ctx, ownerID, mediaQueryOptions{Search: word}, "", 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range items {
		if item.Node.ID == node.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("real OCR model text is not searchable in Gallery: query runes=%d", len([]rune(word)))
	}
	foreign := meta.User{
		Username:     "ocr-real-foreign-" + uuid.NewString(),
		PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&foreign).Error; err != nil {
		t.Fatal(err)
	}
	foreignID := foreign.ID
	foreignItems, err := server.queryMediaItems(ctx, foreignID, mediaQueryOptions{Search: word}, "", 10, 0)
	if err != nil || len(foreignItems) != 0 {
		t.Fatalf("foreign Owner queried private OCR: matches=%d error=%v", len(foreignItems), err)
	}
	node.File = &file
	detail, err := server.mediaOCRDetails(ctx, ownerID, node, metadata)
	if err != nil || detail == nil || detail.State != "ready" || detail.Text != ocr.Text {
		t.Fatalf("private Gallery detail mismatched persisted OCR: %+v error=%v", detail, err)
	}
	private, err := server.mediaOCRDetails(ctx, foreignID, node, metadata)
	if err != nil || private == nil || private.State == "ready" || private.Text != "" {
		t.Fatalf("foreign Owner obtained OCR detail: %+v error=%v", private, err)
	}
	// Content revision changes must hide prior recognized text in both paths.
	if err := db.Model(&meta.Node{}).Where("id = ?", node.ID).
		Update("revision", node.Revision+1).Error; err != nil {
		t.Fatal(err)
	}
	node.Revision++
	stale, err := server.mediaOCRDetails(ctx, ownerID, node, metadata)
	if err != nil || stale == nil || stale.State != "stale" || stale.Text != "" {
		t.Fatalf("stale OCR detail leaked: %+v error=%v", stale, err)
	}
	after, err := server.queryMediaItems(ctx, ownerID, mediaQueryOptions{Search: word}, "", 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range after {
		if item.Node.ID == node.ID {
			t.Fatal("stale OCR remained searchable after image revision changed")
		}
	}
	t.Logf("real JPEG→PP-OCR/CRNN→PostgreSQL→Gallery search passed: JPEG=%d bytes, OCR=%d runes",
		len(jpegBytes), len([]rune(ocr.Text)))
}

func ocrRealJPEGFixture(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 1024, 640))
	draw.Draw(img, img.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	ttf, err := opentype.Parse(goregular.TTF)
	if err != nil {
		t.Fatal(err)
	}
	face, err := opentype.NewFace(ttf, &opentype.FaceOptions{
		Size: 82, DPI: 72, Hinting: font.HintingFull,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer face.Close()
	drawer := font.Drawer{Dst: img, Src: image.NewUniform(color.Black), Face: face}
	for i, label := range []string{"XDRIVE", "PHOTO OCR", "SEARCH 2026"} {
		drawer.Dot = fixed.P(55, 140+i*185)
		drawer.DrawString(label)
	}
	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, img, &jpeg.Options{Quality: 95}); err != nil {
		t.Fatal(err)
	}
	return encoded.Bytes()
}

func ocrRealSearchToken(value string) string {
	for _, segment := range strings.Fields(value) {
		var chars []rune
		for _, r := range segment {
			if unicode.IsLetter(r) || unicode.IsNumber(r) {
				chars = append(chars, r)
				if len(chars) >= 16 {
					return string(chars)
				}
				continue
			}
			// A search token must be an actual contiguous substring in
			// the recognized text, not punctuation-stripped characters.
			if len(chars) >= 2 {
				return string(chars)
			}
			chars = chars[:0]
		}
		if len(chars) >= 2 {
			return string(chars)
		}
	}
	return ""
}

func ocrRealStartModel(
	t *testing.T, ctx context.Context, imageRef, previewOrigin string,
) *photointelligence.UnixSmartAnalyzer {
	t.Helper()
	socketDir := t.TempDir()
	socketPath := filepath.Join(socketDir, "model.sock")
	name := "xdrive-ocr-test-" + strings.ReplaceAll(uuid.NewString(), "-", "")
	const token = "ocr-local-test-only-token"
	cmd := exec.CommandContext(ctx, "docker", "run", "--rm", "--network", "host",
		"--name", name,
		"--user", fmt.Sprintf("%d:%d", os.Getuid(), os.Getgid()),
		"--security-opt", "no-new-privileges", "--cap-drop=ALL",
		"--mount", "type=bind,src="+socketDir+",dst=/ocr-e2e",
		"-e", "XD_FACE_SOCKET=/ocr-e2e/model.sock",
		"-e", "XD_FACE_PREVIEW_ORIGIN="+previewOrigin,
		"-e", "XD_FACE_ANALYZER_TOKEN="+token,
		imageRef,
	)
	var output bytes.Buffer
	cmd.Stdout, cmd.Stderr = &output, &output
	if err := cmd.Start(); err != nil {
		t.Fatalf("launch pinned Photo Intelligence image: %v", err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	t.Cleanup(func() {
		_ = exec.Command("docker", "rm", "-f", name).Run()
		select {
		case <-done:
		case <-time.After(10 * time.Second):
			t.Error("real model container did not terminate")
		}
	})
	client, err := photointelligence.NewUnixSmartAnalyzer(socketPath, token, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(120 * time.Second)
	for time.Now().Before(deadline) {
		probeCtx, stop := context.WithTimeout(ctx, time.Second)
		_, checkErr := client.Info(probeCtx)
		stop()
		if checkErr == nil {
			return client
		}
		select {
		case runErr := <-done:
			t.Fatalf("real model exited before ready: %v; output=%s", runErr, output.String())
		default:
		}
		time.Sleep(400 * time.Millisecond)
	}
	t.Fatal("pinned Photo Intelligence model did not start")
	return nil
}

func TestOCRRealSearchToken(t *testing.T) {
	for _, tc := range []struct {
		value string
		want  string
	}{
		{"  XDRIVE PHOTO OCR", "XDRIVE"},
		{"  中山 2026", "中山"},
		{"abc_def 123", "abc"},
		{" ... ! ", ""},
	} {
		if got := ocrRealSearchToken(tc.value); got != tc.want {
			t.Errorf("token %q = %q, want %q", tc.value, got, tc.want)
		}
	}
}
