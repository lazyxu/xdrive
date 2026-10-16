package photointelligence

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

func TestPhotoModelPermitV1CrossLanguageGolden(t *testing.T) {
	body := []byte(`{"text":"hello"}`)
	sum := sha256.Sum256(body)
	claims := PhotoModelPermitV1{
		Version:         1,
		DeploymentEpoch: "0123456789abcdef0123456789abcdef",
		ServerID:        strings.Repeat("1", 32),
		ModelID:         strings.Repeat("2", 32),
		Revision:        17,
		Nonce:           strings.Repeat("3", 32),
		IssuedAt:        1700000000,
		ExpiresAt:       1700000020,
		Method:          "POST",
		Path:            "/v1/semantic-text",
		BodySHA256:      hex.EncodeToString(sum[:]),
	}
	mac, err := SignPhotoModelPermitV1(strings.Repeat("ab", 32), claims)
	const want = "2dfe4e035ef32e2ff7d947a9ffdfd4b8df07a869bce49818bed232866f00b2ce"
	if err != nil || mac != want {
		t.Fatalf("cross-language Photo permit mismatch; mac=%q err=%v", mac, err)
	}
	for _, bad := range []PhotoModelPermitV1{
		func() PhotoModelPermitV1 { c := claims; c.Version = 2; return c }(),
		func() PhotoModelPermitV1 { c := claims; c.Revision = 0; return c }(),
		func() PhotoModelPermitV1 { c := claims; c.ExpiresAt += 31; return c }(),
		func() PhotoModelPermitV1 { c := claims; c.Method = "DELETE"; return c }(),
		func() PhotoModelPermitV1 { c := claims; c.Path = "/v1/info"; return c }(),
		func() PhotoModelPermitV1 { c := claims; c.Nonce = strings.Repeat("Z", 32); return c }(),
	} {
		if _, err := SignPhotoModelPermitV1(strings.Repeat("ab", 32), bad); err == nil {
			t.Fatalf("invalid permit accepted: %+v", bad)
		}
	}
	if _, err := SignPhotoModelPermitV1("", claims); err == nil {
		t.Fatal("empty MAC key accepted")
	}
	get := claims
	get.Method, get.Path = "GET", "/v1/smart-model-canary"
	empty := sha256.Sum256(nil)
	get.BodySHA256 = hex.EncodeToString(empty[:])
	if _, err := SignPhotoModelPermitV1(strings.Repeat("ab", 32), get); err != nil {
		t.Fatalf("fixed canary GET admission format rejected: %v", err)
	}
}
