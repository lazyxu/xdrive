package connectorsecret

import (
	"crypto/rand"
	"fmt"
	"io"
	"strconv"
)

// Share capabilities reuse the versioned encryption keyring with a separate
// AEAD associated-data domain. They cannot be substituted for connector data.
func shareTokenAAD(id uint64, version uint32) []byte {
	return []byte("xdrive-share-capability-v1\x00" +
		strconv.FormatUint(id, 10) + "\x00" +
		strconv.FormatUint(uint64(version), 10))
}

func (k *Keyring) SealShareToken(id uint64, token []byte) (uint32, []byte, error) {
	if k == nil || id == 0 || len(token) == 0 {
		return 0, nil, fmt.Errorf("share capability encryption unavailable")
	}
	aead := k.keys[k.active]
	nonce := make([]byte, aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return 0, nil, err
	}
	ciphertext := append([]byte(nil), nonce...)
	ciphertext = aead.Seal(ciphertext, nonce, token, shareTokenAAD(id, k.active))
	return k.active, ciphertext, nil
}

func (k *Keyring) OpenShareToken(id uint64, version uint32, ciphertext []byte) ([]byte, error) {
	if k == nil || id == 0 {
		return nil, fmt.Errorf("share capability decryption unavailable")
	}
	aead, found := k.keys[version]
	if !found {
		return nil, fmt.Errorf("share capability encryption key version unavailable")
	}
	n := aead.NonceSize()
	if len(ciphertext) < n+aead.Overhead() {
		return nil, fmt.Errorf("share capability ciphertext is truncated")
	}
	plaintext, err := aead.Open(nil, ciphertext[:n], ciphertext[n:], shareTokenAAD(id, version))
	if err != nil {
		return nil, fmt.Errorf("share capability decryption failed: %w", err)
	}
	return plaintext, nil
}
