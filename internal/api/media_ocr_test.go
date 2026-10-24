package api

import (
	"strings"
	"testing"

	mediapkg "github.com/lazyxu/xdrive/internal/media"
)

func TestMediaOCRFingerprintMatchesSmartRunnerFormat(t *testing.T) {
	sha := strings.Repeat("A", 64)
	expected := "media-analysis-" + strings.ToLower(sha) + "-v" +
		strings.TrimPrefix(mediaOCRInputFingerprint("", 4, 2), "media-analysis-node-4-2-v")
	// Ensure the fallback is node/revision-bound and the content key is not.
	actual := mediaOCRInputFingerprint(sha, 4, 2)
	if actual != expected || mediaOCRInputFingerprint(sha, 7, 8) != actual {
		t.Fatalf("OCR content fingerprint mismatch: %q", actual)
	}
	node := mediaOCRInputFingerprint("", 4, 2)
	if node == mediaOCRInputFingerprint("", 4, 3) {
		t.Fatal("missing SHA fingerprint ignored node revision")
	}
	sql := mediaOCRInputFingerprintSQL("search_ocr_file")
	if !strings.Contains(sql, "lower(trim(search_ocr_file.sha256))") ||
		!strings.Contains(sql, "n.revision::text") ||
		!strings.Contains(sql, "-v"+strings.TrimPrefix(node, "media-analysis-node-4-2-v")) {
		t.Fatalf("SQL fingerprint and Go implementation diverged: %s", sql)
	}
	if mediapkg.AnalysisPreviewVersion <= 0 || mediapkg.AnalysisPreviewEdge <= 0 {
		t.Fatal("OCR preview contract is invalid")
	}
}
