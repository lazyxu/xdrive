package api

import "strings"

const (
	sourceFailureNetwork     = "network"
	sourceFailurePermission  = "permission"
	sourceFailureRateLimit   = "rate_limit"
	sourceFailureConflict    = "conflict"
	sourceFailureFileChanged = "file_changed"
	sourceFailureOther       = "other"
)

func validSourceFailureCategory(category string) bool {
	switch category {
	case sourceFailureNetwork, sourceFailurePermission, sourceFailureRateLimit,
		sourceFailureConflict, sourceFailureFileChanged, sourceFailureOther:
		return true
	}
	return false
}

func sourceFailureCategoryOrClassify(category, message string) string {
	if validSourceFailureCategory(category) {
		return category
	}
	return classifySourceFailureMessage(message)
}

// Legacy clients only send text. Prefer 'other' over a speculative failure
// diagnosis, and never parse a path or emit the raw message as a category.
func classifySourceFailureMessage(message string) string {
	v := strings.ToLower(strings.TrimSpace(message))
	switch {
	case strings.Contains(v, "50005"), strings.Contains(v, "429"),
		strings.Contains(v, "rate limit"), strings.Contains(v, "too many requests"),
		strings.Contains(v, "限流"), strings.Contains(v, "操作过于频繁"):
		return sourceFailureRateLimit
	case strings.Contains(v, "permission denied"), strings.Contains(v, "access denied"),
		strings.Contains(v, "403 forbidden"), strings.Contains(v, "permission refused"),
		strings.Contains(v, "权限不足"):
		return sourceFailurePermission
	case strings.Contains(v, "source changed"), strings.Contains(v, "file changed"),
		strings.Contains(v, "changed while hashing"), strings.Contains(v, "changed after hashing"),
		strings.Contains(v, "文件已变化"):
		return sourceFailureFileChanged
	case strings.Contains(v, "409 conflict"), strings.Contains(v, "destination already exists"),
		strings.Contains(v, "revision conflict"), strings.Contains(v, "source execution conflict"):
		return sourceFailureConflict
	case strings.Contains(v, "connection refused"), strings.Contains(v, "connection reset"),
		strings.Contains(v, "network is unreachable"), strings.Contains(v, "no such host"),
		strings.Contains(v, "dial tcp"), strings.Contains(v, "i/o timeout"):
		return sourceFailureNetwork
	}
	return sourceFailureOther
}
