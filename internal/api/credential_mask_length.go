package api

import (
	"encoding/json"
	"unicode/utf8"

	"github.com/lazyxu/xdrive/internal/meta"
)

// Character counts are authorized configuration metadata. The UI must never
// treat them or the display-only stars as a saved credential draft.
const maxCredentialMaskLength = 1 << 16

func credentialMaskLength(value string) int {
	n := utf8.RuneCountInString(value)
	if n < 1 || n > maxCredentialMaskLength {
		return 0
	}
	return n
}

func (s *Server) adminSecretMaskLength(row meta.AdminServiceSecret, aadID uint64, kind string) int {
	if s == nil || s.ConnectorSecrets == nil || len(row.Ciphertext) == 0 {
		return 0
	}
	plain, err := s.ConnectorSecrets.Open(aadID, kind, row.KeyVersion, row.Ciphertext)
	if err != nil {
		return 0
	}
	n := utf8.RuneCount(plain)
	clear(plain)
	if n < 1 || n > maxCredentialMaskLength {
		return 0
	}
	return n
}

func (s *Server) caddyAliDNSMaskLengths(row meta.AdminServiceSecret) (int, int) {
	if s == nil || s.ConnectorSecrets == nil || len(row.Ciphertext) == 0 {
		return 0, 0
	}
	plain, err := s.ConnectorSecrets.Open(caddyAliDNSSecretAADID, caddyAliDNSSecretKind, row.KeyVersion, row.Ciphertext)
	if err != nil {
		return 0, 0
	}
	var pair caddyAliDNSSecretPair
	err = json.Unmarshal(plain, &pair)
	clear(plain)
	if err != nil || !validCaddyAliDNSPair(pair) {
		return 0, 0
	}
	return credentialMaskLength(pair.AccessKeyID), credentialMaskLength(pair.AccessKeySecret)
}

func (s *Server) sourceCredentialMaskLength(source meta.Source, row meta.SourceCredential) int {
	if s == nil || s.ConnectorSecrets == nil || len(row.Ciphertext) == 0 {
		return 0
	}
	plain, err := s.ConnectorSecrets.Open(source.ID, source.Kind, row.KeyVersion, row.Ciphertext)
	if err != nil {
		return 0
	}
	_, value, err := sourceCredentialRevealValue(source.Kind, plain)
	clear(plain)
	if err != nil {
		return 0
	}
	return credentialMaskLength(value)
}
