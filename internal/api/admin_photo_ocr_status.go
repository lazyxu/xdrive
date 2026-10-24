package api

import (
	"context"
	"errors"
	"net"
	"strings"
)

// Fixed nonsecret diagnostic codes; never return model response bodies,
// private Unix socket paths, bearer tokens, or raw upstream failures.
func photoOCRProbeFailureReason(err error) string {
	if err == nil {
		return ""
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "probe_timeout"
	}
	if errors.Is(err, context.Canceled) {
		return "probe_interrupted"
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return "probe_timeout"
	}
	var opErr *net.OpError
	if errors.As(err, &opErr) {
		return "probe_unreachable"
	}
	// Only trusted prefixes created by our own Smart HTTP adapter are read.
	message := err.Error()
	if strings.HasPrefix(message, "smart analyzer returned HTTP 401:") ||
		strings.HasPrefix(message, "smart analyzer returned HTTP 403:") {
		return "probe_auth_rejected"
	}
	if strings.HasPrefix(message, "unsupported smart analyzer protocol version") ||
		strings.HasPrefix(message, "decode smart analyzer response:") {
		return "probe_invalid_response"
	}
	if strings.HasPrefix(message, "smart analyzer returned HTTP 404:") {
		return "probe_endpoint_missing"
	}
	if strings.HasPrefix(message, "smart analyzer returned HTTP 500:") ||
		strings.HasPrefix(message, "smart analyzer returned HTTP 502:") ||
		strings.HasPrefix(message, "smart analyzer returned HTTP 503:") ||
		strings.HasPrefix(message, "smart analyzer returned HTTP 504:") {
		return "probe_server_error"
	}
	return "probe_failed"
}

// This is current-Server automatic OCR readiness, NOT proof of real photo
// recognition or a fleet-wide applied model revision.
func photoOCRAutoDiagnosis(item serviceDependency, probeIssue string, runnerReady bool) (state, reason string) {
	if item.ID != "photo-smart" {
		return "", ""
	}
	switch item.Status {
	case "disabled":
		if item.PhotoHostProfileConfigured != nil && !*item.PhotoHostProfileConfigured {
			return "disabled", "deployment_profile_disabled"
		}
		return "disabled", "analyzer_unconfigured"
	case "unavailable":
		switch item.PhotoHostRuntimeState {
		case "stopped":
			return "unavailable", "host_stopped"
		case "unhealthy":
			return "unavailable", "host_unhealthy"
		case "starting":
			return "unavailable", "host_starting"
		}
		if probeIssue != "" {
			return "unavailable", probeIssue
		}
		return "unavailable", "probe_failed"
	case "ready":
		if item.AutomaticPolicyState == "paused" {
			return "disabled", "auto_paused"
		}
		switch item.AutomaticPolicyState {
		case "pending":
			return "unknown", "auto_pending"
		case "unmanaged":
			return "unknown", "auto_unmanaged"
		case "enabled":
			// Also require independent trusted Host observation below.
		default:
			return "unknown", "auto_unknown"
		}
		if item.PhotoHostProfileConfigured != nil && !*item.PhotoHostProfileConfigured {
			return "unknown", "host_profile_mismatch"
		}
		switch item.PhotoHostRuntimeState {
		case "healthy":
			if item.PhotoHostProfileConfigured != nil && *item.PhotoHostProfileConfigured {
				if !runnerReady {
					return "unavailable", "runner_unavailable"
				}
				return "enabled", "ready"
			}
			return "unknown", "host_unverified"
		case "unhealthy":
			return "unavailable", "host_unhealthy"
		case "starting":
			return "unknown", "host_starting"
		case "stopped":
			return "unknown", "host_stopped"
		default:
			return "unknown", "host_unverified"
		}
	default:
		return "unknown", "service_unverified"
	}
}
