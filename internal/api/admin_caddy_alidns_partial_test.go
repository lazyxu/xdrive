package api

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestCaddyAliDNSSingleFieldRotationKeepsEncryptedCounterpart(t *testing.T) {
	ring, err := connectorsecret.NewKeyring(1, map[uint32]string{1: strings.Repeat("ba", 32)})
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{ConnectorSecrets: ring}
	const id = "LTAISampleID1234"
	const secret = "sample-secret-12345678"
	version, sealed, err := server.sealCaddyAliDNSChange(meta.AdminServiceSecret{}, id, secret)
	if err != nil {
		t.Fatal(err)
	}
	row := meta.AdminServiceSecret{Enabled: true, KeyVersion: version, Ciphertext: sealed}
	for _, tc := range []struct{ id, secret, wantID, wantSecret string }{
		{"LTAINewID123456", "", "LTAINewID123456", secret},
		{"", "replacement-secret-12345", id, "replacement-secret-12345"},
	} {
		v, ciphertext, err := server.sealCaddyAliDNSChange(row, tc.id, tc.secret)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(ciphertext), tc.wantSecret) {
			t.Fatal("plaintext persisted")
		}
		plaintext, err := ring.Open(caddyAliDNSSecretAADID, caddyAliDNSSecretKind, v, ciphertext)
		if err != nil {
			t.Fatal(err)
		}
		var result caddyAliDNSSecretPair
		err = json.Unmarshal(plaintext, &result)
		clear(plaintext)
		if err != nil || result.AccessKeyID != tc.wantID || result.AccessKeySecret != tc.wantSecret {
			t.Fatal("single-field update replaced the counterpart")
		}
	}
	for _, tc := range []struct {
		row        meta.AdminServiceSecret
		id, secret string
	}{
		{meta.AdminServiceSecret{}, "", "only-new-secret-1234"},
		{meta.AdminServiceSecret{}, "LTAIAnotherID1234", ""},
		{row, "", ""},
		{row, "bad", ""},
		{row, "", "has spaces! not allowed"},
	} {
		if _, _, err := server.sealCaddyAliDNSChange(tc.row, tc.id, tc.secret); err == nil {
			t.Fatal("invalid or missing counterpart accepted")
		}
	}
	if _, _, err := server.sealCaddyAliDNSChange(meta.AdminServiceSecret{}, "", secret); !errors.Is(err, errCaddyAliDNSNotConfigured) {
		t.Fatalf("missing prior secret: %v", err)
	}
}
