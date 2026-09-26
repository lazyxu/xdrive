package connectorsecret

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
)

type Keyring struct {
	active uint32
	keys   map[uint32]cipher.AEAD
}

func NewKeyring(active uint32, keyHex map[uint32]string) (*Keyring, error) {
	if active == 0 {
		return nil, fmt.Errorf("connector secret active version must be positive")
	}
	if len(keyHex) == 0 {
		return nil, fmt.Errorf("connector secret keyring is empty")
	}
	keys := make(map[uint32]cipher.AEAD, len(keyHex))
	for version, raw := range keyHex {
		if version == 0 {
			return nil, fmt.Errorf("connector secret key version must be positive")
		}
		key, err := hex.DecodeString(strings.TrimSpace(raw))
		if err != nil || len(key) != 32 {
			return nil, fmt.Errorf("connector secret key version %d must be exactly 32 bytes encoded as 64 hex characters", version)
		}
		block, err := aes.NewCipher(key)
		if err != nil {
			return nil, err
		}
		aead, err := cipher.NewGCM(block)
		if err != nil {
			return nil, err
		}
		keys[version] = aead
	}
	if _, ok := keys[active]; !ok {
		return nil, fmt.Errorf("connector secret active version %d is not present in keyring", active)
	}
	return &Keyring{active: active, keys: keys}, nil
}

func ParseKeyring(activeRaw, keysRaw, legacyKey string) (*Keyring, error) {
	activeRaw = strings.TrimSpace(activeRaw)
	keysRaw = strings.TrimSpace(keysRaw)
	legacyKey = strings.TrimSpace(legacyKey)

	if keysRaw == "" {
		if legacyKey == "" {
			if activeRaw != "" {
				return nil, fmt.Errorf("connector secret active version is set but no connector keys are configured")
			}
			return nil, nil
		}
		active := uint32(1)
		if activeRaw != "" {
			value, err := strconv.ParseUint(activeRaw, 10, 32)
			if err != nil || value != 1 {
				return nil, fmt.Errorf("legacy XD_CONNECTOR_SECRET_KEY requires active version 1")
			}
		}
		return NewKeyring(active, map[uint32]string{1: legacyKey})
	}

	keys := map[uint32]string{}
	for _, entry := range strings.Split(keysRaw, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		parts := strings.SplitN(entry, ":", 2)
		if len(parts) != 2 {
			return nil, fmt.Errorf("connector keyring entry %q must use VERSION:HEX", entry)
		}
		version64, err := strconv.ParseUint(strings.TrimSpace(parts[0]), 10, 32)
		if err != nil || version64 == 0 {
			return nil, fmt.Errorf("invalid connector secret key version %q", parts[0])
		}
		version := uint32(version64)
		if _, exists := keys[version]; exists {
			return nil, fmt.Errorf("duplicate connector secret key version %d", version)
		}
		keys[version] = strings.TrimSpace(parts[1])
	}
	if len(keys) == 0 {
		return nil, fmt.Errorf("connector secret keyring is empty")
	}

	active := uint32(0)
	if activeRaw == "" {
		if len(keys) != 1 {
			return nil, fmt.Errorf("XD_CONNECTOR_SECRET_ACTIVE_VERSION is required when multiple connector keys are configured")
		}
		for version := range keys {
			active = version
		}
	} else {
		value, err := strconv.ParseUint(activeRaw, 10, 32)
		if err != nil || value == 0 {
			return nil, fmt.Errorf("invalid XD_CONNECTOR_SECRET_ACTIVE_VERSION %q", activeRaw)
		}
		active = uint32(value)
	}

	if legacyKey != "" {
		v1, ok := keys[1]
		if !ok {
			return nil, fmt.Errorf("legacy XD_CONNECTOR_SECRET_KEY is set but keyring version 1 is absent; remove the legacy variable after migration")
		}
		if !strings.EqualFold(strings.TrimSpace(v1), legacyKey) {
			return nil, fmt.Errorf("legacy XD_CONNECTOR_SECRET_KEY does not match keyring version 1")
		}
	}
	return NewKeyring(active, keys)
}

func (k *Keyring) ActiveVersion() uint32 {
	if k == nil {
		return 0
	}
	return k.active
}

func (k *Keyring) Versions() []uint32 {
	if k == nil {
		return nil
	}
	out := make([]uint32, 0, len(k.keys))
	for version := range k.keys {
		out = append(out, version)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

func (k *Keyring) Seal(sourceID uint64, kind string, plaintext []byte) (uint32, []byte, error) {
	if k == nil {
		return 0, nil, fmt.Errorf("connector secret keyring is unavailable")
	}
	aead := k.keys[k.active]
	if sourceID == 0 || strings.TrimSpace(kind) == "" {
		return 0, nil, fmt.Errorf("source id and kind are required")
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return 0, nil, err
	}
	out := make([]byte, 0, len(nonce)+len(plaintext)+aead.Overhead())
	out = append(out, nonce...)
	out = aead.Seal(out, nonce, plaintext, associatedData(sourceID, kind, k.active))
	return k.active, out, nil
}

func (k *Keyring) Open(sourceID uint64, kind string, version uint32, ciphertext []byte) ([]byte, error) {
	if k == nil {
		return nil, fmt.Errorf("connector secret keyring is unavailable")
	}
	aead, ok := k.keys[version]
	if !ok {
		return nil, fmt.Errorf("connector secret key version %d is not configured", version)
	}
	if sourceID == 0 || strings.TrimSpace(kind) == "" {
		return nil, fmt.Errorf("source id and kind are required")
	}
	nonceSize := aead.NonceSize()
	if len(ciphertext) < nonceSize+aead.Overhead() {
		return nil, fmt.Errorf("connector credential ciphertext is truncated")
	}
	plaintext, err := aead.Open(nil, ciphertext[:nonceSize], ciphertext[nonceSize:], associatedData(sourceID, kind, version))
	if err != nil {
		return nil, fmt.Errorf("decrypt connector credential: %w", err)
	}
	return plaintext, nil
}

func associatedData(sourceID uint64, kind string, version uint32) []byte {
	return []byte("xdrive-source-credential\x00" +
		strconv.FormatUint(sourceID, 10) + "\x00" +
		strings.TrimSpace(kind) + "\x00" +
		strconv.FormatUint(uint64(version), 10))
}
