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

func TestOptionalHostApplyReceiptFourModelValidation(t *testing.T) {
	validID := "0123456789abcdef01234567"
	for _, tc := range []struct {
		name  string
		check func(*HostApplyReceipt) error
	}{
		{"face", func(v *HostApplyReceipt) error {
			info := testFaceAnalyzerInfo()
			info.HostApplyReceipt = v
			return ValidateFaceAnalyzerInfo(info)
		}},
		{"smart", func(v *HostApplyReceipt) error {
			info := testSmartAnalyzerInfo()
			info.HostApplyReceipt = v
			return ValidateSmartAnalyzerInfo(info)
		}},
		{"semantic", func(v *HostApplyReceipt) error {
			info := testSemanticAnalyzerInfo()
			info.HostApplyReceipt = v
			return ValidateSemanticAnalyzerInfo(info)
		}},
		{"creative", func(v *HostApplyReceipt) error {
			info := testCreativeInfo()
			info.HostApplyReceipt = v
			return ValidateCreativeAnalyzerInfo(info)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.check(nil); err != nil {
				t.Fatalf("old analyzer Info without receipt rejected: %v", err)
			}
			if err := tc.check(&HostApplyReceipt{Revision: 7, RequestID: validID}); err != nil {
				t.Fatalf("valid host receipt rejected: %v", err)
			}
			for _, bad := range []*HostApplyReceipt{
				{Revision: 0, RequestID: validID},
				{Revision: 1 << 60, RequestID: validID},
				{Revision: 7, RequestID: "raw-client-token"},
				{Revision: 7, RequestID: strings.ToUpper(validID)},
				{Revision: 7, RequestID: strings.Repeat("a", 23)},
			} {
				if err := tc.check(bad); err == nil {
					t.Fatalf("untrusted host receipt accepted: %+v", bad)
				}
			}
		})
	}
}
