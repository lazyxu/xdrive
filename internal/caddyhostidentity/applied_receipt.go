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
	"time"
)

const appliedDomain = "xdrive.caddy.applied-receipt.v1\n"
const (
	appliedPositive = "enabled-local-tls-verified"
	appliedNegative = "disabled-local-negative-verified"
)

var errAppliedUntrusted = errors.New("untrusted or incomplete signed Caddy Applied receipt")

// AppliedReceipt is an internal, time-bounded Host Collector attestation,
// never a browser DTO or an authorization to execute Docker.
type AppliedReceipt struct {
	CollectorID   string `json:"collector_id_sha256"`
	ConfigSHA     string `json:"live_config_sha256"`
	DomainState   string `json:"domain_state"`
	DomainProof   string `json:"domain_proof_sha256"`
	EnvSHA        string `json:"env_sha256"`
	ExpiresAt     string `json:"expires_at"`
	GenerationSHA string `json:"generation_sha256"`
	HostID        string `json:"host_identity_sha256"`
	LANState      string `json:"lan_state"`
	LANProof      string `json:"lan_proof_sha256"`
	Nonce         string `json:"nonce"`
	ObservedAt    string `json:"observed_at"`
	OperationID   string `json:"operation_id"`
	Schema        int    `json:"schema"`
	Scope         string `json:"scope"`
	ServerID      string `json:"server_identity_sha256"`
}

// AppliedPins must come from operator-owned, out-of-band trust configuration,
// never from the signed message, a browser request, or PostgreSQL Desired.
type AppliedPins struct {
	PublicKeyDER_SHA256 string
	CollectorID         string
	HostID              string
	ServerID            string
	OperationID         string
	EnvSHA              string
	GenerationSHA       string
	ConfigSHA           string
}

// VerifyAppliedReceipt verifies the canonical Host statement AND consumes its
// nonce via a trusted caller-supplied, durable, atomic anti-replay operation.
// A nil consumer or a consumer error fails closed. This does not obtain local
// ingress evidence itself or assert continuous/WAN/terminal-CA reachability.
func VerifyAppliedReceipt(raw, sig, publicDER []byte, pins AppliedPins,
	now time.Time, consumeNonce func(string) error) (AppliedReceipt, error) {
	var receipt AppliedReceipt
	if len(raw) < 2 || len(raw) > 4096 || len(sig) != ed25519.SignatureSize ||
		len(publicDER) == 0 || consumeNonce == nil {
		return receipt, errAppliedUntrusted
	}
	for _, s := range []string{pins.PublicKeyDER_SHA256, pins.CollectorID,
		pins.HostID, pins.ServerID, pins.EnvSHA, pins.GenerationSHA, pins.ConfigSHA} {
		if !validDigest(s) {
			return receipt, errAppliedUntrusted
		}
	}
	if err := json.Unmarshal(raw, &receipt); err != nil {
		return AppliedReceipt{}, errAppliedUntrusted
	}
	canonical, err := json.Marshal(receipt)
	if err != nil || !bytes.Equal(canonical, raw) {
		return AppliedReceipt{}, errAppliedUntrusted
	}
	if receipt.Schema != 1 || receipt.Scope != "xdrive.caddy.applied-receipt.v1" ||
		receipt.CollectorID != pins.CollectorID || receipt.HostID != pins.HostID ||
		receipt.ServerID != pins.ServerID || receipt.OperationID != pins.OperationID ||
		receipt.EnvSHA != pins.EnvSHA || receipt.GenerationSHA != pins.GenerationSHA ||
		receipt.ConfigSHA != pins.ConfigSHA || !validDigest(receipt.DomainProof) ||
		!validDigest(receipt.LANProof) || len(receipt.OperationID) != 24 ||
		len(receipt.Nonce) != 32 {
		return AppliedReceipt{}, errAppliedUntrusted
	}
	for _, c := range receipt.OperationID + receipt.Nonce {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return AppliedReceipt{}, errAppliedUntrusted
		}
	}
	if receipt.DomainState != appliedPositive && receipt.DomainState != appliedNegative ||
		receipt.LANState != appliedPositive && receipt.LANState != appliedNegative ||
		(receipt.DomainState == appliedNegative && receipt.LANState == appliedNegative) {
		return AppliedReceipt{}, errAppliedUntrusted
	}
	start, ok := utcCanonical(receipt.ObservedAt)
	if !ok {
		return AppliedReceipt{}, errAppliedUntrusted
	}
	end, ok := utcCanonical(receipt.ExpiresAt)
	if !ok || end.Before(start) || end.Sub(start) > 30*time.Second ||
		start.After(now.Add(5*time.Second)) || !now.Before(end) {
		return AppliedReceipt{}, errAppliedUntrusted
	}
	sum := sha256.Sum256(publicDER)
	if subtle.ConstantTimeCompare([]byte(hex.EncodeToString(sum[:])),
		[]byte(pins.PublicKeyDER_SHA256)) != 1 {
		return AppliedReceipt{}, errAppliedUntrusted
	}
	key, err := x509.ParsePKIXPublicKey(publicDER)
	pub, ok := key.(ed25519.PublicKey)
	if err != nil || !ok ||
		!ed25519.Verify(pub, append([]byte(appliedDomain), raw...), sig) {
		return AppliedReceipt{}, errAppliedUntrusted
	}
	if err := consumeNonce(receipt.Nonce); err != nil {
		return AppliedReceipt{}, errAppliedUntrusted
	}
	return receipt, nil
}
