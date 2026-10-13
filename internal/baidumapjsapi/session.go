package baidumapjsapi

// A3b2c provides a version- and revocation-fenced, map-only session contract.
// These helpers are NOT HTTP routes. Issuers/verifiers must first consult
// current trusted Server/DB state on *every* map resource request. In
// particular, a saved Browser AK never proves RuntimeAuthorized.

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"net/http"
	"strings"
	"time"
)

const (
	MapCookieName          = "XD_BMAP_SESSION"
	MapCookiePath          = "/_BMapService/"
	MapSessionTTL          = 2 * time.Minute
	MapMaxSessionTTL       = 5 * time.Minute
	mapSessionFormat       = 1
	mapSessionPayloadBytes = 1 + 6*8 + 16
	mapCookieMaxBytes      = 512
)

var ErrMapSessionDenied = errors.New("map-only session unavailable")

// MapSessionState MUST be populated from the authenticated user record and
// current, audited JSAPI runtime configuration. RevocationEpoch must be
// durable and monotonically incremented when a map session is revoked or an
// auth logout invalidates existing map sessions; a missing epoch is not safe.
// All values are trusted Server data, never taken from query/headers/cookies.
type MapSessionState struct {
	OwnerID               uint64
	SessionVersion        uint64
	ConfigurationRevision uint64
	RevocationEpoch       uint64
	AccountActive         bool
	RuntimeAuthorized     bool
}

func validMapState(s MapSessionState) bool {
	return s.OwnerID != 0 && s.SessionVersion != 0 && s.ConfigurationRevision != 0 &&
		s.RevocationEpoch != 0 && s.AccountActive && s.RuntimeAuthorized
}

func mapCipher(secret []byte) (cipher.AEAD, error) {
	if len(secret) < 32 {
		return nil, ErrMapSessionDenied
	}
	// Separately keyed cryptographic domain, independent of bearer/refresh JWT.
	seed := append([]byte("xdrive/baidu-jsapi-v4/map-session/v1\x00"), secret...)
	key := sha256.Sum256(seed)
	clear(seed)
	block, err := aes.NewCipher(key[:])
	clear(key[:])
	if err != nil {
		return nil, ErrMapSessionDenied
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, ErrMapSessionDenied
	}
	return gcm, nil
}

var mapAAD = []byte("xdrive.baidumap.jsapi4.private.session.v1")

// IssueMapSession returns only a Secure HttpOnly host-only cookie; its opaque
// value contains no raw AK or bearer token. It must never be logged or sent
// through Electron IPC / URL query strings / public Server responses.
func IssueMapSession(secret []byte, state MapSessionState, now time.Time) (*http.Cookie, error) {
	if !validMapState(state) || now.IsZero() || now.UnixNano() < 0 {
		return nil, ErrMapSessionDenied
	}
	gcm, err := mapCipher(secret)
	if err != nil {
		return nil, err
	}
	data := make([]byte, mapSessionPayloadBytes)
	data[0] = mapSessionFormat
	v := []uint64{state.OwnerID, state.SessionVersion, state.ConfigurationRevision,
		state.RevocationEpoch, uint64(now.UnixNano()), uint64(now.Add(MapSessionTTL).UnixNano())}
	for i, x := range v {
		binary.BigEndian.PutUint64(data[1+i*8:1+(i+1)*8], x)
	}
	if _, err := rand.Read(data[1+6*8:]); err != nil {
		return nil, ErrMapSessionDenied
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, ErrMapSessionDenied
	}
	ciphertext := gcm.Seal(nil, nonce, data, mapAAD)
	clear(data)
	token := base64.RawURLEncoding.EncodeToString(append(nonce, ciphertext...))
	if len(token) > mapCookieMaxBytes {
		return nil, ErrMapSessionDenied
	}
	return &http.Cookie{
		Name: MapCookieName, Value: token, Path: MapCookiePath,
		HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode,
		MaxAge: int(MapSessionTTL.Seconds()), Expires: now.Add(MapSessionTTL).UTC(),
	}, nil
}

// VerifyMapSession requires a fresh trusted account/session/revocation/config
// state on every proxied request, not only at cookie issuance. Only the
// resource-specific cookie can pass. No active map runtime => no acceptance.
func VerifyMapSession(secret []byte, cookieValue string, state MapSessionState, now time.Time) error {
	if !validMapState(state) || now.IsZero() || len(cookieValue) < 24 ||
		len(cookieValue) > mapCookieMaxBytes {
		return ErrMapSessionDenied
	}
	gcm, err := mapCipher(secret)
	if err != nil {
		return err
	}
	raw, err := base64.RawURLEncoding.DecodeString(cookieValue)
	if err != nil || len(raw) <= gcm.NonceSize()+gcm.Overhead() {
		return ErrMapSessionDenied
	}
	nonce, ciphertext := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	payload, err := gcm.Open(nil, nonce, ciphertext, mapAAD)
	if err != nil || len(payload) != mapSessionPayloadBytes || payload[0] != mapSessionFormat {
		return ErrMapSessionDenied
	}
	defer clear(payload)
	claims := make([]uint64, 6)
	for i := range claims {
		claims[i] = binary.BigEndian.Uint64(payload[1+i*8 : 1+(i+1)*8])
	}
	// Versions/revisions are compared without early secret-dependent branching;
	// encrypted claims remain invisible to page JS but are not permissions.
	var current [4 * 8]byte
	var embedded [4 * 8]byte
	for i, value := range []uint64{state.OwnerID, state.SessionVersion, state.ConfigurationRevision, state.RevocationEpoch} {
		binary.BigEndian.PutUint64(current[i*8:(i+1)*8], value)
		binary.BigEndian.PutUint64(embedded[i*8:(i+1)*8], claims[i])
	}
	if subtle.ConstantTimeCompare(current[:], embedded[:]) != 1 {
		return ErrMapSessionDenied
	}
	issued, expires := int64(claims[4]), int64(claims[5])
	if issued <= 0 || expires <= issued || expires-issued > int64(MapMaxSessionTTL) ||
		now.UnixNano() < issued || now.UnixNano() >= expires {
		return ErrMapSessionDenied
	}
	return nil
}

// MapSessionRevocationCookie invalidates the browser's cookie; Server must
// independently increment durable RevocationEpoch to stop replay immediately.
func MapSessionRevocationCookie() *http.Cookie {
	return &http.Cookie{
		Name: MapCookieName, Path: MapCookiePath, Value: "",
		HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode,
		MaxAge: -1, Expires: time.Unix(0, 0).UTC(),
	}
}

// SessionBootstrapSameOrigin guards the REST Bearer-authenticated mint request
// against cross-site confusion. It compares Origin to a trusted configured
// HTTPS origin; never resolve origin from forwarded/untrusted Host headers.
func SessionBootstrapSameOrigin(req *http.Request, trustedOrigin string) bool {
	if req == nil || req.Method != http.MethodPost || req.URL == nil ||
		req.URL.Path != "/api/v1/media/places/baidu-jsapi/session" {
		return false
	}
	if _, err := TrustedProxyBase(trustedOrigin); err != nil {
		return false
	}
	if req.Header.Get("Origin") != trustedOrigin {
		return false
	}
	if strings.Contains(req.Header.Get("Origin"), ",") {
		return false
	}
	if site := req.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" {
		return false
	}
	if req.URL.RawQuery != "" || req.Header.Get("Referer") == "null" {
		return false
	}
	return true
}

// SessionResourceRequest only prechecks browser request transport. It does
// NOT replace a strict per-path upstream allowlist or VerifyMapSession.
func SessionResourceRequest(req *http.Request, trustedOrigin string) bool {
	if req == nil || req.Method != http.MethodGet || req.URL == nil ||
		!strings.HasPrefix(req.URL.Path, MapCookiePath) ||
		req.Header.Get("Authorization") != "" {
		return false
	}
	if _, err := TrustedProxyBase(trustedOrigin); err != nil {
		return false
	}
	if origin := req.Header.Get("Origin"); origin != "" && origin != trustedOrigin {
		return false
	}
	if site := req.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" {
		return false
	}
	for key := range req.URL.Query() {
		if strings.EqualFold(key, "ak") || strings.EqualFold(key, "browser_ak") ||
			strings.EqualFold(key, "token") || strings.EqualFold(key, "url") {
			return false
		}
	}
	return true
}
