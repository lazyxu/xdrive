package api

import (
	"context"
	"crypto/ed25519"
	"crypto/subtle"
	"encoding/binary"
	"time"
)

const (
	baiduGeoconvEvidenceFormat byte = 1
	baiduGeoconvEvidenceDomain      = "xdrive/baidu-geoconv/account-entitlement/v1\x00"
	baiduGeoconvEvidenceMaxAge      = 5 * time.Minute
	// No independently reviewed production signing authority is installed.
	// A test-generated key or administrative toggle MUST NOT unlock Geoconv.
	baiduGeoconvPinnedOperatorPublicKey = ""
)

// This PRIVATE envelope binds a proposed reviewed account entitlement to a
// precise Owner session and CURRENT encrypted Server AK revision. Its digest
// identifies independently held operator evidence, not the document itself.
// The evidence cannot be inferred from an AK, admin intent, HTTP request or
// synthetic tests; signing alone is NOT proof that Baidu granted a licence.
// Only an independently authenticated Server source may supply expected scope.
type baiduGeoconvAccountEvidenceScope struct {
	OwnerID          uint64
	SessionVersion   uint64
	ServerAKRevision uint64
	EvidenceRevision uint64
	EvidenceSHA256   [32]byte
	MinuteCaps       baiduGeoconvQuotaLimits
	CadenceCaps      baiduGeoconvCadenceCaps
}

type baiduGeoconvAccountEvidenceProof struct {
	Format      byte
	Scope       baiduGeoconvAccountEvidenceScope
	IssuedUnix  int64
	ExpiresUnix int64
	Signature   [ed25519.SignatureSize]byte
}

func validBaiduGeoconvAccountEvidenceScope(s baiduGeoconvAccountEvidenceScope) bool {
	var zero [32]byte
	m, c := s.MinuteCaps, s.CadenceCaps
	return s.OwnerID > 0 && s.OwnerID <= baiduGeoconvQuotaMaxOwnerID &&
		s.SessionVersion > 0 && s.ServerAKRevision > 0 && s.EvidenceRevision > 0 &&
		subtle.ConstantTimeCompare(s.EvidenceSHA256[:], zero[:]) != 1 &&
		m.OwnerRequests >= 1 && m.OwnerRequests <= baiduGeoconvOwnerRequestsPerMinute &&
		m.FleetRequests >= m.OwnerRequests && m.FleetRequests <= baiduGeoconvFleetRequestsPerMinute &&
		m.OwnerPoints >= 1 && m.OwnerPoints <= baiduGeoconvOwnerPointsPerMinute &&
		m.FleetPoints >= m.OwnerPoints && m.FleetPoints <= baiduGeoconvFleetPointsPerMinute &&
		c.OwnerSecond >= 1 && c.OwnerSecond <= baiduGeoconvOwnerSecondRequests &&
		c.FleetSecond >= c.OwnerSecond && c.FleetSecond <= baiduGeoconvFleetSecondRequests &&
		c.OwnerDay >= 1 && c.OwnerDay <= baiduGeoconvOwnerDayRequests &&
		c.FleetDay >= c.OwnerDay && c.FleetDay <= baiduGeoconvFleetDayRequests
}

// Canonical, domain-separated and fixed-width: no JSON aliases, locale,
// unsigned query fields or variable-length credential values can be signed.
// AK, evidence documents, hostnames, Owner photos and GPS are NEVER embedded.
func baiduGeoconvAccountEvidenceMessage(p baiduGeoconvAccountEvidenceProof) []byte {
	b := make([]byte, 0, len(baiduGeoconvEvidenceDomain)+1+32+14*8)
	b = append(b, baiduGeoconvEvidenceDomain...)
	b = append(b, p.Format)
	add := func(n uint64) {
		var buf [8]byte
		binary.BigEndian.PutUint64(buf[:], n)
		b = append(b, buf[:]...)
	}
	s := p.Scope
	add(s.OwnerID)
	add(s.SessionVersion)
	add(s.ServerAKRevision)
	add(s.EvidenceRevision)
	b = append(b, s.EvidenceSHA256[:]...)
	add(uint64(s.MinuteCaps.OwnerRequests))
	add(uint64(s.MinuteCaps.FleetRequests))
	add(uint64(s.MinuteCaps.OwnerPoints))
	add(uint64(s.MinuteCaps.FleetPoints))
	add(uint64(s.CadenceCaps.OwnerSecond))
	add(uint64(s.CadenceCaps.FleetSecond))
	add(uint64(s.CadenceCaps.OwnerDay))
	add(uint64(s.CadenceCaps.FleetDay))
	add(uint64(p.IssuedUnix))
	add(uint64(p.ExpiresUnix))
	return b
}

// Testable cryptographic PRIMITIVE only. The caller must independently fetch
// the CURRENT trusted account scope, credential revision, active Owner session
// and real provider terms, then enforce LOWER signed limits atomically in the
// PostgreSQL fleet+Owner second/minute/day reservations before any egress.
// No runtime caller, signer, trusted production pin or public endpoint exists.
func verifyBaiduGeoconvAccountEvidence(
	ctx context.Context, p baiduGeoconvAccountEvidenceProof,
	trustedKey ed25519.PublicKey, expected baiduGeoconvAccountEvidenceScope, now time.Time,
) error {
	denied := errBaiduGeoconvDispatchUnavailable
	if ctx == nil || ctx.Err() != nil || len(trustedKey) != ed25519.PublicKeySize ||
		now.IsZero() || now.Unix() <= 0 || p.Format != baiduGeoconvEvidenceFormat ||
		!validBaiduGeoconvAccountEvidenceScope(expected) ||
		!validBaiduGeoconvAccountEvidenceScope(p.Scope) ||
		p.Scope != expected || p.IssuedUnix <= 0 ||
		p.ExpiresUnix <= p.IssuedUnix ||
		p.ExpiresUnix-p.IssuedUnix > int64(baiduGeoconvEvidenceMaxAge/time.Second) ||
		now.Unix() < p.IssuedUnix || now.Unix() >= p.ExpiresUnix {
		return denied
	}
	msg := baiduGeoconvAccountEvidenceMessage(p)
	defer clear(msg)
	if !ed25519.Verify(trustedKey, msg, p.Signature[:]) || ctx.Err() != nil {
		return denied
	}
	return nil
}

// This is the ONLY production-facing evidence gate. It is intentionally hard
// closed: no pinned, independently reviewed operator signing key, provider
// terms or live authoritative evidence source has been installed. Admin AK
// saving, a fixture signature, or a caller-provided public key cannot open it.
func verifyPinnedBaiduGeoconvAccountEvidence(
	_ context.Context, _ baiduGeoconvAccountEvidenceProof,
	_ baiduGeoconvAccountEvidenceScope, _ time.Time,
) error {
	if baiduGeoconvPinnedOperatorPublicKey == "" {
		return errBaiduGeoconvDispatchUnavailable
	}
	return errBaiduGeoconvDispatchUnavailable
}
