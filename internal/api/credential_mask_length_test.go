package api

import (
	"strings"
	"testing"
)

func TestCredentialMaskLengthCountsUnicodeCharactersAndRejectsInvalid(t *testing.T) {
	for _, tc := range []struct {
		value string
		want  int
	}{
		{"", 0},
		{"LTAIExample", 11},
		{"a🔐密", 3},
		{strings.Repeat("a", maxCredentialMaskLength), maxCredentialMaskLength},
		{strings.Repeat("a", maxCredentialMaskLength+1), 0},
	} {
		if got := credentialMaskLength(tc.value); got != tc.want {
			t.Fatalf("credentialMaskLength(%d bytes) = %d, want %d", len(tc.value), got, tc.want)
		}
	}
}
