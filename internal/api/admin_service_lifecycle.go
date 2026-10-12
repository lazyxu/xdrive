package api

import (
	"context"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourceworkerpolicy"
)

// setServiceLifecycleStates adds four independently supported observations.
// "Observed" needs a trusted runtime probe, not saved configuration.
// "Verified" requires exact revision-bound effect proof, never just health.
func (s *Server) setServiceLifecycleStates(
	ctx context.Context,
	services []serviceDependency,
	baidu baiduMapEffectiveConfig,
	baiduErr error,
	mediaManaged bool,
	mediaConfigUnreadable bool,
	caddyContainerObserved bool,
) {
	// Scheduler admission is separate from model installation, analyzer
	// health and successful execution. Saving an admin switch is not Docker apply.
	photoAdmission := s.photoAutomaticAdmissionEvidence(ctx)
	for i := range services {
		item := &services[i]
		item.ConfigurationState = "unknown"
		item.InstallationState = "unknown"
		item.HealthState = "unknown"
		item.ActivationState = "unknown"
		if autoState := photoAdmission.stateForService(item.ID); autoState != "" {
			item.AutomaticPolicyState = autoState
			if item.ID != "photo-creative" {
				item.AutomaticPolicyDesiredRevision = photoAdmission.desiredRevision
				item.AutomaticPolicyEffectiveRevision = photoAdmission.effectiveRevision
			}
		}
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
			// A live database Ping and an applied database/sql pool revision
			// are independent proofs. Only the current Server's exact saved
			// pool revision and actual max-open limit can be marked verified.
			if s.DB != nil {
				if desired, err := readPostgresPoolDesired(ctx, s.DB); err == nil {
					if sqlDB, err := s.DB.DB(); err == nil {
						item.ActivationState = postgresPoolLifecycleActivationState(
							desired, s.postgresPoolApplied.Load(), sqlDB.Stats().MaxOpenConnections,
						)
					}
				}
			}
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
			// A loaded (possibly previous) GeoNames resolver can remain healthy
			// while the administrator's desired revision has not taken effect.
			// Match the local immutable index, radius, content fingerprint and
			// applied revision; never infer deployment-wide activation.
			if s.DB != nil {
				if desired, err := geoNamesDesiredSettings(ctx, s.DB, s.GeoNamesMaxDistanceKM); err == nil {
					loaded := item.Status == "ready" && s.GeoNamesRuntime != nil &&
						strings.TrimSpace(s.GeoNamesDataDir) != "" && s.GeoNamesRuntime.Version() != ""
					radius := float64(0)
					if loaded {
						radius = s.GeoNamesRuntime.MaxDistanceKM()
					}
					item.ActivationState = geoNamesLifecycleActivationState(
						desired, loaded, radius, s.GeoNamesAppliedRevision.Load(),
						s.currentGeoNamesDatasetFingerprint(),
					)
				}
			}
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
			// Process liveness alone cannot prove that a saved global Pull
			// scheduling policy was applied at a safe task boundary. Reuse
			// the detailed admin policy evidence for the already observed
			// online workers; this neither reads user Sources nor contacts a host.
			if s.DB != nil {
				if desired, err := sourceworkerpolicy.Read(ctx, s.DB); err == nil && desired.Revision != 0 {
					item.ConfigurationState = "configured"
					var rows []meta.SourceWorkerPresence
					if err := s.DB.WithContext(ctx).
						Where("expires_at > ?", time.Now().UTC()).
						Order("instance_id ASC").Limit(101).Find(&rows).Error; err == nil {
						truncated := len(rows) > 100
						if truncated {
							rows = rows[:100]
						}
						item.ActivationState = sourceWorkerLifecycleActivationState(
							desired, rows, truncated, item.Status,
						)
					}
				}
			}
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
		// A trusted Host Manager may observe the fixed photo-face container
		// independently of the Server's analyzer socket and Info() probes.
		// An observed Docker container is not a verified running model or
		// an applied admin revision. No observer report remains unknown.
		if item.Group == "intelligence" &&
			item.PhotoHostRuntimeState != "" && item.PhotoHostRuntimeState != "unknown" {
			item.InstallationState = "observed"
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

// postgresPoolLifecycleActivationState deliberately does not treat unmanaged
// driver defaults as an administrator revision, even if its numbers match.
func postgresPoolLifecycleActivationState(
	desired postgresPoolDesired, applied *postgresPoolRuntime, observedMaxOpen int,
) string {
	if desired.Revision == 0 {
		return "unknown"
	}
	if applied != nil && applied.Revision == desired.Revision &&
		applied.Values == desired.Values &&
		observedMaxOpen == desired.Values.MaxOpenConnections {
		return "verified"
	}
	return "pending"
}

// geoNamesLifecycleActivationState proves only this instance's current index.
// A healthy old snapshot, different content address, or revision zero cannot
// acknowledge a new desired administrator revision.
func geoNamesLifecycleActivationState(
	desired geoNamesDesiredConfig, loaded bool, effectiveRadius float64,
	effectiveRevision uint64, effectiveFingerprint string,
) string {
	if desired.Revision == 0 {
		return "unknown"
	}
	if loaded && effectiveRevision == desired.Revision &&
		effectiveRadius == desired.MaxDistanceKM &&
		effectiveFingerprint == desired.Fingerprint {
		return "verified"
	}
	return "pending"
}

// sourceWorkerLifecycleActivationState is only an aggregate observation of
// fresh independent Pull Worker leases. A saved policy or a live heartbeat
// alone must never acknowledge its effective revision. An unknown/unavailable
// heartbeat, truncated scan or mismatching worker always fails closed.
func sourceWorkerLifecycleActivationState(
	desired sourceworkerpolicy.Desired, rows []meta.SourceWorkerPresence,
	truncated bool, healthStatus string,
) string {
	if desired.Revision == 0 {
		return "unknown"
	}
	if healthStatus != "ready" {
		return "pending"
	}
	state, _, _ := summarizeSourceWorkerEffective(desired, rows, truncated)
	if state == "applied" {
		return "verified"
	}
	return "pending"
}
