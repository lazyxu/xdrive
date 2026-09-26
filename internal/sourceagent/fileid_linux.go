//go:build linux

package sourceagent

import (
	"fmt"
	"os"
	"syscall"
)

func fileExternalID(rootKey string, info os.FileInfo) (string, error) {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat == nil {
		return "", fmt.Errorf("filesystem identity is unavailable")
	}
	return fmt.Sprintf("fs:%s:%d:%d", rootKey, uint64(stat.Dev), uint64(stat.Ino)), nil
}
