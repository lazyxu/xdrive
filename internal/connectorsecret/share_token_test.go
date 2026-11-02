package connectorsecret

import (
    "bytes"
    "strings"
    "testing"
)

// Link ciphertext must never be usable for Source credentials, another Share,
// another key version, or after authenticated corruption.
func TestShareTokenEnvelopeIsolation(t *testing.T) {
    ring, err := NewKeyring(2, map[uint32]string{
        1: strings.Repeat("11", 32),
        2: strings.Repeat("22", 32),
    })
    if err != nil { t.Fatal(err) }
    version, ciphertext, err := ring.SealShareToken(123, []byte("share-secret"))
    if err != nil || version != 2 { t.Fatalf("seal: %v", err) }
    plain, err := ring.OpenShareToken(123, version, ciphertext)
    if err != nil || string(plain) != "share-secret" { t.Fatalf("open: %v", err) }
    if _, err := ring.OpenShareToken(124, version, ciphertext); err == nil {
        t.Fatal("share row substitution accepted")
    }
    if _, err := ring.Open(123, "share", version, ciphertext); err == nil {
        t.Fatal("connector-purpose substitution accepted")
    }
    if _, err := ring.OpenShareToken(123, 1, ciphertext); err == nil {
        t.Fatal("wrong key version accepted")
    }
    corrupted := bytes.Clone(ciphertext)
    corrupted[len(corrupted)-1] ^= 1
    if _, err := ring.OpenShareToken(123, version, corrupted); err == nil {
        t.Fatal("tampered ciphertext accepted")
    }
    if _, _, err := (*Keyring)(nil).SealShareToken(123, []byte("x")); err == nil {
        t.Fatal("nil keyring accepted")
    }
}
