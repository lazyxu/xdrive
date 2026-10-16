package photointelligence

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// PhotoModelPermitV1 is a NOT-YET-DEPLOYED cross-language wire claim schema.
// Signing this claim DOES NOT prove a PostgreSQL admission lease. Future
// integration must bind issuance to a live, heartbeating, shared SQL session
// and an immutable expected-server membership epoch before use in inference.
type PhotoModelPermitV1 struct {
	Version         int    `json:"version"`
	DeploymentEpoch string `json:"deployment_epoch"`
	ServerID        string `json:"server_id"`
	ModelID         string `json:"model_id"`
	Revision        int64  `json:"revision"`
	Nonce           string `json:"nonce"`
	IssuedAt        int64  `json:"issued_at"`
	ExpiresAt       int64  `json:"expires_at"`
	Method          string `json:"method"`
	Path            string `json:"path"`
	BodySHA256      string `json:"body_sha256"`
}

var (
	permitHex32 = regexp.MustCompile(`^[0-9a-f]{32}$`)
	permitHex64 = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

func photoModelPermitRouteAllowed(method, path string) bool {
	switch method {
	case "GET":
		switch path {
		case "/v1/face-detector-canary", "/v1/smart-model-canary",
			"/v1/semantic-image-canary", "/v1/creative-cutout-canary":
			return true
		}
	case "POST":
		switch path {
		case "/v1/analyze", "/v1/smart-analyze", "/v1/semantic-image",
			"/v1/semantic-text", "/v1/creative-generate":
			return true
		}
	}
	return false
}

// SignPhotoModelPermitV1 produces only a canonical MAC for future integration;
// there is intentionally NO handler/header signer connected in this phase.
func SignPhotoModelPermitV1(keyHex string, c PhotoModelPermitV1) (string, error) {
	if !permitHex64.MatchString(keyHex) {
		return "", errors.New("model permit key format invalid")
	}
	if c.Version != 1 || c.Revision <= 0 || c.Revision >= 1<<60 ||
		!permitHex32.MatchString(c.DeploymentEpoch) ||
		!permitHex32.MatchString(c.ServerID) ||
		!permitHex32.MatchString(c.ModelID) ||
		!permitHex32.MatchString(c.Nonce) ||
		!permitHex64.MatchString(c.BodySHA256) ||
		c.IssuedAt < 0 || c.ExpiresAt <= c.IssuedAt ||
		c.ExpiresAt-c.IssuedAt > 30 ||
		!photoModelPermitRouteAllowed(c.Method, c.Path) {
		return "", errors.New("model permit claim invalid")
	}
	empty := sha256.Sum256(nil)
	if c.Method == "GET" && c.BodySHA256 != hex.EncodeToString(empty[:]) {
		return "", errors.New("model permit GET body must be empty")
	}
	key, err := hex.DecodeString(keyHex)
	if err != nil {
		return "", err
	}
	parts := []string{
		"xdrive.photo.model-permit.v1", strconv.Itoa(c.Version),
		c.DeploymentEpoch, c.ServerID, c.ModelID,
		strconv.FormatInt(c.Revision, 10), c.Nonce,
		strconv.FormatInt(c.IssuedAt, 10), strconv.FormatInt(c.ExpiresAt, 10),
		c.Method, c.Path, c.BodySHA256,
	}
	mac := hmac.New(sha256.New, key)
	if _, err := mac.Write([]byte(strings.Join(parts, "\n") + "\n")); err != nil {
		return "", fmt.Errorf("model permit MAC unavailable: %w", err)
	}
	return hex.EncodeToString(mac.Sum(nil)), nil
}
