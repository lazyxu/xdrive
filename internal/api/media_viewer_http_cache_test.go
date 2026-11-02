package api

import "testing"

func TestViewerPreviewRequiresRevalidationWhenRevisionIsKnown(t *testing.T) {
	tests := []struct {
		revision, expected string
	}{
		{"", "private, no-store"},
		{"  ", "private, no-store"},
		{"1", "private, no-cache"},
		{"999", "private, no-cache"},
	}
	for _, tc := range tests {
		if actual := viewerPreviewHTTPRevalidation(tc.revision); actual != tc.expected {
			t.Fatalf("revision %q HTTP cache policy = %q; expected %q",
				tc.revision, actual, tc.expected)
		}
	}
}
