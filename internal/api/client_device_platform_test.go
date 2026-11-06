package api

import (
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestSynologyClientDeviceIsIdentityOnly(t *testing.T) {
	const token = "synology-identity-token-with-enough-entropy"
	device := meta.ClientDevice{
		ID:             "b3e7e94e-17a4-4b0d-a02b-2e6f5c11a9f2",
		Platform:       "synology",
		CredentialHash: deviceCredentialDigest(token),
	}
	if !validClientPlatform("synology") {
		t.Fatal("Synology platform was not accepted for device enrollment")
	}
	if !clientDeviceIdentityCredentialMatches(device, token) {
		t.Fatal("valid Synology identity token was rejected")
	}
	if clientDeviceCredentialMatches(device, token) {
		t.Fatal("Synology identity-only credential was promoted to Desktop Agent authority")
	}
	if clientDeviceIdentityCredentialMatches(device, strings.Repeat("x", 31)) {
		t.Fatal("short identity token was accepted")
	}
}
