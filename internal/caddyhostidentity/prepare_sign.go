package caddyhostidentity

import (
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"time"
)

// preparedHostProbeEnvelope is deliberately package-private: neither an
// administrator request nor an unverified Host/DB hint may create a signing
// authority. A future trusted Host collector MUST set both observed flags only
// after independently collecting real positive or negative ingress evidence.
//
// These flags are NOT independent proof by themselves. This file implements
// cryptographic framing only, not the collector, negative observer, adoption
// authorization, Caddy Apply, or an Applied Receipt.
type preparedHostProbeEnvelope struct {
	manifest            Manifest
	domainProbeObserved bool
	lanProbeObserved    bool
}

// signPreparedHostProbe signs the canonical private Host JSON+LF protocol
// using the established, read-only, domain-separated verifier contract.
// Its output is sensitive Host-only evidence. No private key is read from or
// handed to an HTTP client, Server API, database, or log by this function.
//
// The function is intentionally unexported until a real independently
// verified Host producer exists. A signed caller assertion, even if accepted
// by the verifier, is NOT operational evidence or adoption authority.
func signPreparedHostProbe(e preparedHostProbeEnvelope, private ed25519.PrivateKey, now time.Time) ([]byte, []byte, error) {
	fail := func() ([]byte, []byte, error) { return nil, nil, errUntrusted }
	if !e.domainProbeObserved || !e.lanProbeObserved ||
		len(private) != ed25519.PrivateKeySize || now.IsZero() {
		return fail()
	}
	public, ok := private.Public().(ed25519.PublicKey)
	if !ok || len(public) != ed25519.PublicKeySize {
		return fail()
	}
	der, err := x509.MarshalPKIXPublicKey(public)
	if err != nil || len(der) != 44 {
		return fail()
	}
	raw, err := json.Marshal(e.manifest)
	if err != nil {
		return fail()
	}
	raw = append(raw, '\n')
	if len(raw) < 2 || len(raw) > maxManifestSize {
		clear(raw)
		return fail()
	}
	signature := ed25519.Sign(private, append([]byte(signatureDomain), raw...))
	keySHA := sha256.Sum256(der)
	_, err = VerifyReadOnly(raw, signature, public, hex.EncodeToString(keySHA[:]),
		e.manifest.HostID, e.manifest.ServerID, now)
	if err != nil {
		clear(raw)
		clear(signature)
		return fail()
	}
	return raw, signature, nil
}
