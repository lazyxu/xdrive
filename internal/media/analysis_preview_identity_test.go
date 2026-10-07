package media

import (
	"strings"
	"testing"
)

func TestAnalysisPreviewIdentityMatchesContentAndFallbackContracts(t *testing.T) {
	sha := strings.Repeat("A", 64)
	etag := AnalysisPreviewETag(42, 7, sha)
	want := "\"media-analysis-" + strings.ToLower(sha) + "-v3-1280\""
	if etag != want {
		t.Fatalf("etag=%q want=%q", etag, want)
	}
	if got := AnalysisPreviewFingerprint(42, 7, sha); got != want[1:len(want)-1] {
		t.Fatalf("fingerprint=%q", got)
	}

	fallback := AnalysisPreviewETag(42, 7, "")
	if fallback != "\"media-analysis-node-42-7-v3-1280\"" {
		t.Fatalf("fallback etag=%q", fallback)
	}
	if got := AnalysisPreviewFingerprint(42, 7, ""); got != "media-analysis-node-42-7-v3-1280" {
		t.Fatalf("fallback fingerprint=%q", got)
	}
}
