//go:build windows

package mount

import (
	"os"
	"strings"
	"testing"
)

func TestWindowsRemoteJournalFilePageUsesPathScopedBaselinePersistence(t *testing.T) {
	sourceBytes, err := os.ReadFile("reconcile_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(sourceBytes)
	start := strings.Index(source, "func (p *winProvider) applyRemoteChangePage")
	if start < 0 {
		t.Fatal("applyRemoteChangePage not found")
	}
	rest := source[start:]
	end := strings.Index(rest, "\nfunc ")
	if end < 0 {
		t.Fatal("applyRemoteChangePage end not found")
	}
	block := rest[:end]

	for _, token := range []string{
		"baselineDeltaPaths := make(map[string]struct{}, len(changes)*2)",
		"pathScopedBaselineDelta := true",
		"p.storeBaselineChangedPaths(baseline, baselineDeltaPaths)",
		"pathScopedBaselineDelta = false",
	} {
		if !strings.Contains(block, token) {
			t.Fatalf("remote journal persistence fast path missing %q", token)
		}
	}
	if strings.Count(block, "p.storeBaselineChangedPaths(") != 1 {
		t.Fatal("remote journal page must have exactly one path-scoped persistence exit")
	}
	syncIndex := strings.Index(block, "p.syncLocalFile(ctx, rel, info, baseline, hydrated)")
	if syncIndex < 0 {
		t.Fatal("remote journal local-file reconciliation call not found")
	}
	guardStart := syncIndex - 160
	if guardStart < 0 {
		guardStart = 0
	}
	if !strings.Contains(block[guardStart:syncIndex], "pathScopedBaselineDelta = false") {
		t.Fatal("local conflict-capable sync must fall back to full baseline diff")
	}
}
