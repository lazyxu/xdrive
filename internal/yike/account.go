package yike

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

func AccountConcurrencyKey(cookie string) string {
	cookie = strings.TrimSpace(cookie)
	if cookie == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(cookie))
	return "yike:" + hex.EncodeToString(sum[:])
}
