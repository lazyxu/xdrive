package localpush

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
)

var ErrDeviceNotRegistered = errors.New("local device is not registered")

type deviceRegistration struct {
	Server   string `json:"server"`
	Account  string `json:"account"`
	DeviceID string `json:"device_id"`
}

func deviceRegistrationFile(configDir, server, account string) (string, error) {
	if strings.TrimSpace(configDir) == "" || strings.TrimSpace(server) == "" || strings.TrimSpace(account) == "" {
		return "", errors.New("local device registration scope required")
	}
	sum := sha256.Sum256([]byte(server + "\x00" + account))
	return filepath.Join(configDir, "localpush", hex.EncodeToString(sum[:16]), "device.json"), nil
}

func LoadDeviceRegistration(configDir, server, account string) (string, error) {
	path, err := deviceRegistrationFile(configDir, server, account)
	if err != nil {
		return "", err
	}
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return "", ErrDeviceNotRegistered
	}
	if err != nil {
		return "", err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, 4097))
	if err != nil {
		return "", err
	}
	if len(data) > 4096 {
		return "", errors.New("device registration metadata is too large")
	}
	var record deviceRegistration
	if err := json.Unmarshal(data, &record); err != nil {
		return "", err
	}
	if record.Server != server || record.Account != account {
		return "", errors.New("device registration does not match account and server")
	}
	parsed, err := uuid.Parse(record.DeviceID)
	if err != nil {
		return "", fmt.Errorf("invalid persisted device ID: %w", err)
	}
	return parsed.String(), nil
}

func SaveDeviceRegistration(configDir, server, account, deviceID string) error {
	parsed, err := uuid.Parse(deviceID)
	if err != nil {
		return err
	}
	path, err := deviceRegistrationFile(configDir, server, account)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	if _, err := os.Lstat(path); err == nil {
		return errors.New("local device registration already exists")
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	data, err := json.Marshal(deviceRegistration{Server: server, Account: account, DeviceID: parsed.String()})
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".device-registration-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		return err
	}
	return os.Chmod(path, 0o600)
}

// EnsureDevice enforces a single installation identity per Server and account.
// Callers must serialize it per Agent process. A missing secret is an error:
// never silently enroll a replacement while an existing device is registered.
func EnsureDevice(ctx context.Context, configDir, server, account, name, platform, version string, cli *client.Client) (string, string, error) {
	deviceID, err := LoadDeviceRegistration(configDir, server, account)
	if err == nil {
		token, loadErr := LoadDeviceToken(configDir, server, account, deviceID)
		return deviceID, token, loadErr
	}
	if !errors.Is(err, ErrDeviceNotRegistered) {
		return "", "", err
	}
	enrolled, err := cli.RegisterClientDevice(ctx, name, platform, version)
	if err != nil {
		return "", "", err
	}
	if _, err := uuid.Parse(enrolled.Device.ID); err != nil {
		return "", "", fmt.Errorf("server returned invalid device ID: %w", err)
	}
	if !validDeviceToken(enrolled.DeviceToken) {
		return "", "", errors.New("server returned invalid one-time device credential")
	}
	if err := SaveDeviceToken(configDir, server, account, enrolled.Device.ID, enrolled.DeviceToken); err != nil {
		return "", "", fmt.Errorf("persist device credential: %w", err)
	}
	if err := SaveDeviceRegistration(configDir, server, account, enrolled.Device.ID); err != nil {
		_ = DeleteDeviceToken(configDir, server, account, enrolled.Device.ID)
		return "", "", fmt.Errorf("persist device registration: %w", err)
	}
	return enrolled.Device.ID, enrolled.DeviceToken, nil
}
