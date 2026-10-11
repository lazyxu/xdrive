package api

import "strings"

// Only ASCII DNS hostnames may be staged for future Caddy HTTPS configuration.
// Excludes ports, schemes, paths, wildcards, local IP literals and host flags.
// Domain is validated again by the eventual Host Manager before any apply.
func validCaddyHTTPSDomain(domain string) bool {
	if len(domain) < 4 || len(domain) > 253 || domain != strings.TrimSpace(domain) {
		return false
	}
	labels := strings.Split(domain, ".")
	if len(labels) < 2 {
		return false
	}
	for _, label := range labels {
		if len(label) == 0 || len(label) > 63 {
			return false
		}
		for i := 0; i < len(label); i++ {
			b := label[i]
			letter := b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z'
			digit := b >= '0' && b <= '9'
			if !letter && !digit && (b != '-' || i == 0 || i == len(label)-1) {
				return false
			}
		}
	}
	tld := labels[len(labels)-1]
	if len(tld) < 2 {
		return false
	}
	for i := 0; i < len(tld); i++ {
		if !(tld[i] >= 'a' && tld[i] <= 'z' || tld[i] >= 'A' && tld[i] <= 'Z') {
			return false
		}
	}
	return true
}
