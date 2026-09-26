//go:build !linux

package sourceagent

import (
	"fmt"
	"os"
)

func fileExternalID(rootKey string, info os.FileInfo) (string, error) {
	_ = rootKey
	_ = info
	return "", fmt.Errorf("native source scanning is supported on Linux only")
}

func filesystemIdentity(rootKey, path string, info os.FileInfo, legacyDevice ...uint64) (FilesystemIdentity, error) {
	_ = rootKey
	_ = path
	_ = info
	_ = legacyDevice
	return FilesystemIdentity{}, fmt.Errorf("native source scanning is supported on Linux only")
}

func RootFingerprint(rootKey, rootPath string) (string, error) {
	_ = rootKey
	_ = rootPath
	return "", fmt.Errorf("native source scanning is supported on Linux only")
}
