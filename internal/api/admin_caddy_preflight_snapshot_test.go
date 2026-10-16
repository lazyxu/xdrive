package api

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestCaddyPreflightSnapshotRejectsChangedRevisionOrCiphertext(t *testing.T) {
	original := caddyPreflightSnapshot{
		Desired: adminCaddyHTTPSDesired{
			Revision: 7,
			Enabled:  true,
			Domain:   "photos.example.com",
		},
		Credential: meta.AdminServiceSecret{
			Revision:   11,
			Enabled:    true,
			KeyVersion: 2,
			Ciphertext: []byte("encrypted-example"),
		},
		CredentialExists: true,
	}
	tests := []struct {
		name   string
		change func(*caddyPreflightSnapshot)
		same   bool
	}{
		{"same", func(_ *caddyPreflightSnapshot) {}, true},
		{"desired revision", func(s *caddyPreflightSnapshot) { s.Desired.Revision++ }, false},
		{"desired enabled", func(s *caddyPreflightSnapshot) { s.Desired.Enabled = false }, false},
		{"desired hostname", func(s *caddyPreflightSnapshot) { s.Desired.Domain = "other.example.com" }, false},
		{"credential appeared or disappeared", func(s *caddyPreflightSnapshot) { s.CredentialExists = false }, false},
		{"credential revision", func(s *caddyPreflightSnapshot) { s.Credential.Revision++ }, false},
		{"credential enabled", func(s *caddyPreflightSnapshot) { s.Credential.Enabled = false }, false},
		{"keyring revision", func(s *caddyPreflightSnapshot) { s.Credential.KeyVersion++ }, false},
		{"ciphertext changed", func(s *caddyPreflightSnapshot) { s.Credential.Ciphertext[0] ^= 1 }, false},
		{"ciphertext length changed", func(s *caddyPreflightSnapshot) { s.Credential.Ciphertext = nil }, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			other := original
			other.Credential.Ciphertext = append([]byte(nil), original.Credential.Ciphertext...)
			tc.change(&other)
			if same := sameCaddyPreflightSnapshot(original, other); same != tc.same {
				t.Fatalf("same snapshot = %v, want %v", same, tc.same)
			}
		})
	}
}
