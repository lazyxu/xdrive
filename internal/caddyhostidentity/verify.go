// Package caddyhostidentity validates a short-lived, independently signed
// read-only Caddy running-identity claim. Signature verification alone DOES NOT
// authorize adoption, host execution or an Applied Receipt.
package caddyhostidentity

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/netip"
	"strings"
	"time"
)

const (
	Scope           = "xdrive.caddy.running-identity.read-only.v1"
	signatureDomain = Scope + "\n"
	maxManifestSize = 4096
	maxLifetime     = 45 * time.Second
	maxFutureSkew   = 5 * time.Second
	enabledLocal    = "enabled-local-tls-observed"
	disabledLocal   = "disabled-local-negative-observed"
)

var errUntrusted = errors.New("untrusted or stale Caddy running-identity observation")

// Manifest is a PRIVATE host-to-server claim, NEVER a public/admin API DTO.
// JSON field order is fixed and alphabetical for a canonical signed envelope.
// Probe hashes do not themselves prove how the Host observer made a measurement.
type Manifest struct {
	Domain          string `json:"domain"`
	DomainProbeSHA  string `json:"domain_probe_sha256"`
	DomainState     string `json:"domain_state"`
	ExpiresAt       string `json:"expires_at"`
	HostID          string `json:"host_identity_sha256"`
	InstanceID      string `json:"instance_id_sha256"`
	LANIP           string `json:"lan_ip"`
	LANProbeSHA     string `json:"lan_probe_sha256"`
	LANState        string `json:"lan_state"`
	LiveConfigSHA   string `json:"live_config_sha256"`
	ObservedAt      string `json:"observed_at"`
	Schema          int    `json:"schema"`
	Scope           string `json:"scope"`
	ServerID        string `json:"server_identity_sha256"`
	StartGeneration string `json:"start_generation_sha256"`
}

// VerifiedReadOnly retains NO private witness fields: even fmt.Printf("%+v")
// and fmt.Printf("%#v") must not reveal FQDN/IP, Host IDs or probe hashes.
// This verified signature still does not attest a trustworthy host producer, disabled-ingress proof,
// current SQL revision or independent operator authorization.
type VerifiedReadOnly struct{}

func (VerifiedReadOnly) CandidateComplete() bool { return false }
func (VerifiedReadOnly) CanAdopt() bool          { return false }
func (VerifiedReadOnly) ApplySupported() bool    { return false }

func validDigest(s string) bool {
	if len(s) != 64 || s == strings.Repeat("0", 64) {
		return false
	}
	for _, c := range s {
		decimal := c >= '0' && c <= '9'
		lowerHex := c >= 'a' && c <= 'f'
		if !decimal && !lowerHex {
			return false
		}
	}
	return true
}

func validDomain(s string) bool {
	if len(s) < 4 || len(s) > 253 || strings.TrimSpace(s) != s {
		return false
	}
	labels := strings.Split(s, ".")
	if len(labels) < 2 {
		return false
	}
	for _, label := range labels {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, c := range label {
			letter := c >= 'a' && c <= 'z'
			digit := c >= '0' && c <= '9'
			if !letter && !digit && c != '-' {
				return false
			}
		}
	}
	tld := labels[len(labels)-1]
	if len(tld) < 2 {
		return false
	}
	for _, c := range tld {
		if c < 'a' || c > 'z' {
			return false
		}
	}
	return true
}

func validLANIP(s string) bool {
	ip, err := netip.ParseAddr(s)
	return err == nil && ip.Is4() && ip.IsPrivate() && ip.String() == s
}

func utcCanonical(s string) (time.Time, bool) {
	if !strings.HasSuffix(s, "Z") {
		return time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	return t, err == nil && t.Format(time.RFC3339Nano) == s
}

func validIngress(state, value, proof string, validValue func(string) bool) bool {
	if !validDigest(proof) {
		return false
	}
	switch state {
	case enabledLocal:
		return validValue(value)
	case disabledLocal:
		// "Failed to connect" must NOT be promoted to negative proof by
		// this verifier; it only validates a signed Host claim.
		return value == ""
	default:
		return false
	}
}

// VerifyReadOnly requires an out-of-band pinned Ed25519 SPKI DER key SHA-256,
// expected Host identity and expected Server identity. These MUST originate in
// a trusted operator-owned configuration, never in a browser request, DB
// desired revision, Host-import hint or a key embedded in the manifest.
// The exact canonical ASCII JSON + LF is signed with an explicit domain prefix.
// This helper performs NO file I/O, Host Apply, Docker/DNS or network access.
func VerifyReadOnly(raw, signature []byte, publicKey ed25519.PublicKey,
	expectedKeySHA, expectedHostSHA, expectedServerSHA string,
	now time.Time,
) (VerifiedReadOnly, error) {
	fail := func() (VerifiedReadOnly, error) { return VerifiedReadOnly{}, errUntrusted }
	if len(raw) < 2 || len(raw) > maxManifestSize ||
		len(signature) != ed25519.SignatureSize ||
		len(publicKey) != ed25519.PublicKeySize || now.IsZero() ||
		!validDigest(expectedKeySHA) || !validDigest(expectedHostSHA) ||
		!validDigest(expectedServerSHA) {
		return fail()
	}
	der, errDER := x509.MarshalPKIXPublicKey(publicKey)
	if errDER != nil || len(der) != 44 {
		return fail()
	}
	keySHA := sha256.Sum256(der)
	if subtle.ConstantTimeCompare([]byte(expectedKeySHA),
		[]byte(hex.EncodeToString(keySHA[:]))) != 1 ||
		!ed25519.Verify(publicKey, append([]byte(signatureDomain), raw...), signature) {
		return fail()
	}
	var claim Manifest
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var trailing any
	if decoder.Decode(&claim) != nil || decoder.Decode(&trailing) != io.EOF {
		return fail()
	}
	canonical, err := json.Marshal(claim)
	if err != nil || !bytes.Equal(raw, append(canonical, '\n')) {
		// Includes duplicate keys, reordering, noncanonical escapes,
		// unknown fields, JSON nulls and unbounded extra objects.
		return fail()
	}
	if claim.Schema != 1 || claim.Scope != Scope ||
		!validDigest(claim.HostID) || !validDigest(claim.ServerID) ||
		subtle.ConstantTimeCompare([]byte(claim.HostID), []byte(expectedHostSHA)) != 1 ||
		subtle.ConstantTimeCompare([]byte(claim.ServerID), []byte(expectedServerSHA)) != 1 {
		return fail()
	}
	for _, value := range []string{
		claim.InstanceID, claim.StartGeneration, claim.LiveConfigSHA,
	} {
		if !validDigest(value) {
			return fail()
		}
	}
	if !validIngress(claim.DomainState, claim.Domain,
		claim.DomainProbeSHA, validDomain) ||
		!validIngress(claim.LANState, claim.LANIP,
			claim.LANProbeSHA, validLANIP) ||
		(claim.DomainState == disabledLocal && claim.LANState == disabledLocal) {
		return fail()
	}
	observed, okObserved := utcCanonical(claim.ObservedAt)
	expires, okExpires := utcCanonical(claim.ExpiresAt)
	if !okObserved || !okExpires || !expires.After(observed) ||
		expires.Sub(observed) > maxLifetime ||
		observed.After(now.Add(maxFutureSkew)) ||
		now.Sub(observed) > maxLifetime || !now.Before(expires) {
		return fail()
	}
	return VerifiedReadOnly{}, nil
}
