//go:build windows

package secretstore

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	crypt32                = windows.NewLazySystemDLL("crypt32.dll")
	kernel32               = windows.NewLazySystemDLL("kernel32.dll")
	procCryptProtectData   = crypt32.NewProc("CryptProtectData")
	procCryptUnprotectData = crypt32.NewProc("CryptUnprotectData")
	procLocalFree          = kernel32.NewProc("LocalFree")
)

const cryptProtectUIForbidden = 0x1

type dataBlob struct {
	Size uint32
	Data *byte
}

func Save(configDir, sessionID, _ string, creds Credentials) error {
	if err := validateSessionID(sessionID); err != nil {
		return err
	}
	plain, err := marshalCredentials(creds)
	if err != nil {
		return err
	}
	protected, err := protect(plain, entropy(sessionID))
	if err != nil {
		return err
	}
	path := filepath.Join(credentialDir(configDir), sessionID+".dpapi")
	if err := writeAtomic(path, protected); err != nil {
		return err
	}
	_ = deleteFallback(configDir, sessionID)
	return nil
}

func Load(configDir, sessionID string) (Credentials, error) {
	if err := validateSessionID(sessionID); err != nil {
		return Credentials{}, err
	}
	path := filepath.Join(credentialDir(configDir), sessionID+".dpapi")
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return loadFallback(configDir, sessionID)
		}
		return Credentials{}, err
	}
	plain, err := unprotect(data, entropy(sessionID))
	if err != nil {
		return Credentials{}, fmt.Errorf("decrypt DPAPI credential: %w", err)
	}
	return unmarshalCredentials(plain)
}

func Delete(configDir, sessionID string) error {
	if err := validateSessionID(sessionID); err != nil {
		return err
	}
	path := filepath.Join(credentialDir(configDir), sessionID+".dpapi")
	var errs []error
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		errs = append(errs, err)
	}
	if err := deleteFallback(configDir, sessionID); err != nil {
		errs = append(errs, err)
	}
	return errors.Join(errs...)
}

func Backend(configDir, sessionID string) string {
	path := filepath.Join(credentialDir(configDir), sessionID+".dpapi")
	if _, err := os.Stat(path); err == nil {
		return "windows-dpapi"
	}
	return "unavailable"
}

func entropy(sessionID string) []byte {
	sum := sha256.Sum256([]byte("xdrive-credential:" + sessionID))
	return sum[:]
}

func protect(plain, entropy []byte) ([]byte, error) {
	in := blobFromBytes(plain)
	ent := blobFromBytes(entropy)
	var out dataBlob
	r, _, callErr := procCryptProtectData.Call(
		uintptr(unsafe.Pointer(&in)),
		0,
		uintptr(unsafe.Pointer(&ent)),
		0,
		0,
		cryptProtectUIForbidden,
		uintptr(unsafe.Pointer(&out)),
	)
	if r == 0 {
		return nil, fmt.Errorf("CryptProtectData: %w", callErr)
	}
	defer procLocalFree.Call(uintptr(unsafe.Pointer(out.Data)))
	return copyBlob(out), nil
}

func unprotect(ciphertext, entropy []byte) ([]byte, error) {
	in := blobFromBytes(ciphertext)
	ent := blobFromBytes(entropy)
	var out dataBlob
	r, _, callErr := procCryptUnprotectData.Call(
		uintptr(unsafe.Pointer(&in)),
		0,
		uintptr(unsafe.Pointer(&ent)),
		0,
		0,
		cryptProtectUIForbidden,
		uintptr(unsafe.Pointer(&out)),
	)
	if r == 0 {
		return nil, fmt.Errorf("CryptUnprotectData: %w", callErr)
	}
	defer procLocalFree.Call(uintptr(unsafe.Pointer(out.Data)))
	return copyBlob(out), nil
}

func blobFromBytes(data []byte) dataBlob {
	if len(data) == 0 {
		return dataBlob{}
	}
	return dataBlob{Size: uint32(len(data)), Data: &data[0]}
}

func copyBlob(blob dataBlob) []byte {
	if blob.Size == 0 || blob.Data == nil {
		return nil
	}
	src := unsafe.Slice(blob.Data, int(blob.Size))
	out := make([]byte, len(src))
	copy(out, src)
	return out
}
