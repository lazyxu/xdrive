package source

import "testing"

func TestFailureCategoryStablePriority(t *testing.T) {
	cases := []struct {
		text string
		want string
	}{
		{"HTTP 429 connection throttled", "rate_limit"},
		{"DSM forbidden HTTP 403", "permission"},
		{"upload source changed after hashing", "source_changed"},
		{"revision conflict", "conflict"},
		{"connection reset by peer", "network"},
		{"unknown upstream result", "other"},
		{"", "other"},
	}
	for _, tt := range cases {
		if got := FailureCategory(tt.text); got != tt.want {
			t.Errorf("FailureCategory(%q)=%q, want %q", tt.text, got, tt.want)
		}
	}
}
