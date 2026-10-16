package api

import "testing"

func TestSourceFailureClassificationIsConservative(t *testing.T) {
	cases := []struct{ message, want string }{
		{"GET: 429 too many requests", sourceFailureRateLimit},
		{"Yike returned 50005", sourceFailureRateLimit},
		{"open file: permission denied", sourceFailurePermission},
		{"file changed after hashing", sourceFailureFileChanged},
		{"destination already exists", sourceFailureConflict},
		{"dial tcp: connection refused", sourceFailureNetwork},
		{"unknown error", sourceFailureOther},
	}
	for _, tc := range cases {
		if got := classifySourceFailureMessage(tc.message); got != tc.want {
			t.Errorf("classify %q = %q, want %q", tc.message, got, tc.want)
		}
	}
	if sourceFailureCategoryOrClassify("network", "an unrelated failure") != "network" {
		t.Fatal("explicit category ignored")
	}
	if validSourceFailureCategory("arbitrary") {
		t.Fatal("accepted arbitrary category")
	}
}
