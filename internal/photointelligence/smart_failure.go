package photointelligence

import (
	"context"
	"errors"
	"net"
	"strconv"
	"strings"
)

// SmartFailureCode reduces private model, socket and signed-preview errors to
// a fixed nonsecret reason. Never persist raw upstream model response bodies.
func SmartFailureCode(err error) string {
	if err == nil {
		return ""
	}
	if errors.Is(err, context.Canceled) {
		return "interrupted"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "model_timeout"
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return "model_timeout"
	}
	var opErr *net.OpError
	if errors.As(err, &opErr) {
		return "model_unreachable"
	}
	return SmartFailureCodeFromStored(err.Error())
}

// SmartFailureCodeFromStored also handles old rows with raw model errors.
// Never return the original content or details following an HTTP status.
func SmartFailureCodeFromStored(raw string) string {
	raw = strings.TrimSpace(raw)
	switch raw {
	case "analysis_failed", "model_timeout", "model_unreachable",
		"model_auth_rejected", "model_endpoint_missing", "model_server_error",
		"model_busy", "invalid_model_response", "preview_unavailable",
		"interrupted":
		return raw
	case "context canceled":
		return "interrupted"
	case "context deadline exceeded":
		return "model_timeout"
	}
	if strings.HasPrefix(raw, "smart analyzer returned HTTP ") {
		statusRaw, _, _ := strings.Cut(
			strings.TrimPrefix(raw, "smart analyzer returned HTTP "), ":",
		)
		status, err := strconv.Atoi(strings.TrimSpace(statusRaw))
		if err != nil {
			return "analysis_failed"
		}
		switch {
		case status == 401 || status == 403:
			return "model_auth_rejected"
		case status == 404:
			return "model_endpoint_missing"
		case status == 408:
			return "model_timeout"
		case status == 429:
			return "model_busy"
		case status >= 500 && status <= 599:
			return "model_server_error"
		default:
			return "analysis_failed"
		}
	}
	if strings.HasPrefix(raw, "smart analyzer request failed:") {
		if strings.Contains(raw, "context deadline exceeded") ||
			strings.Contains(raw, "i/o timeout") {
			return "model_timeout"
		}
		return "model_unreachable"
	}
	if strings.HasPrefix(raw, "decode smart analyzer response:") ||
		strings.HasPrefix(raw, "smart analyzer response exceeds size limit") ||
		strings.HasPrefix(raw, "unsupported smart analyzer protocol") ||
		strings.HasPrefix(raw, "smart OCR ") ||
		strings.HasPrefix(raw, "smart visual ") {
		return "invalid_model_response"
	}
	if strings.HasPrefix(raw, "smart analysis preview") {
		return "preview_unavailable"
	}
	return "analysis_failed"
}
