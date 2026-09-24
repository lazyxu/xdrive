package mount

import "testing"

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
