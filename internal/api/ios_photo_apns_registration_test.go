package api

import (
	"strings"
	"testing"
)

func TestIOSPhotoAPNSTokenValidation(t *testing.T) {
	valid := strings.Repeat("ab", 32)
	for _, token := range []string{
		valid, strings.Repeat("ab", 16), strings.Repeat("01", 200),
	} {
		if !validIOSPhotoAPNSToken(token) {
			t.Errorf("expected valid bounded APNs token length %d", len(token))
		}
	}
	for _, token := range []string{
		"", "token", strings.Repeat("a", 31), strings.Repeat("ab", 15),
		strings.Repeat("ab", 257), strings.Repeat("AB", 32),
		strings.Repeat("xx", 32), strings.Repeat("ab", 32) + "f",
	} {
		if validIOSPhotoAPNSToken(token) {
			t.Errorf("invalid APNs token accepted (length %d)", len(token))
		}
	}
	if !validIOSPhotoAPNSEnvironment("development") ||
		!validIOSPhotoAPNSEnvironment("production") {
		t.Fatal("valid Apple APNs environments rejected")
	}
	for _, environment := range []string{
		"", "sandbox", "prod", "PRODUCTION", "https://api.push.apple.com",
	} {
		if validIOSPhotoAPNSEnvironment(environment) {
			t.Errorf("unrecognized APNs environment %q accepted", environment)
		}
	}
}
