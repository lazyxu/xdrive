package main

import (
	"context"
	"crypto/ecdh"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"sync"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/clipboardcrypto"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/secretstore"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// Only the owning Agent may load this private material. Browser, renderer
// and DSM CGI receive neither OS device token nor Curve25519 private bytes.
var clipboardDeviceEnrollmentMu sync.Mutex

func clipboardLocalSecretID(server, account, deviceID string) string {
	sum := sha256.Sum256([]byte("xdrive-clipboard-key-v1\x00" + server + "\x00" + account + "\x00" + deviceID))
	return "clipboard-recipient-" + hex.EncodeToString(sum[:16])
}

func clipboardDevicePrivateKey(configDir, server, account, deviceID string) ([]byte, bool, error) {
	record, err := secretstore.Load(configDir, clipboardLocalSecretID(server, account, deviceID))
	if errors.Is(err, secretstore.ErrNotFound) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	raw, err := base64.StdEncoding.Strict().DecodeString(record.OpaquePayload)
	if err != nil || len(raw) != 32 || base64.StdEncoding.EncodeToString(raw) != record.OpaquePayload {
		return nil, false, errors.New("local Clipboard recipient private key invalid")
	}
	if _, err := ecdh.X25519().NewPrivateKey(raw); err != nil {
		clear(raw)
		return nil, false, errors.New("invalid stored Clipboard private key")
	}
	return raw, true, nil
}

func clipboardCurrentAgentSession(cfg userconfig.Config) bool {
	current, err := userconfig.Load()
	return err == nil && !current.SessionInvalid &&
		current.SessionID != "" && current.SessionID == cfg.SessionID &&
		current.Server == cfg.Server && current.Username == cfg.Username
}

func (c *agentController) clipboardOwnerDevice(ctx context.Context) (
	*client.Client, userconfig.Config, string, string, string, error,
) {
	cli, cfg, err := c.cloudClient()
	if err != nil {
		return nil, cfg, "", "", "", err
	}
	if cfg.SessionInvalid || cfg.Server == "" || cfg.Username == "" ||
		cfg.SessionID == "" || !clipboardCurrentAgentSession(cfg) {
		return nil, cfg, "", "", "", errors.New("Clipboard Owner login unavailable")
	}
	configDir, err := userconfig.Dir()
	if err != nil {
		return nil, cfg, "", "", "", err
	}
	// Existing device registration is required. Opening Clipboard must
	// never silently register a new Push, SourceRun or native device.
	deviceID, err := localpush.LoadDeviceRegistration(configDir, cfg.Server, cfg.Username)
	if err != nil {
		return nil, cfg, "", "", "", err
	}
	token, err := localpush.LoadDeviceToken(configDir, cfg.Server, cfg.Username, deviceID)
	if err != nil {
		return nil, cfg, "", "", "", err
	}
	verified, err := cli.VerifyLocalDevice(ctx, deviceID, token)
	if err != nil || verified.DeviceID != deviceID || !clipboardCurrentAgentSession(cfg) {
		return nil, cfg, "", "", "", errors.New("Clipboard Owner/device authorization changed")
	}
	return cli, cfg, configDir, deviceID, token, nil
}

func (c *agentController) CloudClipboardEnableDevice(ctx context.Context) (client.ClipboardDevice, error) {
	clipboardDeviceEnrollmentMu.Lock()
	defer clipboardDeviceEnrollmentMu.Unlock()
	cli, cfg, configDir, deviceID, token, err := c.clipboardOwnerDevice(ctx)
	if err != nil {
		return client.ClipboardDevice{}, err
	}
	private, exists, err := clipboardDevicePrivateKey(configDir, cfg.Server, cfg.Username, deviceID)
	if err != nil {
		return client.ClipboardDevice{}, err
	}
	if !exists {
		var public []byte
		private, public, err = clipboardcrypto.GenerateDeviceKey()
		if err != nil {
			return client.ClipboardDevice{}, err
		}
		// Persist the precise key BEFORE the potentially committed Server
		// enrollment request. A lost ACK must reuse the same public key.
		if err := secretstore.Save(configDir,
			clipboardLocalSecretID(cfg.Server, cfg.Username, deviceID),
			"xDrive Clipboard device recipient",
			secretstore.Credentials{OpaquePayload: base64.StdEncoding.EncodeToString(private)}); err != nil {
			clear(private)
			return client.ClipboardDevice{}, err
		}
		clear(public)
	}
	defer clear(private)
	key, err := ecdh.X25519().NewPrivateKey(private)
	if err != nil {
		return client.ClipboardDevice{}, errors.New("invalid Clipboard installation key")
	}
	publicB64 := base64.StdEncoding.EncodeToString(key.PublicKey().Bytes())
	if !clipboardCurrentAgentSession(cfg) {
		return client.ClipboardDevice{}, errors.New("Clipboard Owner changed before enrollment")
	}
	if err := cli.ClipboardEnrollSelf(ctx, deviceID, token, publicB64); err != nil {
		return client.ClipboardDevice{}, err
	}
	if !clipboardCurrentAgentSession(cfg) {
		return client.ClipboardDevice{}, errors.New("Clipboard Owner changed after enrollment")
	}
	return client.ClipboardDevice{
		DeviceID: deviceID, Name: "This installation",
		Platform: "desktop", PublicKey: publicB64,
	}, nil
}

// Server-side revocation is authoritative; afterwards the owning Agent
// also retires this installation's private key. Other targeted devices are
// never modified by a remote Owner's revocation action.
func clipboardRetireLocalRecipient(cfg userconfig.Config, revokedDeviceID string) error {
	configDir, err := userconfig.Dir()
	if err != nil {
		return err
	}
	localDevice, err := localpush.LoadDeviceRegistration(configDir, cfg.Server, cfg.Username)
	if errors.Is(err, localpush.ErrDeviceNotRegistered) {
		return nil
	}
	if err != nil {
		return err
	}
	if localDevice != revokedDeviceID {
		return nil
	}
	return secretstore.Delete(configDir,
		clipboardLocalSecretID(cfg.Server, cfg.Username, localDevice))
}

// An OS-protected local key is not enough: Server-side Clipboard enrollment
// must remain active for this exact Owner and registered installation.
func clipboardDeviceActive(
	ctx context.Context, cli *client.Client, deviceID string, private []byte,
) (bool, error) {
	key, err := ecdh.X25519().NewPrivateKey(private)
	if err != nil {
		return false, errors.New("invalid local Clipboard key")
	}
	dir, err := cli.ClipboardDevices(ctx)
	if err != nil {
		return false, err
	}
	public := base64.StdEncoding.EncodeToString(key.PublicKey().Bytes())
	for _, device := range dir.Devices {
		if device.DeviceID == deviceID {
			if device.PublicKey != public {
				return false, errors.New("Clipboard public key no longer matches this installation")
			}
			return true, nil
		}
	}
	return false, nil
}

func (c *agentController) clipboardListWithLocalRecipient(
	ctx context.Context, cli *client.Client, cfg userconfig.Config, before uint64,
) (client.ClipboardPage, error) {
	configDir, err := userconfig.Dir()
	if err != nil {
		return client.ClipboardPage{}, err
	}
	deviceID, err := localpush.LoadDeviceRegistration(configDir, cfg.Server, cfg.Username)
	if errors.Is(err, localpush.ErrDeviceNotRegistered) {
		return cli.ClipboardList(ctx, before)
	}
	if err != nil {
		return client.ClipboardPage{}, err
	}
	private, exists, err := clipboardDevicePrivateKey(configDir, cfg.Server, cfg.Username, deviceID)
	if err != nil {
		return client.ClipboardPage{}, err
	}
	if !exists {
		return cli.ClipboardList(ctx, before)
	}
	defer clear(private)
	_, _, _, verifiedID, token, err := c.clipboardOwnerDevice(ctx)
	if err != nil || verifiedID != deviceID {
		return client.ClipboardPage{}, errors.New("Clipboard installation proof unavailable")
	}
	active, err := clipboardDeviceActive(ctx, cli, deviceID, private)
	if err != nil {
		return client.ClipboardPage{}, err
	}
	if !active {
		return client.ClipboardPage{}, errors.New("Clipboard recipient key is not enrolled or was revoked")
	}
	page, err := cli.ClipboardListForDevice(ctx, before, deviceID, token)
	if err != nil || !clipboardCurrentAgentSession(cfg) {
		return client.ClipboardPage{}, errors.New("Clipboard Owner/device mailbox changed")
	}
	return page, nil
}

func (c *agentController) CloudClipboardDecrypt(ctx context.Context, itemID uint64) (string, error) {
	if itemID == 0 {
		return "", errors.New("invalid Clipboard item")
	}
	cli, cfg, configDir, deviceID, token, err := c.clipboardOwnerDevice(ctx)
	if err != nil {
		return "", err
	}
	private, exists, err := clipboardDevicePrivateKey(configDir, cfg.Server, cfg.Username, deviceID)
	if err != nil || !exists {
		return "", errors.New("Clipboard recipient key unavailable")
	}
	defer clear(private)
	active, err := clipboardDeviceActive(ctx, cli, deviceID, private)
	if err != nil || !active {
		return "", errors.New("Clipboard recipient grant revoked")
	}
	// Always re-read the authoritative current mailbox: a renderer/CGI must
	// not supply an arbitrary ciphertext, target, or Owner to decrypt.
	page, err := cli.ClipboardListForDevice(ctx, 0, deviceID, token)
	if err != nil {
		return "", err
	}
	for _, row := range page.Items {
		if row.ID != itemID {
			continue
		}
		if row.TargetDeviceID != deviceID {
			return "", errors.New("Clipboard message not addressed to this device")
		}
		vault, err := cli.ClipboardVault(ctx)
		if err != nil || vault.AADScope == "" || vault.OwnerID == 0 {
			return "", errors.New("Clipboard Owner vault unavailable")
		}
		text, err := clipboardcrypto.Decrypt(vault.AADScope, deviceID, private,
			clipboardcrypto.Envelope{
				ClientEventID: row.ClientEventID, TargetDeviceID: row.TargetDeviceID,
				Kind: row.Kind, NodeID: row.NodeID, EphemeralKey: row.EphemeralKey,
				WrappedKey: row.WrappedKey, Nonce: row.Nonce, Ciphertext: row.Ciphertext,
			})
		if err != nil || !clipboardCurrentAgentSession(cfg) {
			return "", errors.New("Clipboard target decrypt failed or Owner changed")
		}
		// A revocation can commit while this item is being decrypted.
		// Check the live Owner/device grant AGAIN before releasing any
		// plaintext beyond the Agent's private memory.
		activeNow, checkErr := clipboardDeviceActive(ctx, cli, deviceID, private)
		if checkErr != nil || !activeNow || !clipboardCurrentAgentSession(cfg) {
			return "", errors.New("Clipboard recipient permission changed before delivery")
		}
		return text, nil
	}
	return "", errors.New("Clipboard recipient item not in current live mailbox")
}
