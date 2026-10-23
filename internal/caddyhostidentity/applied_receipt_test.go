package caddyhostidentity

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestCaddyAppliedReceiptStrictSignatureAndNonce(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	keyDigest := sha256.Sum256(der)
	digest := func(c string) string { return strings.Repeat(c, 64) }
	now := time.Date(2026, 10, 23, 10, 0, 0, 0, time.UTC)
	pins := AppliedPins{
		PublicKeyDER_SHA256: hex.EncodeToString(keyDigest[:]),
		CollectorID:         digest("a"), HostID: digest("b"),
		ServerID: digest("c"), EnvSHA: digest("d"),
		GenerationSHA: digest("e"), ConfigSHA: digest("f"),
		OperationID: strings.Repeat("1", 24),
	}
	r := AppliedReceipt{
		CollectorID: pins.CollectorID, HostID: pins.HostID, ServerID: pins.ServerID,
		EnvSHA: pins.EnvSHA, GenerationSHA: pins.GenerationSHA, ConfigSHA: pins.ConfigSHA,
		OperationID: pins.OperationID, Nonce: strings.Repeat("2", 32),
		DomainState: appliedPositive, DomainProof: digest("3"),
		LANState: appliedNegative, LANProof: digest("4"),
		ObservedAt: now.Format(time.RFC3339), ExpiresAt: now.Add(20 * time.Second).Format(time.RFC3339),
		Schema: 1, Scope: "xdrive.caddy.applied-receipt.v1",
	}
	good, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	sign := func(raw []byte) []byte {
		return ed25519.Sign(priv, append([]byte(appliedDomain), raw...))
	}
	spent := false
	consume := func(string) error {
		if spent {
			return errors.New("replay")
		}
		spent = true
		return nil
	}
	if _, err := VerifyAppliedReceipt(good, sign(good), der, pins, now, consume); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyAppliedReceipt(good, sign(good), der, pins, now, consume); err == nil {
		t.Fatal("replayed nonce accepted")
	}
	cases := []struct {
		name string
		edit func(*AppliedReceipt)
	}{
		{"unsigned disabled proof", func(v *AppliedReceipt) { v.DomainProof = "" }},
		{"both disabled", func(v *AppliedReceipt) { v.DomainState = appliedNegative }},
		{"different generation", func(v *AppliedReceipt) { v.GenerationSHA = digest("0") }},
		{"different operation", func(v *AppliedReceipt) { v.OperationID = strings.Repeat("6", 24) }},
		{"expired", func(v *AppliedReceipt) { v.ExpiresAt = now.Add(-time.Second).Format(time.RFC3339) }},
		{"overlong lease", func(v *AppliedReceipt) { v.ExpiresAt = now.Add(time.Hour).Format(time.RFC3339) }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			v := r
			tc.edit(&v)
			raw, err := json.Marshal(v)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := VerifyAppliedReceipt(raw, sign(raw), der, pins, now,
				func(string) error { return nil }); err == nil {
				t.Fatal("invalid signed evidence accepted")
			}
		})
	}
	if _, err := VerifyAppliedReceipt(good, sign(good), der, pins, now, nil); err == nil {
		t.Fatal("missing atomic nonce consumer accepted")
	}
	forged := append([]byte(nil), good...)
	forged[len(forged)-2] ^= 1
	if _, err := VerifyAppliedReceipt(forged, sign(good), der, pins, now,
		func(string) error { return nil }); err == nil {
		t.Fatal("tampered receipt accepted")
	}
	extra := append(append([]byte(nil), good[:len(good)-1]...), []byte(`,"authority":true}`)...)
	if _, err := VerifyAppliedReceipt(extra, sign(extra), der, pins, now,
		func(string) error { return nil }); err == nil {
		t.Fatal("additional field accepted")
	}
	wrongPin := pins
	wrongPin.PublicKeyDER_SHA256 = digest("a")
	if _, err := VerifyAppliedReceipt(good, sign(good), der, wrongPin, now,
		func(string) error { return nil }); err == nil {
		t.Fatal("untrusted signing key accepted")
	}
}
