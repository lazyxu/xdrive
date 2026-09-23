package mount

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
)

func conflictName(name string) string {
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	host, _ := os.Hostname()
	host = sanitizeConflictPart(host)
	if host == "" {
		host = "device"
	}
	stamp := time.Now().Format("20060102-150405.000")
	if len(base) > 120 {
		base = base[:120]
	}
	candidate := fmt.Sprintf("%s (conflict %s %s)%s", base, host, stamp, ext)
	if err := meta.ValidateName(candidate); err == nil {
		return candidate
	}
	return fmt.Sprintf("conflict-%s%s", stamp, ext)
}

func sanitizeConflictPart(s string) string {
	s = strings.TrimSpace(s)
	var b strings.Builder
	for _, r := range s {
		if r < 32 || strings.ContainsRune(`<>:"/\|?*`, r) {
			b.WriteRune('-')
			continue
		}
		b.WriteRune(r)
	}
	return strings.TrimSpace(b.String())
}
