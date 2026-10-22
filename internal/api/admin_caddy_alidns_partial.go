package api

import (
	"encoding/json"
	"errors"

	"github.com/lazyxu/xdrive/internal/meta"
)

// A single AliDNS field can rotate without revealing the other saved field
// to an administrator's browser. Empty means unchanged; deleting the pair
// requires the existing explicit, audited "clear" operation.
var errCaddyAliDNSInvalidPartial = errors.New("invalid AliDNS partial credential change")

func validCaddyAliDNSChange(id, secret string) bool {
	return (id != "" || secret != "") &&
		(id == "" || validCaddyAliDNSCredential(id, 8, 128)) &&
		(secret == "" || validCaddyAliDNSCredential(secret, 8, 256))
}

// Call only under the existing row lock and revision/Host-Pending CAS fences.
// Old ciphertext is decrypted in-process and never included in an API DTO.
func (s *Server) sealCaddyAliDNSChange(
	previous meta.AdminServiceSecret, id, secret string,
) (uint32, []byte, error) {
	if s == nil || s.ConnectorSecrets == nil {
		return 0, nil, errors.New("AliDNS encryption unavailable")
	}
	if !validCaddyAliDNSChange(id, secret) {
		return 0, nil, errCaddyAliDNSInvalidPartial
	}
	pair := caddyAliDNSSecretPair{AccessKeyID: id, AccessKeySecret: secret}
	if id == "" || secret == "" {
		if !previous.Enabled || previous.KeyVersion == 0 || len(previous.Ciphertext) == 0 {
			return 0, nil, errCaddyAliDNSNotConfigured
		}
		original, err := s.ConnectorSecrets.Open(
			caddyAliDNSSecretAADID, caddyAliDNSSecretKind,
			previous.KeyVersion, previous.Ciphertext)
		if err != nil {
			return 0, nil, err
		}
		var saved caddyAliDNSSecretPair
		err = json.Unmarshal(original, &saved)
		clear(original)
		if err != nil || !validCaddyAliDNSPair(saved) {
			return 0, nil, errors.New("stored AliDNS credential invalid")
		}
		if id == "" {
			pair.AccessKeyID = saved.AccessKeyID
		}
		if secret == "" {
			pair.AccessKeySecret = saved.AccessKeySecret
		}
	}
	if !validCaddyAliDNSPair(pair) {
		return 0, nil, errCaddyAliDNSInvalidPartial
	}
	plaintext, err := json.Marshal(pair)
	if err != nil {
		return 0, nil, err
	}
	version, ciphertext, err := s.ConnectorSecrets.Seal(
		caddyAliDNSSecretAADID, caddyAliDNSSecretKind, plaintext)
	clear(plaintext)
	return version, ciphertext, err
}
