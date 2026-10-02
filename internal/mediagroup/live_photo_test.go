package mediagroup

import "testing"

func TestNormalizeAppleAssetIdentifier(t *testing.T) {
	if got := normalizeAppleAssetIdentifier("  ABC-123\x00 "); got != "ABC-123" {
		t.Fatalf("identifier=%q", got)
	}
	if got := normalizeAppleAssetIdentifier("bad\nidentifier"); got != "" {
		t.Fatalf("control-character identifier accepted: %q", got)
	}
}
