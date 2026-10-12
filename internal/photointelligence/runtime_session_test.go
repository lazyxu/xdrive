package photointelligence

import (
	"strings"
	"testing"
)

func TestInfoRuntimeInstanceIDValidationAndLegacyCompatibility(t *testing.T) {
	cases := []struct {
		name string
		test func(string) error
	}{
		{"face", func(id string) error {
			info := testFaceAnalyzerInfo()
			info.RuntimeInstanceID = id
			return ValidateFaceAnalyzerInfo(info)
		}},
		{"smart", func(id string) error {
			info := testSmartAnalyzerInfo()
			info.RuntimeInstanceID = id
			return ValidateSmartAnalyzerInfo(info)
		}},
		{"semantic", func(id string) error {
			info := testSemanticAnalyzerInfo()
			info.RuntimeInstanceID = id
			return ValidateSemanticAnalyzerInfo(info)
		}},
		{"creative", func(id string) error {
			info := testCreativeInfo()
			info.RuntimeInstanceID = id
			return ValidateCreativeAnalyzerInfo(info)
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			for _, valid := range []string{"", strings.Repeat("a", 32), "0123456789abcdef0123456789abcdef"} {
				if err := tc.test(valid); err != nil {
					t.Fatalf("valid or legacy id rejected: %q: %v", valid, err)
				}
			}
			for _, invalid := range []string{"abc", strings.Repeat("a", 31), strings.Repeat("a", 33),
				strings.Repeat("A", 32), strings.Repeat("g", 32), " " + strings.Repeat("a", 32)} {
				if err := tc.test(invalid); err == nil {
					t.Fatalf("malformed id accepted: %q", invalid)
				}
			}
		})
	}
	if ValidAnalyzerRuntimeInstanceID("") || !ValidAnalyzerRuntimeInstanceID(strings.Repeat("f", 32)) {
		t.Fatal("instance identity format check incorrect")
	}
}
