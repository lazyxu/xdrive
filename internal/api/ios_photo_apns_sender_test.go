package api

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"encoding/asn1"
	"math/big"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

type iosPhotoAPNSTestTransport func(*http.Request) (*http.Response, error)
func (f iosPhotoAPNSTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestIOSPhotoAPNSEndpointAndUnsignedWakePayload(t *testing.T) {
	token := strings.Repeat("ab", 32)
	development, err := iosPhotoAPNSEndpoint("development", token)
	if err != nil || development != "https://api.sandbox.push.apple.com/3/device/"+token {
		t.Fatalf("sandbox APNs endpoint: %s %v", development, err)
	}
	production, err := iosPhotoAPNSEndpoint("production", token)
	if err != nil || production != "https://api.push.apple.com/3/device/"+token {
		t.Fatalf("production APNs endpoint: %s %v", production, err)
	}
	if _, err := iosPhotoAPNSEndpoint("http://bad-host", token); err == nil {
		t.Fatal("untrusted APNs endpoint accepted")
	}
	req, err := newIOSPhotoAPNSWakeRequest(context.Background(), production, "stub-jwt")
	if err != nil { t.Fatal(err) }
	for k, v := range map[string]string{
		"apns-push-type": "background", "apns-priority": "5",
		"apns-topic": iosPhotoAPNSTopic, "apns-expiration": "0",
	} {
		if req.Header.Get(k) != v { t.Fatalf("%s: got %q", k, req.Header.Get(k)) }
	}
	data, err := io.ReadAll(req.Body)
	if err != nil { t.Fatal(err) }
	if string(data) != iosPhotoAPNSPayloadJSON { t.Fatal("unexpected silent push payload") }
	for _, forbidden := range []string{"owner_id", "device_id", "grant_secret", "photo_local_id", "node_id", "access_token"} {
		if strings.Contains(string(data), forbidden) {
			t.Fatalf("sensitive or unauthorized field %q appeared in APNs payload", forbidden)
		}
	}
}

func TestIOSPhotoAPNSJWTES256RawSignature(t *testing.T) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil { t.Fatal(err) }
	p := iosPhotoAPNSProvider{key: key, keyID:"A1B2C3D4E5",teamID:"Z9Y8X7W6V5"}
	now := time.Unix(1780000000, 0)
	jwt, err := p.authorizationJWT(now)
	if err != nil { t.Fatal(err) }
	parts := strings.Split(jwt, ".")
	if len(parts) != 3 { t.Fatal("invalid three-part JWT") }
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || len(sig) != 64 { t.Fatal("Apple ES256 requires a 64-byte raw signature") }
	header, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil { t.Fatal(err) }
	var parsedHeader struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	if json.Unmarshal(header, &parsedHeader) != nil ||
		parsedHeader.Alg != "ES256" || parsedHeader.Kid != p.keyID {
		t.Fatal("wrong JOSE header")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil { t.Fatal(err) }
	var claims struct {
		Iss string `json:"iss"`
		Iat int64 `json:"iat"`
	}
	if json.Unmarshal(payload, &claims) != nil ||
		claims.Iss != p.teamID || claims.Iat != now.Unix() {
		t.Fatal("wrong signed Apple provider claims")
	}
	sum := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	// R/S are encoded independently as fixed-width 32-byte big-endian values.
	if !ecdsa.VerifyASN1(&key.PublicKey, sum[:], mustRawToDER(sig)) {
		t.Fatal("invalid Apple provider JWT signature")
	}
}

func mustRawToDER(raw []byte) []byte {
	// Go's cryptographic ASN.1 marshaler supplies a standards-compliant
	// independent verifier for the code's raw JOSE signature.
	type pair struct {
		R *big.Int
		S *big.Int
	}
	der, err := asn1.Marshal(pair{
		R: new(big.Int).SetBytes(raw[:32]),
		S: new(big.Int).SetBytes(raw[32:]),
	})
	if err != nil { panic(err) }
	return der
}

func TestIOSPhotoAPNSResponseRejectsRevokedTokenWithoutRetry(t *testing.T) {
	token := strings.Repeat("ab", 32)
	for _, sample := range []struct {
		status int; reason string; invalid bool; err bool
	}{
		{200, "", false, false},
		{410, "Unregistered", true, false},
		{400, "BadDeviceToken", true, false},
		{400, "DeviceTokenNotForTopic", true, false},
		{403, "InvalidProviderToken", false, true},
		{429, "TooManyRequests", false, true},
		{503, "ServiceUnavailable", false, true},
	} {
		p := iosPhotoAPNSProvider{
			client: &http.Client{Transport: iosPhotoAPNSTestTransport(func(r *http.Request) (*http.Response, error) {
				if r.URL.Host != "api.sandbox.push.apple.com" || r.Method != http.MethodPost {
					t.Fatal("wrong external APNs destination")
				}
				body := ""
				if sample.status != 200 { body = `{"reason":"`+sample.reason+`"}` }
				return &http.Response{
					StatusCode: sample.status,
					Body: io.NopCloser(strings.NewReader(body)),
					Header: make(http.Header),
				}, nil
			})},
		}
		invalid, err := p.sendWake(context.Background(), "development", token, "jwt")
		if invalid != sample.invalid || (err != nil) != sample.err {
			t.Fatalf("status %d reason %s: invalid=%v err=%v",
				sample.status, sample.reason, invalid, err)
		}
	}
}
