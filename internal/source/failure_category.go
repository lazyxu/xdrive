package source

import "strings"

// FailureCategory is a stable non-sensitive outcome label, not an error leak.
func FailureCategory(detail string) string {
	s := strings.ToLower(strings.TrimSpace(detail))
	switch {
	case strings.Contains(s, "429"), strings.Contains(s, "rate limit"),
		strings.Contains(s, "rate_limit"), strings.Contains(s, "too many requests"),
		strings.Contains(s, "throttl"), strings.Contains(s, "50005"):
		return "rate_limit"
	case strings.Contains(s, "permission denied"), strings.Contains(s, "access denied"),
		strings.Contains(s, "forbidden"), strings.Contains(s, "unauthorized"),
		strings.Contains(s, "401"), strings.Contains(s, "403"), strings.Contains(s, "eacces"):
		return "permission"
	case strings.Contains(s, "changed while"), strings.Contains(s, "source changed"),
		strings.Contains(s, "file changed"), strings.Contains(s, "modified during"),
		strings.Contains(s, "changed after hashing"), strings.Contains(s, "local snapshot"):
		return "source_changed"
	case strings.Contains(s, "revision conflict"), strings.Contains(s, "source execution result conflicts"),
		strings.Contains(s, "destination file"), strings.Contains(s, "name already exists"),
		strings.Contains(s, "already exists"), strings.Contains(s, "409"), strings.Contains(s, "conflict"):
		return "conflict"
	case strings.Contains(s, "timeout"), strings.Contains(s, "timed out"),
		strings.Contains(s, "connection"), strings.Contains(s, "network"),
		strings.Contains(s, "dns"), strings.Contains(s, "host unreachable"),
		strings.Contains(s, "broken pipe"), strings.Contains(s, "eof"),
		strings.Contains(s, "reset by peer"):
		return "network"
	default:
		return "other"
	}
}
