package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPhotoHostTrustMaterialPreflightIsNegativeOnly(t *testing.T) {
	if state := photoHostTrustMaterialObservation("", "", ""); state != "unverified" {
		t.Fatalf("absent deployment material cannot prove readiness: %q", state)
	}
	if state := photoHostTrustMaterialObservation("/not-a-photo-trust-file", "", ""); state != "blocked" {
		t.Fatalf("partial config must block: %q", state)
	}
	data := "xdrive.photo.trust-anchor.v1\n" + strings.Repeat("a", 32) + "\n" +
		strings.Repeat("b", 64) + "\n12\n1\n" +
		strings.Repeat("1", 32) + " " + strings.Repeat("c", 64) + "\n"
	path := filepath.Join(t.TempDir(), "public-trust")
	if err := os.WriteFile(path, []byte(data), 0400); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256([]byte(data))
	pin := hex.EncodeToString(digest[:])
	rootBytes, err := hex.DecodeString(strings.Repeat("b", 64))
	if err != nil {
		t.Fatal(err)
	}
	rootSum := sha256.Sum256(rootBytes)
	rootPIN := hex.EncodeToString(rootSum[:])
	if state := photoHostTrustMaterialObservation(path, pin, ""); state != "material-only" {
		t.Fatalf("matching file is only local material evidence: %q", state)
	}
	if state := photoHostTrustMaterialObservation(path, pin, rootPIN); state != "root-pin-match-local" {
		t.Fatalf("separately matching operator-key pin rejected: %q", state)
	}
	for name, cfg := range map[string][3]string{
		"operator pin alone":     {"", "", rootPIN},
		"partial operator pair":  {path, "", rootPIN},
		"wrong operator pin":     {path, pin, strings.Repeat("f", 64)},
		"malformed operator pin": {path, pin, "invalid"},
		"uppercase operator pin": {path, pin, strings.ToUpper(rootPIN)},
		"wrong bundle pin":       {path, strings.Repeat("f", 64), rootPIN},
		"missing bundle":         {path + "-missing", pin, rootPIN},
	} {
		t.Run(name, func(t *testing.T) {
			if state := photoHostTrustMaterialObservation(cfg[0], cfg[1], cfg[2]); state != "blocked" {
				t.Fatalf("untrusted local operator root accepted: %q", state)
			}
		})
	}
	report := adminPhotoHostPreflightDTO{TrustMaterialObservation: "root-pin-match-local"}
	raw, err := json.Marshal(report)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "\"trust_material_observation\":\"root-pin-match-local\"") ||
		strings.Contains(string(raw), pin) || strings.Contains(string(raw), rootPIN) ||
		strings.Contains(string(raw), path) || strings.Contains(string(raw), strings.Repeat("b", 64)) {
		t.Fatalf("preflight must not reveal operator path, pins or public key material: %q", raw)
	}
}
