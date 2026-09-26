package sourceagent

import (
	"strconv"
	"strings"
)

func ParseLegacyRootIdentity(rootKey, value string) (device, inode uint64, ok bool) {
	rootKey = strings.TrimSpace(rootKey)
	parts := strings.Split(strings.TrimSpace(value), ":")
	if rootKey == "" || len(parts) != 4 || parts[0] != "fs" || parts[1] != rootKey {
		return 0, 0, false
	}
	device, err := strconv.ParseUint(parts[2], 10, 64)
	if err != nil {
		return 0, 0, false
	}
	inode, err = strconv.ParseUint(parts[3], 10, 64)
	if err != nil {
		return 0, 0, false
	}
	return device, inode, true
}
