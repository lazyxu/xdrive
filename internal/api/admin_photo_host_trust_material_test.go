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
	if state := photoHostTrustMaterialObservation("", ""); state != "unverified" {
		t.Fatalf("absent deployment material cannot prove readiness: %q", state)
	}
	if state := photoHostTrustMaterialObservation("/not-a-photo-trust-file", ""); state != "blocked" {
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
	if state := photoHostTrustMaterialObservation(path, pin); state != "material-only" {
		t.Fatalf("matching file is only local material evidence: %q", state)
	}
	if state := photoHostTrustMaterialObservation(path, strings.Repeat("f", 64)); state != "blocked" {
		t.Fatalf("wrong pin accepted: %q", state)
	}
	if state := photoHostTrustMaterialObservation(path+"-missing", pin); state != "blocked" {
		t.Fatalf("missing bundle accepted: %q", state)
	}
	report := adminPhotoHostPreflightDTO{TrustMaterialObservation: "material-only"}
	raw, err := json.Marshal(report)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "\"trust_material_observation\":\"material-only\"") ||
		strings.Contains(string(raw), pin) || strings.Contains(string(raw), path) ||
		strings.Contains(string(raw), strings.Repeat("b", 64)) {
		t.Fatalf("preflight must not reveal operator path, pins or public key material: %q", raw)
	}
}
