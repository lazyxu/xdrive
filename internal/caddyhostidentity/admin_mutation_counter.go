package caddyhostidentity

import (
	"crypto/sha256"
	"encoding/hex"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const privateMutationMetricsMax = 16 << 10
const privateMutationMetricsMaxLines = 64

// Prometheus client sorts label names. A stable, narrow grammar prevents
// untrusted extra labels, extra-line injection, or hidden mutation sources.
var privateCaddyMutationCounter = regexp.MustCompile(`^caddy_admin_http_requests_total\{code="([0-9]{3})",handler="([a-z_][a-z0-9_]{0,63})",method="(GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE)",path="(/[^"\\]{0,192})"\} ([0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)$`)
var privateCaddyAdminErrorCounter = regexp.MustCompile(`^caddy_admin_http_request_errors_total\{handler="([a-z_][a-z0-9_]{0,63})",method="(GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE)",path="(/[^"\\]{0,192})"\} ([0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)$`)

// Store only a domain-separated digest of completed Admin API request
// and error counters. Failed writes, errors and ABA reloads may advance
// these counters even if the running Caddy config SHA returns to A.
// No GET health/metrics polling data participates in the fingerprint.
func privateCaddyAdminMutationDigest(lines []string) (string, error) {
	if len(lines) > privateMutationMetricsMaxLines {
		return "", errUntrusted
	}
	seen := make(map[string]bool, len(lines))
	ordered := make([]string, 0, len(lines))
	for _, line := range lines {
		if len(line) == 0 || len(line) > 512 {
			return "", errUntrusted
		}
		matched := privateCaddyMutationCounter.FindStringSubmatch(line)
		method, handler, path, amount := "", "", "", ""
		if matched != nil {
			handler, method, path, amount = matched[2], matched[3], matched[4], matched[5]
		} else {
			// Caddy also counts errors raised by Admin API modules. These
			// may change during rejected/failed mutating requests even if
			// the active config SHA and successful reload gauge do not.
			matched = privateCaddyAdminErrorCounter.FindStringSubmatch(line)
			if matched == nil {
				return "", errUntrusted
			}
			handler, method, path, amount = matched[1], matched[2], matched[3], matched[4]
		}
		// Prometheus may serialize large integral counters with an exponent.
		// Reject precision loss at 2^53: two consecutive increments can
		// round to the same float64 and hide an Admin mutation.
		num, err := strconv.ParseFloat(amount, 64)
		if err != nil || math.IsNaN(num) || math.IsInf(num, 0) || num < 0 || num >= 1<<53 || math.Trunc(num) != num {
			return "", errUntrusted
		}
		key := line[:strings.LastIndex(line, "} ")+1]
		if seen[key] {
			return "", errUntrusted
		}
		seen[key] = true
		// Validate every Admin series, including read methods. Only the
		// fixed built-in read paths used by this Host Collector can be
		// excluded. Plugin routes or unexpected HEAD/OPTIONS methods may
		// mutate Caddy state; never assume their method is read-only.
		switch method {
		case "GET":
			if handler == "metrics" && path == "/metrics" ||
				handler == "admin" && path == "/config/" {
				continue
			}
			return "", errUntrusted
		case "POST", "PUT", "PATCH", "DELETE":
		default:
			return "", errUntrusted
		}
		ordered = append(ordered, key+" "+strconv.FormatFloat(num, 'f', 0, 64))
	}
	sort.Strings(ordered)
	sum := sha256.Sum256([]byte("xdrive.caddy.admin-mutations.v1\n" + strings.Join(ordered, "\n") + "\n"))
	return hex.EncodeToString(sum[:]), nil
}
