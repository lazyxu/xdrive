package clipboardcrypto

import (
	"bytes"
	"encoding/base64"
	"testing"
)

func TestWebCryptoFixtureDecryptAndRejectsTampering(t *testing.T) {
	// Exact independent WebCrypto fixture already asserted by Android JVM
	// XDriveClipboardTargetCryptoTest. Do not generate this with our Go code.
	pkcs8, err := base64.StdEncoding.DecodeString(
		"MC4CAQAwBQYDK2VuBCIEIDlLocMMuTDyDVsTd7i6Xb2aZQWnK5SNojI/DcjTIHDf")
	if err != nil || len(pkcs8) != 48 {
		t.Fatalf("bad fixed recipient fixture: %v", err)
	}
	private := append([]byte(nil), pkcs8[16:]...)
	defer clear(private)
	scope := "https://nas.example:12"
	target := "a8d11b3e-eaf7-4a8a-aedb-3c51908c6df2"
	fixture := Envelope{
		ClientEventID:  "12d922e2-7cca-4315-9c98-bd83e679cb90",
		TargetDeviceID: target,
		Kind:           "application/x-xdrive-node-ref",
		NodeID:         118,
		Nonce:          "+fyvZcCVJT9O9uyL",
		Ciphertext:     "e3g43zd96HkSPwOLQrU8NtUrN6dIJkXQ6Q==",
		EphemeralKey:   "LVkKQcvSXWnWgbHgLWCEPLGTWrd8cJNBEncrkUketwY=",
		WrappedKey:     "1y/y0nl6NKA1L6J8lLxTZMZHEtmjjZ0y6SYIwTDZl27EHatdWkCZJNTDUt8J4GiJVT+Fc0Oqi940uisS",
	}
	got, err := Decrypt(scope, target, private, fixture)
	if err != nil || got != "asset:118" {
		t.Fatalf("WebCrypto fixture refused or wrong plaintext: %v, %q", err, got)
	}
	tests := []struct {
		name   string
		mutate func(*Envelope)
	}{
		{"node substitution", func(x *Envelope) { x.NodeID = 119 }},
		{"target substitution", func(x *Envelope) { x.TargetDeviceID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }},
		{"MIME substitution", func(x *Envelope) { x.Kind = "image/x-xdrive-node-ref" }},
		{"event ID substitution", func(x *Envelope) { x.ClientEventID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }},
		{"wrap ciphertext substitution", func(x *Envelope) { x.WrappedKey = base64.StdEncoding.EncodeToString(make([]byte, 60)) }},
		{"wrong nonce", func(x *Envelope) { x.Nonce = base64.StdEncoding.EncodeToString(make([]byte, 12)) }},
		{"broadcast downgrade", func(x *Envelope) { x.TargetDeviceID = "" }},
		{"text carries Node", func(x *Envelope) { x.Kind = "text/plain" }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			modified := fixture
			tc.mutate(&modified)
			if _, err := Decrypt(scope, modified.TargetDeviceID, private, modified); err == nil {
				t.Fatal("tampered device E2EE message decrypted")
			}
		})
	}
	if _, err := Decrypt(scope+":changed", target, private, fixture); err == nil {
		t.Fatal("old Owner cipher decrypted under a new Owner AAD scope")
	}
	if _, err := Decrypt(scope, target, make([]byte, 32), fixture); err == nil {
		t.Fatal("wrong installation private key decrypted")
	}
	if _, err := Decrypt(scope, target, private, fixture); err != nil {
		t.Fatal("failed after negative tests; decryptor mutated original state", err)
	}
}

func TestGenerateDeviceKeyNeverReusesAnInstallationPrivateKey(t *testing.T) {
	firstPrivate, firstPub, err := GenerateDeviceKey()
	if err != nil {
		t.Fatal(err)
	}
	secondPrivate, secondPub, err := GenerateDeviceKey()
	if err != nil {
		t.Fatal(err)
	}
	if len(firstPrivate) != 32 || len(firstPub) != 32 ||
		len(secondPrivate) != 32 || len(secondPub) != 32 ||
		bytes.Equal(firstPrivate, secondPrivate) || bytes.Equal(firstPub, secondPub) {
		t.Fatal("invalid or repeated X25519 installation key")
	}
	clear(firstPrivate)
	clear(secondPrivate)
}
