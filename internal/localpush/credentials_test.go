package localpush

import (
	"encoding/base64"
	"errors"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/secretstore"
)

func TestDeviceTokenUsesScopedExistingCredentialBackend(t *testing.T) {
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")
	configDir := filepath.Join(t.TempDir(), "settings")
	deviceID := uuid.NewString()
	secret := base64.RawURLEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	if err := SaveDeviceToken(configDir, "https://server1.test", "alice", deviceID, secret); err != nil {
		t.Fatal(err)
	}
	if got, err := LoadDeviceToken(configDir, "https://server1.test", "alice", deviceID); err != nil || got != secret {
		t.Fatalf("device credential did not roundtrip: %v", err)
	}
	if _, err := LoadDeviceToken(configDir, "https://server1.test", "bob", deviceID); !errors.Is(err, secretstore.ErrNotFound) {
		t.Fatalf("other account accessed device credential: %v", err)
	}
	if _, err := LoadDeviceToken(configDir, "https://server2.test", "alice", deviceID); !errors.Is(err, secretstore.ErrNotFound) {
		t.Fatalf("other Server accessed device credential: %v", err)
	}
	if err := SaveDeviceToken(configDir, "https://server1.test", "alice", deviceID, "not-a-token"); err == nil {
		t.Fatal("short device credential was accepted")
	}
	if err := DeleteDeviceToken(configDir, "https://server1.test", "alice", deviceID); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadDeviceToken(configDir, "https://server1.test", "alice", deviceID); !errors.Is(err, secretstore.ErrNotFound) {
		t.Fatalf("deleted credential remains accessible: %v", err)
	}
}
