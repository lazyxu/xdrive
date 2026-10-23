//go:build !linux

package api

// Host Caddy Control is Linux-only. Windows/macOS contract tests retain
// the preexisting atomic O_EXCL queue behavior; no Host write is enabled.
func caddyHostAdmissionLock(_ string) (func(), error) {
	return func() {}, nil
}
