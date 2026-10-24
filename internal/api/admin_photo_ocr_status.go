package api

import "github.com/lazyxu/xdrive/internal/photointelligence"

// Reuse the same allowlisted classifier as per-photo OCR failures.
// HTTP 408/429, wrapped network failures and legacy errors must produce
// actionable but nonsecret status codes, never upstream response text.
func photoOCRProbeFailureReason(err error) string {
	if err == nil {
		return ""
	}
	switch photointelligence.SmartFailureCode(err) {
	case "model_timeout":
		return "probe_timeout"
	case "interrupted":
		return "probe_interrupted"
	case "model_unreachable":
		return "probe_unreachable"
	case "model_auth_rejected":
		return "probe_auth_rejected"
	case "model_endpoint_missing":
		return "probe_endpoint_missing"
	case "model_busy":
		return "probe_busy"
	case "model_server_error":
		return "probe_server_error"
	case "invalid_model_response":
		return "probe_invalid_response"
	default:
		return "probe_failed"
	}
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
