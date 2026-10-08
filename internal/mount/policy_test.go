package mount

import (
	"os"
	"strings"
	"testing"
)

func TestSyncPolicyUsesMostSpecificRule(t *testing.T) {
	policy := newSyncPolicy(Options{
		AlwaysLocalPaths: []string{"projects", "Media/Keep"},
		ExcludedPaths:    []string{"projects/archive", "media/tmp"},
	})
	cases := map[string]string{
		"projects/current/file.txt": "always-local",
		"projects/archive/old.zip":  "exclude",
		"MEDIA/KEEP/movie.mp4":      "always-local",
		"media/tmp/a.bin":           "exclude",
		"other/file.txt":            "",
	}
	for path, want := range cases {
		if got := policy.mode(path); got != want {
			t.Fatalf("mode(%q)=%q want=%q", path, got, want)
		}
	}
}

func TestSyncPolicyNormalizesSeparatorsAndDuplicates(t *testing.T) {
	policy := newSyncPolicy(Options{
		ExcludedPaths: []string{"Docs\\Archive", "docs/archive/", "Other"},
	})
	if len(policy.excluded) != 2 {
		t.Fatalf("excluded=%v", policy.excluded)
	}
	if !policy.excludedPath("DOCS/archive/report.txt") {
		t.Fatal("case-insensitive excluded descendant was not matched")
	}
	if policy.excludedPath("docs/archived/report.txt") {
		t.Fatal("prefix without path boundary was incorrectly excluded")
	}
}

func TestSyncPolicyHasAlwaysLocal(t *testing.T) {
	if newSyncPolicy(Options{}).hasAlwaysLocal() {
		t.Fatal("empty policy unexpectedly reports always-local rules")
	}
	if !newSyncPolicy(Options{AlwaysLocalPaths: []string{"keep"}}).hasAlwaysLocal() {
		t.Fatal("always-local policy was not detected")
	}
	if newSyncPolicy(Options{AlwaysLocalPaths: []string{"", " / "}}).hasAlwaysLocal() {
		t.Fatal("empty normalized always-local entries must not enable the policy")
	}
}

func TestWindowsApplyAlwaysLocalEmptyPolicyFastPathSourceShape(t *testing.T) {
	source, err := os.ReadFile("storage_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	start := strings.Index(text, "func (p *winProvider) applyAlwaysLocal")
	if start < 0 {
		t.Fatal("cannot find applyAlwaysLocal source")
	}
	relativeEnd := strings.Index(text[start:], "func (p *winProvider) enforceCacheSnapshot")
	end := start + relativeEnd
	if relativeEnd < 0 || end <= start {
		t.Fatal("cannot isolate applyAlwaysLocal source")
	}
	fn := text[start:end]
	guard := strings.Index(fn, "if !p.policy.hasAlwaysLocal()")
	loop := strings.Index(fn, "for rel, state := range baseline")
	if guard < 0 {
		t.Fatal("applyAlwaysLocal must return immediately when no always-local rules are configured")
	}
	if loop < 0 || guard > loop {
		t.Fatal("empty-policy guard must run before the baseline scan")
	}
}
