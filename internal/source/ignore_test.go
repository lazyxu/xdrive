package source

import "testing"

func TestIgnoreMatcherGitignoreStyle(t *testing.T) {
	m, err := CompileIgnoreRules(`
# comment
@eaDir/
\#recycle/
*.tmp
/private/**
Screenshots/**
!Screenshots/Important/**
`)
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		path    string
		ignored bool
	}{
		{"photo/@eaDir/thumb.jpg", true},
		{"#recycle/old.jpg", true},
		{"nested/cache.tmp", true},
		{"private/a.jpg", true},
		{"nested/private/a.jpg", false},
		{"Screenshots/a.jpg", true},
		{"Screenshots/Important/a.jpg", false},
		{"Screenshots/Important/deep/a.jpg", false},
		{"DCIM/a.jpg", false},
	}
	for _, tt := range tests {
		if got := m.Ignored(tt.path, false); got != tt.ignored {
			t.Fatalf("Ignored(%q)=%t want %t", tt.path, got, tt.ignored)
		}
	}
}

func TestIgnoreDirectoryRuleDoesNotMatchSameNamedFile(t *testing.T) {
	m, err := CompileIgnoreRules("docs/\n")
	if err != nil {
		t.Fatal(err)
	}
	if m.Ignored("docs", false) {
		t.Fatal("directory-only rule matched a same-named file")
	}
	if !m.Ignored("docs", true) {
		t.Fatal("directory-only rule did not match the directory")
	}
	if !m.Ignored("docs/a.jpg", false) {
		t.Fatal("directory-only rule did not match a descendant")
	}
}

func TestIgnoreMatcherDoubleStarAndQuestion(t *testing.T) {
	m, err := CompileIgnoreRules("cache/**/thumb?.jpg\n")
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{"cache/thumb1.jpg", "cache/a/thumb2.jpg", "cache/a/b/thumbX.jpg"} {
		if !m.Ignored(p, false) {
			t.Fatalf("%q should be ignored", p)
		}
	}
	if m.Ignored("other/cache/a/thumb1.jpg", false) {
		t.Fatal("slash-containing pattern unexpectedly matched below another root")
	}
}

func TestIgnoreRulesValidation(t *testing.T) {
	if _, err := CompileIgnoreRules("!\n"); err == nil {
		t.Fatal("empty negation was accepted")
	}
	if _, err := CompileIgnoreRules("../secret\n"); err == nil {
		t.Fatal("escaping rule was accepted")
	}
	if _, err := NormalizeRelativePath("/absolute"); err == nil {
		t.Fatal("absolute source path was accepted")
	}
	if got, err := NormalizeRelativePath(`a\b\c.jpg`); err != nil || got != "a/b/c.jpg" {
		t.Fatalf("normalized path=%q err=%v", got, err)
	}
}
