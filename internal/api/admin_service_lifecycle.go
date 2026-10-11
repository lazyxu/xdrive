package api

import "context"

// setServiceLifecycleStates adds four independently supported observations.
// "Observed" needs a trusted runtime probe, not saved configuration.
// "Verified" requires exact revision-bound effect proof, never just health.
func (s *Server) setServiceLifecycleStates(
	services []serviceDependency,
	baidu baiduMapEffectiveConfig,
	baiduErr error,
	mediaManaged bool,
	mediaConfigUnreadable bool,
	caddyContainerObserved bool,
) {
	for i := range services {
		item := &services[i]
		item.ConfigurationState = "unknown"
		item.InstallationState = "unknown"
		item.HealthState = "unknown"
		item.ActivationState = "unknown"
		if item.Status == "ready" {
			item.HealthState = "ready"
		} else if item.Status == "disabled" {
			item.HealthState = "not-checked"
		}

		switch item.ID {
		case "database":
			item.InstallationState = "external"
			if s.DB == nil {
				item.ConfigurationState = "unconfigured"
			} else {
				item.ConfigurationState = "configured"
				if item.Status == "unavailable" {
					item.HealthState = "failed" // Bounded PingContext.
				}
			}
			// Postgres pool revision is checked in its detailed control, not here.
		case "storage":
			item.ActivationState = "deployment-only"
			if s.Store == nil {
				item.ConfigurationState = "unconfigured"
			} else {
				item.ConfigurationState = "configured"
				if _, ok := s.Store.(interface{ Ready(context.Context) error }); ok &&
					item.Status == "unavailable" {
					item.HealthState = "failed"
				}
			}
		case "media-worker":
			if mediaConfigUnreadable {
				item.ConfigurationState = "unknown"
			} else if mediaManaged || s.MediaWorkerConfigured {
				item.ConfigurationState = "configured"
			} else {
				item.ConfigurationState = "unconfigured"
			}
			if item.Status == "ready" {
				item.InstallationState = "observed" // FFmpeg/FFprobe live probe.
			} else if !mediaManaged && s.MediaWorkerConfigured &&
				s.MediaWorkerProbe != nil && item.Status == "unavailable" {
				item.HealthState = "failed"
			}
			if mediaConfigUnreadable {
				item.ActivationState = "unknown"
			} else if mediaManaged {
				// Enabled requires exact host/resource/runtime matching; disabled
				// requires the same desired revision, stopped and staged limits.
				if item.Status == "ready" || item.Status == "disabled" {
					item.ActivationState = "verified"
				} else {
					item.ActivationState = "pending"
				}
			} else {
				item.ActivationState = "deployment-only"
			}
		case "photo-face":
			item.ConfigurationState = configStateFromRuntime(s.PhotoFaceAnalyzer != nil)
			item.ActivationState = "deployment-only"
			modelLifecycle(item)
		case "photo-smart":
			item.ConfigurationState = configStateFromRuntime(s.PhotoSmartAnalyzer != nil)
			item.ActivationState = "deployment-only"
			modelLifecycle(item)
		case "photo-semantic":
			item.ConfigurationState = configStateFromRuntime(s.PhotoSemanticAnalyzer != nil)
			item.ActivationState = "deployment-only"
			modelLifecycle(item)
		case "photo-creative":
			item.ConfigurationState = configStateFromRuntime(s.PhotoCreativeAnalyzer != nil)
			item.ActivationState = "deployment-only"
			modelLifecycle(item)
		case "geonames":
			if s.PhotoPlaceResolver != nil {
				item.ConfigurationState = "configured"
				item.InstallationState = "observed" // Loaded actual index.
			} else if s.GeoNamesDataDir == "" {
				item.ConfigurationState = "unconfigured"
			}
			// Loaded index does not prove current saved radius/revision applied.
		case "baidu-map":
			item.InstallationState = "external"
			item.HealthState = "not-checked" // Online call is explicit and quota-bound.
			if baiduErr != nil {
				item.ConfigurationState = "unknown"
				item.HealthState = "unknown"
			} else {
				item.ConfigurationState = configStateFromRuntime(baidu.Configured)
				switch {
				case baidu.Enabled && baidu.Configured:
					item.ActivationState = "local-effective" // New requests read AK.
				case baidu.Enabled:
					item.ActivationState = "pending"
				case baidu.Source == "saved":
					item.ActivationState = "local-effective" // Saved disable.
				}
			}
		case "background-worker":
			if item.Status == "ready" {
				item.InstallationState = "observed" // Fresh worker heartbeat.
			} else if item.Status == "unavailable" {
				item.HealthState = "failed" // Expired heartbeat.
			}
			// A fresh heartbeat doesn't prove an exact scheduling policy revision.
		case "caddy":
			item.ActivationState = "deployment-only"
			if caddyContainerObserved {
				item.ConfigurationState = "configured"
				item.InstallationState = "observed"
				if item.Status == "unavailable" {
					item.HealthState = "failed"
				}
			}
			// Local host TLS evidence never binds to saved HTTPS desired revision.
		}
	}
}

func configStateFromRuntime(configured bool) string {
	if configured {
		return "configured"
	}
	return "unconfigured"
}

func modelLifecycle(item *serviceDependency) {
	if item.Status == "ready" {
		item.InstallationState = "observed"
	} else if item.ConfigurationState == "configured" && item.Status == "unavailable" {
		item.HealthState = "failed"
	}
}
