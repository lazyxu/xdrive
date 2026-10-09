package localpush

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/secretstore"
)

func deviceSecretKey(server, account, deviceID string) (string, error) {
	if strings.TrimSpace(server) == "" || strings.TrimSpace(account) == "" {
		return "", errors.New("device credential account scope is required")
	}
	parsed, err := uuid.Parse(deviceID)
	if err != nil {
		return "", fmt.Errorf("invalid device ID: %w", err)
	}
	sum := sha256.Sum256([]byte(server + "\x00" + account + "\x00" + parsed.String()))
	return "local-device-" + hex.EncodeToString(sum[:16]), nil
}

func validDeviceToken(token string) bool {
	raw, err := base64.RawURLEncoding.DecodeString(token)
	return err == nil && len(raw) == 32
}

// SaveDeviceToken uses the existing xDrive OS credential backend (DPAPI on
// Windows, Secret Service on Linux where available). It is never written into
// the local Root grant JSON or surfaced to the renderer.
func SaveDeviceToken(configDir, server, account, deviceID, token string) error {
	if !validDeviceToken(token) {
		return errors.New("invalid local device enrollment token")
	}
	key, err := deviceSecretKey(server, account, deviceID)
	if err != nil {
		return err
	}
	return secretstore.Save(configDir, key, "xDrive local device", secretstore.Credentials{
		OpaquePayload: token,
	})
}

func LoadDeviceToken(configDir, server, account, deviceID string) (string, error) {
	key, err := deviceSecretKey(server, account, deviceID)
	if err != nil {
		return "", err
	}
	creds, err := secretstore.Load(configDir, key)
	if err != nil {
		return "", err
	}
	if !validDeviceToken(creds.OpaquePayload) {
		return "", errors.New("stored device enrollment token is invalid")
	}
	return creds.OpaquePayload, nil
}

func DeleteDeviceToken(configDir, server, account, deviceID string) error {
	key, err := deviceSecretKey(server, account, deviceID)
	if err != nil {
		return err
	}
	return secretstore.Delete(configDir, key)
}
